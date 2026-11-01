/**
 * Shared pieces for the OpenRouter proxy functions.
 * The API key is read from the environment OPENROUTER_API_KEY (a Pages
 * secret) and never reaches the browser.
 */

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Allowed per-request settings: the proxy enforces these on both endpoints
// so a modified client cannot probe other models or unbound generation.
export const CHAT_MODEL = 'openai/gpt-4o-mini';
export const EMBEDDINGS_MODEL = 'qwen/qwen3-embedding-8b';
export const MAX_TOKENS = 1024;
export const MAX_MESSAGES = 24;
export const MAX_TEXT_CHARS = 4000;
// injected documentation chunks arrive as a system message and are much
// larger than a user message: up to MAX_CHUNKS fragments + headings
export const MAX_SYSTEM_CHARS = 16000;

export const PERSONA =
  'Sos el asistente virtual del ISETA (Instituto Superior Experimental de Tecnología ' +
  'Alimentaria). Respondé consultas sobre la institución amablemente y hablando en voseo. ' +
  'Si no sabés algo específico de la institución o el usuario pregunta algo no relacionado a la ' +
  'institución, amablemente no respondas la pregunta.';

export function requireKey(env) {
  const key = env && env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY no está configurado (Pages → Settings → Variables & Secrets).');
  }
  return key;
}

export function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status || 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Deep Chat request body: {messages: [{role: 'user'|'ai'|'system', text: '...'}, ...]}
 * OpenRouter chat completions body: {messages: [{role: ..., content: '...'}, ...]}
 */
export function buildChatMessages(deepChatMessages) {
  if (!deepChatMessages || !Array.isArray(deepChatMessages)) return null;
  const out = [{ role: 'system', content: PERSONA }];
  let count = 0;
  for (const m of deepChatMessages) {
    if (!m || typeof m.text !== 'string') continue;
    if (m.role === 'system') {
      // documentation chunks injected by the client's request interceptor
      out.push({ role: 'system', content: m.text.slice(0, MAX_SYSTEM_CHARS) });
      continue;
    }
    if (count >= MAX_MESSAGES) break;
    out.push({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text.slice(0, MAX_TEXT_CHARS),
    });
    count++;
  }
  if (out.length === 1) return null; // nothing to answer
  return out;
}
