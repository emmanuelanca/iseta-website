/**
 * Cloudflare Pages Function — POST /api/embeddings
 * Proxies OpenRouter's embeddings endpoint for the ISETA chat widget's
 * semantic retrieval. The API key lives in the Pages secret
 * OPENROUTER_API_KEY; the browser only ever talks to this same-origin
 * route (no Authorization header, no key exposure).
 *
 * Request body: {model?: string, input: string | string[]}
 * Response: OpenRouter's embeddings JSON, passed through unchanged.
 */
import { OPENROUTER_BASE, EMBEDDINGS_MODEL, requireKey, jsonError } from '../../lib/openrouter.js';

const MAX_INPUTS = 8;

export async function onRequestPost({ request, env }) {
  let key;
  try {
    key = requireKey(env);
  } catch (err) {
    return jsonError(err.message, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError('Cuerpo de la petición inválido');
  }

  const single = typeof body.input === 'string';
  const multiple = Array.isArray(body.input) && body.input.every((s) => typeof s === 'string');
  if (!single && !multiple) {
    return jsonError('Falta "input" (string o lista de strings)');
  }
  const inputs = single ? [body.input] : body.input;
  if (inputs.length > MAX_INPUTS) {
    return jsonError(`Máximo ${MAX_INPUTS} inputs por pedido`);
  }
  // force the allowed model regardless of what the client claims
  const payload = {
    model: EMBEDDINGS_MODEL,
    input: inputs.map((s) => s.slice(0, 8000)),
  };

  let upstream;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    return jsonError('No se pudo contactar al servicio de embeddings', 502);
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (await upstream.json()).error?.message || '';
    } catch (_) { /* ignore */ }
    return jsonError(`Servicio de embeddings respondió ${upstream.status}. ${detail}`.trim(), 502);
  }

  const data = await upstream.text();
  return new Response(data, {
    headers: { 'Content-Type': 'application/json' },
  });
}
