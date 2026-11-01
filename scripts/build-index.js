#!/usr/bin/env node
/**
 * build-index.js — kite documentation/*.md into a browser-ready index for the
 * ISETA chat widget (client-side BM25 retrieval + top-K context injection).
 *
 * Usage: node scripts/build-index.js
 * Output: iseta/wp-content/iseta-chat/docs-index.json
 *
 * Chunking strategy: split each markdown file on heading lines, build the
 * heading path (section metadata), then cut oversized sections into
 * overlapping chunks on paragraph boundaries.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'documentation');
const OUT_PATH = path.join(__dirname, '..', 'iseta', 'wp-content', 'iseta-chat', 'docs-index.json');

const MAX_CHUNK_CHARS = 800;   // target chunk size (~200 tokens)
const MAX_SECTION_CHARS = 1400; // sections below this stay whole
const OVERLAP_CHARS = 120;

// explicit titles override auto-detection; add one line here when
// you drop a new .md into documentation/ (auto-detection keeps working
// for docs whose carrera name appears in ALL-CAPS headings)
const TITLE_OVERRIDES = {
  'disenio-curricular-gastronomia.md':
    'Diseño Curricular — Tecnicatura Superior Analista de Servicios Gastronómicos',
  'disenio-curricular-higiene-seguridad.md':
    'Diseño Curricular — Tecnicatura Superior en Higiene y Seguridad en el Trabajo',
  'sobre-nosotros.md': 'Información Institucional — ¿Quiénes somos?',
};

// friendly labels are derived from the document itself; fallback below
function friendlyTitle(fileName, firstLines) {
  if (TITLE_OVERRIDES[path.basename(fileName)]) {
    return TITLE_OVERRIDES[path.basename(fileName)];
  }
  // find the line naming the carrera and cut the career name at the first
  // lowercase character (official headings are ALL-CAPS)
  const titleLine = firstLines
    .map((l) => {
      const m = l.match(/TEC(?:H?NICATURA|\.|NICO)?\.?\s*(?:SUPERIOR|SUP\.?)?\s*(?:EN\s+)?([A-ZÁÉÍÓÚÑÜ\s()/.-]+)/i);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .shift();

  if (titleLine) {
    let career = titleLine.trim();
    const lower = career.search(/[a-z]/);
    career = (lower > 10 ? career.slice(0, lower) : career).replace(/[\s(/.\-–—]+$/, '');
    return 'Diseño Curricular — ' + titleCase(career);
  }
  return 'Documento — ' + path.basename(fileName, '.md');
}

function titleCase(s) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\b\.\b|\.\s*/g, '.');
}

function splitSection(source, section, text) {
  text = text.trim();
  if (!text) return [];
  if (text.length <= MAX_SECTION_CHARS) {
    return [{ t: text }];
  }
  // split on paragraphs, pack into windows of MAX_CHUNK_CHARS with overlap
  const paras = text.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) chunks.push({ t: trimmed });
    buf = '';
  };
  for (const p of paras) {
    if (buf && buf.length + p.length > MAX_CHUNK_CHARS) {
      flush();
      // keep small tail overlap so sentences cut by windows stay findable
      buf = buf.slice(-OVERLAP_CHARS);
    }
    buf += (buf ? '\n\n' : '') + p;
  }
  flush();
  return chunks.map((c) => ({ t: c.t }));
}

function build() {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.toLowerCase().endsWith('.md')).sort();
  if (!files.length) {
    console.error('No .md files found in documentation/');
    process.exit(1);
  }

  const docs = [];
  const chunks = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const lines = raw.split(/\r?\n/);
    const title = friendlyTitle(file, lines.slice(0, 60));
    const docId = docs.length;
    docs.push({ id: docId, title });

    let section = []; // heading path levels {level: num, text: string}
    let buf = [];
    const flush = () => {
      const text = buf.join('\n');
      const label = section.map((h) => h.text).join(' › ');
      for (const c of splitSection(path.basename(file), label, text)) {
        chunks.push({ d: docId, h: label, t: c.t });
      }
      buf = [];
    };

    for (const line of lines) {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        flush();
        const level = m[1].length;
        while (section.length && section[section.length - 1].level >= level) section.pop();
        section.push({ level, text: m[2].trim() });
      } else {
        buf.push(line);
      }
    }
    flush();

    console.log(`- ${file} -> "${title}"`);
  }

  const totalChars = chunks.reduce((a, c) => a + c.t.length, 0);
  const out = {
    version: 1,
    docs,
    chunking: { target: MAX_CHUNK_CHARS, overlap: OVERLAP_CHARS },
    chunks,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`\n${chunks.length} chunks, ${totalChars} chars of content, ~${Math.round(totalChars / 4)} tokens`);
  console.log('wrote ' + OUT_PATH + ' (' + Math.round(fs.statSync(OUT_PATH).size / 1024) + ' KB)');
}

build();
