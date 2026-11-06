# h3-ai-chatbot

Add the [Asyntai](https://asyntai.com) AI chat assistant to any
[H3](https://h3.dev) app. It answers visitor questions from your own content,
in more than 80 languages.

It is an H3 plugin for H3 version 2. It works on every runtime H3 supports:
Node.js, Bun, Deno and Cloudflare Workers.

## Install

```bash
npm install h3-ai-chatbot
```

Then register the plugin when you make the app:

```js
import { H3, html, serve } from 'h3'
import { aiChatbot } from 'h3-ai-chatbot'

const app = new H3({
  plugins: [aiChatbot({ widgetId: 'asyntai_1a2b3c4d5e6f' })],
})

app.get('/', () => html`<html><body><h1>Welcome</h1></body></html>`)

serve(app, { port: 3000 })
```

Every HTML page now has the chat bubble. That includes pages made with
`` html`...` ``, a `Response`, a stream and `serveStatic()`.

A page must have the type `text/html`. H3 sends a plain returned string as
`text/plain`, so a browser does not show it as a page. Use `` html`...` `` or set
the type on `event.res.headers`.

## Where the widget ID comes from

Open the Install page in your [Asyntai dashboard](https://asyntai.com/dashboard).
The widget ID is the value of `data-asyntai-id` in the snippet shown there. It
starts with `asyntai_`.

Creating an account is free, and the Free plan is enough to try the widget.

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `widgetId` | string | required | Your Asyntai widget ID |
| `skip` | `(event) => boolean` | none | Return `true` to keep the widget off a page, for example admin pages |
| `scriptUrl` | string | the Asyntai CDN | Advanced. Load the widget from another URL |

A missing or malformed `widgetId` stops the app at start-up with a message that
says how to fix it.

Keep the widget off some pages:

```js
aiChatbot({
  widgetId: 'asyntai_1a2b3c4d5e6f',
  skip: (event) => event.url.pathname.startsWith('/admin'),
})
```

Use it on one part of the site only:

```js
import { aiChatbotMiddleware } from 'h3-ai-chatbot'

app.use('/shop/**', aiChatbotMiddleware({ widgetId: 'asyntai_1a2b3c4d5e6f' }))
```

## Placing the tag by hand

If you prefer to put the tag in your own layout, use `chatbotScript()`:

```js
import { html, raw } from 'h3'
import { chatbotScript } from 'h3-ai-chatbot'

const tag = chatbotScript({ widgetId: 'asyntai_1a2b3c4d5e6f' })

app.get('/', () => html`<html><body><h1>Welcome</h1>${raw(tag)}</body></html>`)
```

The plugin sees the tag and does not add a second one.

## What the plugin does

- It adds the Asyntai loader to every full HTML page, just before `</body>`.
- It changes only successful `GET` responses with the type `text/html`. JSON,
  images, redirects and error pages pass through untouched.
- HTML fragments without a `<body>` or `<html>` tag, for example htmx
  partials, stay as they are.
- A page that already has the Asyntai snippet keeps it and gets no second one.
- A page that is compressed, sent as a download or not in UTF-8 keeps the same
  bytes and gets no widget.
- The loader waits for the page's `load` event, so your page always renders
  first.
- It keeps your status code, cookies and headers. It removes `Content-Length`,
  `ETag` and `Last-Modified`, because the page changed.

## Answering from your content

Asyntai reads your published pages. Add your site URL in the dashboard, and the
assistant answers from the same pages the widget sits on. You can also add extra
documents and question and answer pairs.

## Removing it

Delete the `aiChatbot(...)` line and deploy again. The widget is gone.

## Support

Email [hello@asyntai.com](mailto:hello@asyntai.com), or read the
[H3 guide](https://asyntai.com/documentation/integrations/h3/).

## Licence

MIT. See [LICENSE](LICENSE).
