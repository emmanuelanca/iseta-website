/**
 * Cloudflare Pages Function — POST /api/chat
 * Proxies OpenRouter chat completions for the ISETA Deep Chat widget.
 *
 * - Client speaks the Deep Chat message format: {messages: [{role, text}]}
 * - Server adds the ISETA persona as the leading system message and maps
 *   every client role/text to OpenAI/OpenRouter {role, content}
 * - When the client starts streaming, converts OpenRouter's SSE
 *   (choices[0].delta.content) into Deep Chat SSE ({text} chunks)
 * - Otherwise returns plain JSON {text}
 * - Errors are returned as {error} so Deep Chat can display them.
 */
import {
  OPENROUTER_BASE,
  CHAT_MODEL,
  MAX_TOKENS,
  buildChatMessages,
  requireKey,
  jsonError,
} from '../../lib/openrouter.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (context.request.method.toUpperCase() !== 'POST') {
    return jsonError('Método no permitido', 405);
  }

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

  const messagesOut = buildChatMessages(
    body && Array.isArray(body.messages) ? body.messages : null
  );
  if (!messagesOut) return jsonError('No hay mensajes para enviar');

  const openRouterBody = {
    model: CHAT_MODEL,
    messages: messagesOut,
    max_tokens: MAX_TOKENS,
    stream: body && body.stream === true,
  };

  let upstream;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openRouterBody),
    });
  } catch (_) {
    return jsonError('No se pudo contactar al servicio de IA', 502);
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (await upstream.json()).error?.message || '';
    } catch (_) { /* ignore */ }
    return jsonError(`Servicio de IA respondió ${upstream.status}. ${detail}`.trim(), 502);
  }

  if (!openRouterBody.stream) {
    let result;
    try {
      result = await upstream.json();
    } catch (_) {
      return jsonError('Respuesta inválida del servicio de IA', 502);
    }
    const text =
      result.choices && result.choices[0] && result.choices[0].message
        ? result.choices[0].message.content || ''
        : '';
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // stream: relay upstream SSE, rewriting each delta into the Deep Chat
  // Response format: data: {"text": "..."}\n\n
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  let buffer = '';
  const writeOut = (obj) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const pump = (async () => {
    try {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, sep).replace(/\r$/, '');
          buffer = buffer.slice(sep + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            if (chunk.error) {
              await writeOut({ error: String(chunk.error.message || 'Error del servicio de IA') });
              continue;
            }
            const content = chunk.choices?.[0]?.delta?.content;
            if (typeof content === 'string' && content.length) {
              await writeOut({ text: content });
            }
          } catch (_) {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (_) {
      try {
        await writeOut({ error: 'Conexión interrumpida con el servicio de IA' });
      } catch (_) { /* already closed */ }
    } finally {
      try {
        await writer.close();
      } catch (_) { /* already closed */ }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
