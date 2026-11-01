# Deployment — Cloudflare Pages

The chat widget no longer talks to OpenRouter directly. All AI traffic goes
through two same-origin Cloudflare Pages Functions, and the API key lives only
in the Pages environment:

```
Browser ──/api/chat────────► functions/api/chat.js ──► openrouter.ai chat completions
Browser ──/api/embeddings──► functions/api/embeddings.js ──► openrouter.ai embeddings
```

The browser never receives the key. Retrieval still runs client-side: the
widget embeds the visitor's question through `/api/embeddings`, scores it
against `iseta/wp-content/iseta-chat/docs-vectors.bin` and injects the matching
documentation chunks into `/api/chat`.

## 0. Before anything else: rotate the API key

The previous version of `chat.js` shipped a real OpenRouter key to every
visitor, and it is still present in the git history. Treat it as compromised:

1. Revoke it at <https://openrouter.ai/keys>.
2. Create a new key.
3. Never put the new key in client code — only in the Pages secret (step 3)
   and in the local `.dev.vars` (git-ignored) for development.
4. Set a monthly spending limit on the OpenRouter account as a safety net.

## 1. Repository layout

Only the `iseta/` folder is published. The functions must stay at the
repository root, next to it:

```
functions/api/chat.js          # proxy: chat completions (streaming)
functions/api/embeddings.js    # proxy: query embeddings
lib/openrouter.js              # persona, model allow-list, shared helpers
iseta/                         # the mirrored site (publish root)
iseta/_routes.json             # only /api/* invokes Functions → static stays free
scripts/dev-server.js          # local dev server (site + the two API routes)
```

## 2. Create the Pages project

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → connect
the git repository (or use direct upload, see below) with:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `iseta` |
| Root directory | *(leave empty — repository root)* |

`functions/` is detected automatically at the project root and `_routes.json`
inside `iseta/` keeps every non-`/api/*` request on the free unlimited static
path, so only chat/embedding calls consume the Functions quota
(100,000 requests/day on the free plan).

### Direct upload alternative

```bash
npx wrangler@3 pages deploy iseta --project-name iseta
```

`wrangler` also picks up `./functions` from the current directory. (Use
wrangler 3 on Node 20; wrangler 4 requires Node 22+.) The bundle was verified
to compile with `wrangler pages functions build`.

## 3. Add the API key as a secret

Pages project → **Settings** → **Variables and Secrets** → **Add**:

- Name: `OPENROUTER_API_KEY`
- Value: the new key
- Type: **Secret** (encrypted), then redeploy so the function sees it.

The two models are pinned server-side in `lib/openrouter.js`
(`openai/gpt-4o-mini` for answers, `qwen/qwen3-embedding-8b` for retrieval).
Client-supplied model names are ignored.

## 4. Local testing

The site cannot be opened with `firefox ./index.html` any more than before:
`file://` blocks `fetch()`, so the documentation index and vectors never load.
Use the bundled dev server, which serves `iseta/` **and** the two API routes:

```bash
# once: put the key in .dev.vars at the repo root (git-ignored)
echo 'OPENROUTER_API_KEY=sk-or-...' > .dev.vars

node scripts/dev-server.js        # http://localhost:8080/
```

Alternative, with Cloudflare's runtime (reads `.dev.vars` as well):

```bash
npx wrangler@3 pages dev iseta    # wrangler 4 requires Node >= 22
```

Rebuilding the retrieval data (only needed after editing `documentation/*.md`):

```bash
node scripts/build-index.js
node scripts/embed-vectors.js     # uses .dev.vars / OPENROUTER_API_KEY
```

## 5. Abuse protection (recommended)

The proxy hides the key but not the bill: anyone can still send messages to
`/api/chat`. In addition to the OpenRouter monthly limit:

- Cloudflare dashboard → **Security** → **WAF** → **Rate limiting rules**:
  match `URI Path` starts with `/api/` and allow e.g. 20 requests per minute
  per IP. Free plan includes one rate-limiting rule.
- Optionally add Cloudflare **Turnstile** to the widget later if abuse appears.
- Hard caps already enforced in the functions: 1024 output tokens, max 24
  messages per request, 4000 characters per message, ≤8 embedding inputs.

## 6. Cost expectations

A question costs one embeddings call (~20 tokens) plus one chat completion
with the injected documentation (a few thousand input tokens).
With `openai/gpt-4o-mini` that is well under **US$0.001 per question**, and
OpenRouter's prompt caching reduces repeat cost. The free Pages tiers
(static unlimited, 100k function requests/day) cover typical institute traffic.

## 7. Notes and caveats

- Streaming is end-to-end: OpenRouter SSE → proxy rewrites to Deep Chat's
  `data: {"text": "..."}` format → widget renders progressively.
- The proxy keeps the SSE connection open while the model answers; Cloudflare's
  free CPU limit is 10 ms per request but streaming I/O does not consume CPU,
  so this is not a problem for normal answers.
- If the site were ever hosted under a sub-path (e.g. `example.com/iseta/`)
  instead of a domain root, change the `/api/chat` and `/api/embeddings`
  constants in `chat.js` accordingly.
- Functions "fail open" (Settings → Runtime) keeps the static site online if
  the daily function quota is exhausted; the chat will show an error until
  the quota resets.
- The chat works with retrieval disabled if `docs-vectors.bin` cannot be
  fetched, but the widget itself requires the API routes.
