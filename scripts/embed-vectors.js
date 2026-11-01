#!/usr/bin/env node
/**
 * embed-vectors.js — embeds the chunks of docs-index.json via OpenRouter's
 * embeddings endpoint (qwen/qwen3-embedding-8b, 4096 dims per vector) and
 * writes a compact binary vector store consumed by the chat widget for
 * semantic (cosine similarity) retrieval.
 *
 * Usage: node scripts/embed-vectors.js
 *
 * - Vectors are L2-normalized and quantized to int8 + per-vector scale
 *   (4x smaller than float32; cosine ranking quality is preserved).
 * - Embeddings are cached per chunk-hash (documentation/.embeddings-cache.json)
 *   so re-runs only embed new or modified documents.
 * - Binary layout: [count: u32][dims: u32] then per vector: [scale: f32][int8 x dims]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INDEX_PATH = path.join(__dirname, '..', 'iseta', 'wp-content', 'iseta-chat', 'docs-index.json');
const VECTORS_PATH = path.join(__dirname, '..', 'iseta', 'wp-content', 'iseta-chat', 'docs-vectors.bin');
const CACHE_PATH = path.join(__dirname, '.embeddings-cache.json');

const OPENROUTER_KEY = 'REDACTED';
const EMBED_MODEL = 'qwen/qwen3-embedding-8b';
const EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';
const BATCH_SIZE = 32;

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

// q = round(v * 127); on read the browser re-normalizes, so storing the
// max-abs scale separately is unnecessary for cosine ranking.
function quantize(unitVec) {
  return unitVec.map((v) => Math.max(-127, Math.min(127, Math.round(v * 127))));
}

async function embedBatch(texts) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter embeddings failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    throw new Error('Unexpected embeddings response shape');
  }
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function writeStore(dims, vecs) {
  const count = vecs.length;
  const stride = dims; // int8 components per vector
  const total = 8 + stride * count;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(count, 0);
  buf.writeUInt32LE(dims, 4);
  for (let i = 0; i < count; i++) {
    const base = 8 + i * stride;
    for (let j = 0; j < dims; j++) {
      buf.writeInt8(vecs[i][j], base + j);
    }
  }
  fs.writeFileSync(VECTORS_PATH, buf);
  return buf.length;
}

async function main() {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  if (!index.chunks || !index.chunks.length) {
    console.error('docs-index.json has no chunks — run build-index.js first.');
    process.exit(1);
  }

  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) { /* fresh cache */ }

  const hashes = index.chunks.map((c) => sha1(c.t + '|' + (c.h || '') + '|' + index.docs[c.d].title));

  // collect what needs embedding (cache miss), preserving order
  const missing = [];
  index.chunks.forEach((_, i) => {
    if (cache[hashes[i]] === undefined) missing.push(i);
  });

  console.log(`${index.chunks.length} chunks | cache hits: ${index.chunks.length - missing.length} | to embed: ${missing.length}`);

  // fetch in batches until every missing chunk has an embedding
  const vectorsByIndex = {};
  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    const group = missing.slice(start, start + BATCH_SIZE);
    const texts = group.map((i) => index.chunks[i].t);
    const embs = await embedBatch(texts);
    embs.forEach((emb, j) => {
      const i = group[j];
      vectorsByIndex[i] = emb;
      cache[hashes[i]] = quantize(normalize(emb));
    });
    console.log(`  embedded batch ${start / BATCH_SIZE + 1}/${Math.ceil(missing.length / BATCH_SIZE)} (${group.length} chunks)`);
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));

  // assemble final store (quantized vectors for all chunks)
  const all = index.chunks.map((_, i) => cache[hashes[i]]);
  if (all.some((v) => !v)) {
    console.error('internal: missing embeddings for some chunks');
    process.exit(1);
  }
  const dims = all[0].length;
  if (!all.every((v) => v.length === dims)) {
    console.error('internal: inconsistent vector dimensions');
    process.exit(1);
  }

  const bytes = writeStore(dims, all);
  console.log(`wrote ${VECTORS_PATH.split('/').pop()}: ${index.chunks.length} vecs x ${dims} dims = ${Math.round(bytes / 1024)} KB`);

  // record model/dims in the index so the browser knows how to query
  index.vectors = { model: EMBED_MODEL, dims, count: index.chunks.length };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  console.log(`docs-index.json updated with vectors meta (model: ${EMBED_MODEL}, dims: ${dims})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
