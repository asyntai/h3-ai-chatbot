import type { H3Event, H3Plugin, Middleware } from 'h3';

export interface AsyntaiOptions {
  /** Your Asyntai widget ID, for example `asyntai_1a2b3c4d5e6f`. Required. */
  widgetId: string;
  /** Return true to leave a page without the widget, for example admin pages. */
  skip?: (event: H3Event) => boolean;
  /** Advanced. Load the widget script from another URL. */
  scriptUrl?: string;
}

/** Plugin that adds the Asyntai chat widget to every HTML page. */
export declare function aiChatbot(options: AsyntaiOptions): H3Plugin;

/** The same work as a middleware, for one part of a site. */
export declare function aiChatbotMiddleware(options: AsyntaiOptions): Middleware;

/** The `<script>` tag on its own, for templates where you place it by hand. */
export declare function chatbotScript(options: AsyntaiOptions): string;

export declare function validateOptions(options: AsyntaiOptions): {
  widgetId: string;
  scriptUrl: string;
  skip: ((event: H3Event) => boolean) | null;
};
export declare function buildLoader(widgetId: string, scriptUrl: string): string;
export declare function injectIntoHtml(html: string, tag: string): string;
export declare const DEFAULT_SCRIPT_URL: string;

export default aiChatbot;
