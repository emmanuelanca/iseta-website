# Deployment — Cloudflare (Workers or Pages)

The repository supports both deployment models; the backend code is shared.

| Model | Entry point | Files |
|---|---|---|
| **Workers + Static Assets** (Cloudflare's current path) | `worker/index.js` | `wrangler.jsonc`, `assets.directory = ./iseta` |
| **Pages + Functions** | `functions/api/*.js` | `iseta/_routes.json` |

The chat never talks to OpenRouter directly:

```
Browser ──/api/chat────────► proxy ──► openrouter.ai chat completions
Browser ──/api/embeddings──► proxy ──► openrouter.ai embeddings
```

The key lives only in the Cloudflare secret and in the local, git-ignored
`.dev.vars`.

## 0. Before anything else: rotate the API key

The original `chat.js` shipped a real key to every visitor and that key is
still in older git objects (the public history was rewritten, but revoke it
anyway). Create a new key at <https://openrouter.ai/keys>, store it only in
Cloudflare, never in client code, and set a monthly spending limit.

## 1. Repository layout

```
wrangler.jsonc                 # Workers config: main + static assets
worker/index.js                # Worker router: /api/* → handlers, else assets
functions/api/chat.js          # proxy: chat completions (streaming)
functions/api/embeddings.js    # proxy: query embeddings
lib/openrouter.js              # persona, model allow-list, shared helpers
iseta/                         # the mirrored site (assets root)
iseta/_routes.json             # Pages only: restrict Functions to /api/*
scripts/dev-server.js          # local server: site + /api routes
```

## 2. Option A — Workers + Static Assets (recommended)

### 2.1 Connect the repository

**Workers & Pages → Create → Workers → Connect to Git** (or open the
existing Worker → **Settings → Build**):

| Setting | Value |
|---|---|
| Repository | `emmanuelanca/iseta-website` |
| Git branch | `main` |
| Build command | *(empty)* |
| Deploy command | `npx wrangler deploy` |

The first deploy with `worker/index.js` present turns the project from a
static-assets-only Worker into a real Worker, which is what allows
environment variables.

> If your Worker has a different name, edit `name` in `wrangler.jsonc` to
> match it (or rename the Worker). `wrangler deploy` deploys to the name in
> the config.

### 2.2 Why you saw "Variables cannot be added to a Worker that only has static assets"

A Worker with no `main` entry point only stores files: there is no script to
receive bindings, so Cloudflare blocks variables/secrets. The repo now has
`main: "worker/index.js"`, so the next successful deploy enables the
**Settings → Variables and Secrets** tab.

### 2.3 Add the secret

**Worker → Settings → Variables and Secrets → Add**:

- Name: `OPENROUTER_API_KEY`
- Value: the new key
- Type: **Secret**
- Environment: **Production** (and **Preview** if you will test branches)

Save and deploy again. Secrets added after a deploy require a new deployment
to be visible to the script ("Retry deployment" is enough).

### 2.4 How requests are served

- A request that matches a file in `iseta/` is served by Cloudflare's asset
  layer **without running the Worker** (no usage cost, no cold start).
- `/api/chat` and `/api/embeddings` match no asset, so they reach
  `worker/index.js`, which forwards them to the proxies.
- Anything else missing falls back to `env.ASSETS.fetch()`, which returns the
  normal 404.

No `_routes.json` is involved in this model; it stays in the repo for Pages.

## 3. Option B — Pages + Functions

**Workers & Pages → Create application → Pages → Connect to Git**:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `iseta` |
| Root directory | *(empty)* |

Cloudflare detects `functions/` at the repository root, and
`iseta/_routes.json` limits Functions to `/api/*` so static traffic stays on
the unlimited free path. Add the same `OPENROUTER_API_KEY` secret (Production
**and** Preview) and redeploy.

Note: deploy either Workers **or** Pages, not both pointing at the same
domain. Pages and Workers are separate products.

## 4. Local testing

`firefox ./index.html` cannot work (file:// blocks fetch and there is no
`/api`), and a plain static server has no API routes either. Use:

```bash
node scripts/dev-server.js        # http://localhost:8080/
```

It serves `iseta/` and mounts the same two handlers under `/api/`. It reads
`.dev.vars` (git-ignored) or `OPENROUTER_API_KEY` from the environment.

Alternative, to exercise the real Worker router locally:

```bash
npx wrangler@3 dev                # Node 20; wrangler 4 needs Node 22+
```

Rebuilding the retrieval data after editing `documentation/*.md`:

```bash
node scripts/build-index.js
node scripts/embed-vectors.js     # uses .dev.vars / OPENROUTER_API_KEY
```

## 5. Abuse protection (recommended)

The proxy hides the key but not the bill. In addition to the OpenRouter
monthly limit:

- Cloudflare → **Security → WAF → Rate limiting rules**: match `URI Path`
  starts with `/api/` and allow ~20 requests/minute per IP (free plan
  includes one rule).
- Caps already enforced server-side: 1024 output tokens, 24 messages per
  request, 4000 characters per message, 16000 for injected context, ≤8
  embedding inputs.
- Add Turnstile later if abuse appears.

## 6. Cost expectations

One question = one embeddings call (~20 tokens) + one chat completion with
the injected documentation (a few thousand input tokens). With
`openai/gpt-4o-mini` that is well under **US$0.001 per question**, and
OpenRouter's prompt caching reduces repeat cost. Static asset requests on
Workers do not consume Worker invocations.

## 7. Notes and caveats

- Streaming is end-to-end: OpenRouter SSE → proxy rewrites to Deep Chat's
  `data: {"text": "..."}` format → widget renders progressively.
- The proxy keeps the SSE connection open while the model answers; CPU usage
  is minimal because it is I/O.
- If the site were ever hosted under a sub-path (e.g. `example.com/iseta/`)
  instead of a domain root, change the `/api/chat` and `/api/embeddings`
  constants in `chat.js`.
- `wrangler.jsonc` uses `not_found_handling: "none"`: missing paths reach the
  Worker and end up as a 404 from the asset layer.
- The chat degrades to lexical (BM25) retrieval if the embeddings call fails,
  but it always needs the `/api` routes.
