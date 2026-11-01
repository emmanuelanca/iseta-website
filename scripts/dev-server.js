#!/usr/bin/env node
/**
 * Local dev server: serves the mirrored site (iseta/) over HTTP and mounts
 * the same handlers Cloudflare Pages runs in production (/api/chat and
 * /api/embeddings). Use this instead of `firefox ./index.html` or a plain
 * static server: file:// blocks fetch() and a plain static server has no API
 * routes, so the chat's documentation retrieval would silently degrade.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node scripts/dev-server.js
 *   # or put the key in .dev.vars (KEY=value) and just:
 *   node scripts/dev-server.js
 *
 * Then open http://localhost:8080/ (override with PORT=...).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'iseta');
const PORT = Number(process.env.PORT || 8080);

// minimal .dev.vars loader (same file wrangler uses)
const devVarsPath = path.join(__dirname, '..', '.dev.vars');
if (fs.existsSync(devVarsPath)) {
  for (const line of fs.readFileSync(devVarsPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const env = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.bin': 'application/octet-stream',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
};

async function loadHandler(file, name) {
  const mod = await import(path.join(__dirname, '..', 'functions', 'api', file));
  return mod[name];
}

(async () => {
  const handlers = {
    '/api/chat': await loadHandler('chat.js', 'onRequestPost'),
    '/api/embeddings': await loadHandler('embeddings.js', 'onRequestPost'),
  };

  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    const handler = handlers[urlPath.replace(/\/$/, '')];
    if (handler) {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Método no permitido' }));
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request('http://localhost' + req.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks),
      });
      try {
        const response = await handler({ request, env });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error interno del servidor de desarrollo' }));
      }
      return;
    }

    // static files, with directory -> index.html
    let filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });

  server.listen(PORT, () => {
    console.log(`ISETA site:  http://localhost:${PORT}/`);
    console.log(`API routes:  http://localhost:${PORT}/api/chat, /api/embeddings`);
    if (!env.OPENROUTER_API_KEY) {
      console.warn('\n⚠  OPENROUTER_API_KEY is not set: the chat will answer with an error.');
      console.warn('   Set it as an env var or in .dev.vars at the repo root.\n');
    }
  });
})();
