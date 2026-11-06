// Offline tests for h3-ai-chatbot. They run real H3 apps through app.request(),
// so no server or network is needed.
//
//   node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  H3,
  html,
  raw,
  redirect,
  setCookie,
  iterable,
  serveStatic,
  HTTPError,
  HTTPResponse,
  onError,
  handleCacheHeaders,
} from 'h3';

import aiChatbotDefault, {
  aiChatbot,
  aiChatbotMiddleware,
  chatbotScript,
  validateOptions,
  buildLoader,
  injectIntoHtml,
  DEFAULT_SCRIPT_URL,
} from '../src/index.js';

const ID = 'asyntai_1a2b3c4d5e6f';
const PAGE = '<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1></body></html>';
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

function appWith(options = { widgetId: ID }) {
  return new H3({ plugins: [aiChatbot(options)] });
}

function page(body = PAGE, init = {}) {
  return new Response(body, { ...init, headers: { ...HTML_HEADERS, ...init.headers } });
}

function countLoaders(text) {
  return text.split('data-asyntai-loader').length - 1;
}

// ---------- options ----------

test('default export is the plugin factory', () => {
  assert.equal(aiChatbotDefault, aiChatbot);
});

test('widgetId is required, and the error comes when the plugin is made', () => {
  assert.throws(() => aiChatbot(), /"widgetId" is required/);
  assert.throws(() => aiChatbot({}), /"widgetId" is required/);
  assert.throws(() => aiChatbot({ widgetId: '   ' }), /"widgetId" is required/);
  assert.throws(() => aiChatbotMiddleware({}), /"widgetId" is required/);
});

test('a wrong widgetId is refused with a clear message', () => {
  assert.throws(() => aiChatbot({ widgetId: '1a2b3c' }), /does not look like a widget ID/);
  assert.throws(() => aiChatbot({ widgetId: 'asyntai_<script>' }), /does not look like a widget ID/);
});

test('widgetId is trimmed and scriptUrl has a default', () => {
  const s = validateOptions({ widgetId: '  ' + ID + ' ' });
  assert.equal(s.widgetId, ID);
  assert.equal(s.scriptUrl, DEFAULT_SCRIPT_URL);
  assert.equal(s.skip, null);
});

test('skip must be a function', () => {
  assert.throws(() => aiChatbot({ widgetId: ID, skip: true }), /"skip" must be a function/);
});

// ---------- loader ----------

test('loader waits for the load event and checks for an existing widget', () => {
  const js = buildLoader(ID, DEFAULT_SCRIPT_URL);
  assert.match(js, /addEventListener\("load"/);
  assert.match(js, /document\.readyState==="complete"/);
  assert.match(js, /script\[data-asyntai-id\]/);
  assert.ok(js.includes(JSON.stringify(ID)));
});

test('loader escapes "<" so a script URL cannot close the tag', () => {
  const js = buildLoader(ID, 'https://x.test/</script><b>');
  assert.ok(!js.includes('</script>'));
  assert.ok(js.includes('\\u003c/script>'));
});

test('chatbotScript returns one complete script tag', () => {
  const tag = chatbotScript({ widgetId: ID });
  assert.ok(tag.startsWith('<script data-asyntai-loader>'));
  assert.ok(tag.endsWith('</script>'));
  assert.equal(countLoaders(tag), 1);
});

// ---------- injectIntoHtml ----------

test('injects before the last </body>', () => {
  const out = injectIntoHtml('<body><p>a</p></body><!-- </body> --></body>', '<X>');
  assert.equal(out, '<body><p>a</p></body><!-- </body> --><X></body>');
});

test('falls back to </html> and is case-insensitive', () => {
  assert.equal(injectIntoHtml('<HTML><P>x</P></HTML>', '<X>'), '<HTML><P>x</P><X></HTML>');
  assert.equal(injectIntoHtml('<BODY>x</BODY>', '<X>'), '<BODY>x<X></BODY>');
});

test('leaves fragments and pages with a snippet alone', () => {
  assert.equal(injectIntoHtml('<div>partial</div>', '<X>'), '<div>partial</div>');
  const own = '<body><script data-asyntai-id="asyntai_x" src="y"></script></body>';
  assert.equal(injectIntoHtml(own, '<X>'), own);
  const loader = '<body><script data-asyntai-loader>1</script></body>';
  assert.equal(injectIntoHtml(loader, '<X>'), loader);
});

// ---------- plugin on real H3 apps ----------

test('adds the widget to a Response page', async () => {
  const app = appWith();
  app.get('/', () => page());
  const res = await app.request('/');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(countLoaders(text), 1);
  assert.ok(text.indexOf('data-asyntai-loader') < text.indexOf('</body>'));
  assert.ok(text.includes(ID));
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('adds the widget to an html`` template page', async () => {
  const app = appWith();
  app.get('/', () => html`<!doctype html><html><body><p>${'<escaped>'}</p>${raw('<b>raw</b>')}</body></html>`);
  const text = await (await app.request('/')).text();
  assert.equal(countLoaders(text), 1);
  assert.ok(text.includes('&lt;escaped&gt;'));
  assert.ok(text.includes('<b>raw</b>'));
});

test('adds the widget to a string with an HTML type set on the event', async () => {
  const app = appWith();
  app.get('/', (event) => {
    event.res.headers.set('content-type', 'text/html; charset=utf-8');
    return PAGE;
  });
  assert.equal(countLoaders(await (await app.request('/')).text()), 1);
});

test('adds the widget to an HTTPResponse page', async () => {
  const app = appWith();
  app.get('/', () => new HTTPResponse(PAGE, { status: 200, headers: HTML_HEADERS }));
  assert.equal(countLoaders(await (await app.request('/')).text()), 1);
});

test('adds the widget to a streamed HTML page', async () => {
  const app = appWith();
  app.get('/', (event) => {
    event.res.headers.set('content-type', 'text/html; charset=utf-8');
    return iterable(
      (async function* () {
        yield '<html><body><p>part one</p>';
        yield '<p>part two</p></body></html>';
      })(),
    );
  });
  const text = await (await app.request('/')).text();
  assert.equal(countLoaders(text), 1);
  assert.ok(text.includes('part one') && text.includes('part two'));
});

test('adds the widget to a page from serveStatic(), and static meta stays right', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, 'fixture.html');
  const app = appWith();
  app.get('/**', (event) =>
    serveStatic(event, {
      getContents: () => readFile(file),
      getMeta: async () => {
        const s = await stat(file);
        return { size: s.size, mtime: s.mtime, type: 'text/html; charset=utf-8' };
      },
    }),
  );
  const res = await app.request('/fixture.html');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), null);
  assert.equal(res.headers.get('last-modified'), null);
  const text = await res.text();
  assert.equal(countLoaders(text), 1);
  assert.ok(text.includes('fixture page'));
});

test('JSON, plain text and binary responses pass through untouched', async () => {
  const app = appWith();
  app.get('/json', () => ({ body: '</body>' }));
  app.get('/text', () => '</body>');
  app.get('/bin', () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
  assert.deepEqual(await (await app.request('/json')).json(), { body: '</body>' });
  assert.equal(await (await app.request('/text')).text(), '</body>');
  const bin = new Uint8Array(await (await app.request('/bin')).arrayBuffer());
  assert.deepEqual([...bin], [1, 2, 3]);
});

test('error pages, redirects and non-GET requests are left alone', async () => {
  const app = appWith();
  app.get('/missing', () => page(PAGE, { status: 404 }));
  app.get('/boom', () => {
    throw new Error('boom');
  });
  app.get('/denied', () => {
    throw new HTTPError({ status: 403, message: 'no' });
  });
  app.get('/go', () => redirect('/'));
  app.post('/form', () => page());
  for (const [path, init] of [['/missing'], ['/form', { method: 'POST' }]]) {
    const text = await (await app.request(path, init)).text();
    assert.equal(countLoaders(text), 0, path);
  }
  assert.equal((await app.request('/boom')).status, 500);
  assert.equal((await app.request('/denied')).status, 403);
  assert.equal((await app.request('/nothing-here')).status, 404);
  const go = await app.request('/go');
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), '/');
  assert.equal(countLoaders(await go.text()), 0);
});

test('an onError() HTML page is left alone', async () => {
  const app = appWith();
  app.use(onError(() => page('<html><body>error</body></html>', { status: 500 })));
  app.get('/boom', () => {
    throw new Error('boom');
  });
  const res = await app.request('/boom');
  assert.equal(res.status, 500);
  assert.equal(countLoaders(await res.text()), 0);
});

test('a page that already has the Asyntai snippet gets no second copy', async () => {
  const app = appWith();
  const own = '<html><body><script async data-asyntai-id="' + ID + '" src="' + DEFAULT_SCRIPT_URL + '"></script></body></html>';
  app.get('/', () => page(own));
  assert.equal(await (await app.request('/')).text(), own);
});

test('chatbotScript() placed by hand gets no second copy', async () => {
  const app = appWith();
  const tag = chatbotScript({ widgetId: ID });
  app.get('/', () => html`<html><body>${raw(tag)}</body></html>`);
  assert.equal(countLoaders(await (await app.request('/')).text()), 1);
});

test('a fragment (htmx partial) is returned unchanged and still readable', async () => {
  const app = appWith();
  app.get('/partial', () => page('<li>item</li>'));
  assert.equal(await (await app.request('/partial')).text(), '<li>item</li>');
});

test('cookies and custom headers are kept once; validators are dropped', async () => {
  const app = appWith();
  app.get('/', (event) => {
    event.res.headers.set('x-custom', 'yes');
    setCookie(event, 'a', '1');
    setCookie(event, 'b', '2');
    event.res.headers.set('content-length', String(PAGE.length));
    event.res.headers.set('etag', '"old"');
    return page();
  });
  const res = await app.request('/');
  assert.equal(res.headers.get('x-custom'), 'yes');
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies[0].startsWith('a=1') && cookies[1].startsWith('b=2'));
  assert.equal(res.headers.get('content-length'), null);
  assert.equal(res.headers.get('etag'), null);
  assert.equal(countLoaders(await res.text()), 1);
});

test('a status set on a Response is kept', async () => {
  const app = appWith();
  app.get('/', () => page(PAGE, { status: 201 }));
  const res = await app.request('/');
  assert.equal(res.status, 201);
  assert.equal(countLoaders(await res.text()), 1);
});

test('a page sent by handleCacheHeaders() still answers 304', async () => {
  const app = appWith();
  const stamp = new Date('2026-01-01T00:00:00Z');
  app.get('/', (event) => {
    if (handleCacheHeaders(event, { modifiedTime: stamp })) return new HTTPResponse(null, { status: 304 });
    return page();
  });
  const first = await app.request('/');
  assert.equal(countLoaders(await first.text()), 1);
  const again = await app.request('/', { headers: { 'if-modified-since': stamp.toUTCString() } });
  assert.equal(again.status, 304);
});

test('skip() keeps the widget off chosen pages', async () => {
  const app = appWith({ widgetId: ID, skip: (event) => event.url.pathname.startsWith('/admin') });
  app.get('/admin/panel', () => page());
  app.get('/shop', () => page());
  assert.equal(countLoaders(await (await app.request('/admin/panel')).text()), 0);
  assert.equal(countLoaders(await (await app.request('/shop')).text()), 1);
});

test('app.register() works the same as the plugins option', async () => {
  const app = new H3();
  app.register(aiChatbot({ widgetId: ID }));
  app.get('/', () => page());
  assert.equal(countLoaders(await (await app.request('/')).text()), 1);
});

test('aiChatbotMiddleware works on one part of a site', async () => {
  const app = new H3();
  app.use('/site/**', aiChatbotMiddleware({ widgetId: ID }));
  app.get('/site/a', () => page());
  app.get('/site/b', () => page());
  app.get('/other', () => page());
  assert.equal(countLoaders(await (await app.request('/site/a')).text()), 1);
  assert.equal(countLoaders(await (await app.request('/site/b')).text()), 1);
  assert.equal(countLoaders(await (await app.request('/other')).text()), 0);
});

test('works in a sub-app mounted with mount()', async () => {
  const sub = new H3();
  sub.get('/page', () => page());
  const app = appWith();
  app.mount('/sub', sub);
  assert.equal(countLoaders(await (await app.request('/sub/page')).text()), 1);
});

test('a page already compressed by a later middleware is left alone, not broken', async () => {
  const app = appWith();
  const gz = await new Response(new Blob([PAGE]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  app.get('/', () => new Response(gz, { headers: { ...HTML_HEADERS, 'content-encoding': 'gzip' } }));
  const res = await app.request('/');
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  assert.equal(text, PAGE);
});

test('a one-part (206) response and a file download are left alone', async () => {
  const app = appWith();
  app.get('/part', () => page(PAGE, { status: 206 }));
  app.get('/file', () => page(PAGE, { headers: { 'content-disposition': 'attachment; filename="a.html"' } }));
  assert.equal(await (await app.request('/part')).text(), PAGE);
  assert.equal(await (await app.request('/file')).text(), PAGE);
});

test('HEAD requests still work', async () => {
  const app = appWith();
  app.get('/', () => page());
  const res = await app.request('/', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('a non-ASCII page keeps its characters', async () => {
  const app = appWith();
  const body = '<html><body><p>Žluťoučký kůň 日本語 🙂</p></body></html>';
  app.get('/', () => page(body));
  const text = await (await app.request('/')).text();
  assert.ok(text.includes('Žluťoučký kůň 日本語 🙂'));
  assert.equal(countLoaders(text), 1);
});

test('a page that is not UTF-8 goes out with the same bytes', async () => {
  const app = appWith();
  const prefix = new TextEncoder().encode('<html><body><p>caf');
  const suffix = new TextEncoder().encode('</p></body></html>');
  const bytes = new Uint8Array([...prefix, 0xe9, ...suffix]);
  app.get('/', () => new Response(bytes, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } }));
  const out = new Uint8Array(await (await app.request('/')).arrayBuffer());
  assert.deepEqual([...out], [...bytes]);
});

test('a byte order mark at the start of a page is kept', async () => {
  const app = appWith();
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(PAGE)]);
  app.get('/', () => new Response(bytes, { headers: HTML_HEADERS }));
  const out = new Uint8Array(await (await app.request('/')).arrayBuffer());
  assert.deepEqual([...out.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(countLoaders(new TextDecoder().decode(out)), 1);
});

test('the same plugin instance serves many requests', async () => {
  const app = appWith();
  app.get('/', () => page());
  const texts = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve(app.request('/')).then((r) => r.text())));
  assert.ok(texts.every((t) => countLoaders(t) === 1));
});
