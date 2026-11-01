/**
 * Cloudflare Worker entry point for the ISETA site
 * (Workers Static Assets model).
 *
 * Routing:
 * - Requests that match a file inside ./iseta are served directly by the
 *   asset layer, without invoking this Worker (so static traffic stays free
 *   and unchanged).
 * - Everything else reaches this script. /api/* goes to the OpenRouter
 *   proxies; any other missing path is handed back to the asset layer so it
 *   returns the usual 404.
 */
import { onRequestPost as chat } from '../functions/api/chat.js';
import { onRequestPost as embeddings } from '../functions/api/embeddings.js';

const ROUTES = {
  '/api/chat': chat,
  '/api/embeddings': embeddings,
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status || 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const handler = ROUTES[path];

    if (handler) {
      if (request.method !== 'POST') return jsonError('Método no permitido', 405);
      return handler({ request, env, ctx });
    }

    return env.ASSETS.fetch(request);
  },
};
