/**
 * Asyntai AI chatbot for H3.
 *
 * A plugin that adds the Asyntai chat widget to every HTML page an H3 app
 * returns. It runs after the route handler, so it works the same for html``
 * templates, a Response, a stream and serveStatic(), on every runtime H3
 * supports (Node.js, Bun, Deno, Cloudflare Workers...). JSON, images and other
 * responses pass through untouched.
 *
 * It puts the ordinary embed loader just before </body> and changes nothing
 * else on the page.
 */

import { onResponse } from 'h3';

const DEFAULT_SCRIPT_URL = 'https://widget.asyntai.com/static/js/chat-widget.js';
const WIDGET_ID_PATTERN = /^asyntai_[A-Za-z0-9]+$/;
const NAME = 'h3-ai-chatbot';

/**
 * Called when the app is set up, so a wrong option fails at start-up with a
 * clear message instead of a site with no chat on it.
 */
export function validateOptions(options) {
  const opts = options || {};
  const widgetId = typeof opts.widgetId === 'string' ? opts.widgetId.trim() : '';

  if (!widgetId) {
    throw new Error(
      NAME +
        ': "widgetId" is required. Copy it from the Install page of your ' +
        'Asyntai dashboard, for example asyntai_1a2b3c4d5e6f.',
    );
  }
  if (!WIDGET_ID_PATTERN.test(widgetId)) {
    throw new Error(
      NAME +
        ': "' +
        widgetId +
        '" does not look like a widget ID. It starts with asyntai_, for ' +
        'example asyntai_1a2b3c4d5e6f.',
    );
  }

  const scriptUrl =
    typeof opts.scriptUrl === 'string' && opts.scriptUrl.trim()
      ? opts.scriptUrl.trim()
      : DEFAULT_SCRIPT_URL;

  if (opts.skip !== undefined && typeof opts.skip !== 'function') {
    throw new Error(NAME + ': "skip" must be a function (event) => boolean.');
  }

  return {
    widgetId,
    scriptUrl,
    skip: typeof opts.skip === 'function' ? opts.skip : null,
  };
}

/** JSON.stringify, safe inside an HTML <script> element. */
function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The loader waits for the page's load event before it fetches the widget.
 * An ordinary `<script async src>` holds the load event open until its own
 * fetch finishes, so an unreachable server would delay the host page. This
 * pattern cannot.
 */
export function buildLoader(widgetId, scriptUrl) {
  return (
    '(function(){var l=function(){' +
    'if(document.querySelector("script[data-asyntai-id]"))return;' +
    'var s=document.createElement("script");' +
    's.src=' +
    jsString(scriptUrl) +
    ';s.async=true;' +
    's.setAttribute("data-asyntai-id",' +
    jsString(widgetId) +
    ');' +
    'document.head.appendChild(s)};' +
    'if(document.readyState==="complete"){l()}' +
    'else{window.addEventListener("load",l)}})();'
  );
}

/**
 * The full tag for templates. Use it when you want to place the widget by
 * hand, for example with raw() in an html`` template, instead of the plugin.
 */
export function chatbotScript(options) {
  const settings = validateOptions(options);
  return (
    '<script data-asyntai-loader>' +
    buildLoader(settings.widgetId, settings.scriptUrl) +
    '</script>'
  );
}

/**
 * Puts the tag before the last </body>, or before </html> when the page has no
 * body tag. A fragment with neither (an htmx partial, for example) is left
 * alone: it is not a whole page. A page that already carries an Asyntai
 * snippet is left alone too.
 */
export function injectIntoHtml(html, tag) {
  if (typeof html !== 'string' || html.includes('data-asyntai-id') || html.includes('data-asyntai-loader')) {
    return html;
  }
  const lower = html.toLowerCase();
  let at = lower.lastIndexOf('</body>');
  if (at === -1) {
    at = lower.lastIndexOf('</html>');
  }
  if (at === -1) {
    return html;
  }
  return html.slice(0, at) + tag + html.slice(at);
}

/** True when the response is a whole HTML page we may change. */
function isEditableHtml(event, res) {
  if (!res.body) return false;
  if (event.req.method !== 'GET') return false;
  // 206 is one part of a file, so it has no whole page to edit.
  if (res.status < 200 || res.status >= 300 || res.status === 206) return false;
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('text/html')) return false;
  // A body another middleware already compressed cannot be edited as text.
  const encoding = (res.headers.get('content-encoding') || '').toLowerCase();
  if (encoding && encoding !== 'identity') return false;
  // The browser saves this response as a file, so it is not a page to show.
  const disposition = (res.headers.get('content-disposition') || '').toLowerCase();
  if (disposition.startsWith('attachment')) return false;
  return true;
}

/**
 * The middleware on its own, for one part of a site:
 *
 *   app.use('/shop/**', aiChatbotMiddleware({ widgetId: 'asyntai_1a2b3c4d5e6f' }))
 */
export function aiChatbotMiddleware(options) {
  const settings = validateOptions(options);
  const tag =
    '<script data-asyntai-loader>' +
    buildLoader(settings.widgetId, settings.scriptUrl) +
    '</script>';

  return onResponse(async (res, event) => {
    if (!isEditableHtml(event, res)) return;
    if (settings.skip && settings.skip(event)) return;

    const bytes = new Uint8Array(await res.arrayBuffer());
    let html;
    try {
      html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      // Not UTF-8. Editing it as text would break its characters, so the page
      // goes out as it came in.
      return new Response(bytes, res);
    }

    const changed = injectIntoHtml(html, tag);
    if (changed === html) {
      // arrayBuffer() read the body, so hand back a fresh copy of the same page.
      return new Response(bytes, res);
    }

    const headers = new Headers(res.headers);
    // The length changed. Let the runtime set it again, and drop the
    // validators that described the old bytes.
    headers.delete('content-length');
    headers.delete('etag');
    headers.delete('last-modified');
    return new Response(changed, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  });
}

/**
 * The plugin. Register it when you make the app:
 *
 *   import { H3 } from 'h3'
 *   import { aiChatbot } from 'h3-ai-chatbot'
 *
 *   const app = new H3({ plugins: [aiChatbot({ widgetId: 'asyntai_1a2b3c4d5e6f' })] })
 */
export function aiChatbot(options) {
  const middleware = aiChatbotMiddleware(options);
  return (h3) => {
    h3.use(middleware);
  };
}

export { DEFAULT_SCRIPT_URL };
export default aiChatbot;
