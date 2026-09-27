'use strict';
// `askai suggest [dir]`: look at what a directory mostly contains and name the profile that fits. Read-only, shallow (three
// levels, at most 3000 entries, dependency and build directories skipped), and only a heuristic: the result is a starting
// point for `askai install --profile <name>`, not a measurement.
const fs = require('fs');
const path = require('path');

const CODE = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'cs', 'rb', 'php', 'c', 'cc', 'cpp', 'h', 'hpp', 'scala', 'dart']);
const TEXT_DOC = new Set(['md', 'mdx', 'rst', 'adoc', 'txt']);
const BINARY_DOC = new Set(['pdf', 'docx', 'pptx', 'xlsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.gradle', 'Pods', '.next']);
const MAX_DEPTH = 3, MAX_ENTRIES = 3000;

function scan(dir) {
  const c = { code: 0, textDocs: 0, binaryDocs: 0, entries: 0, truncated: false };
  const walk = (d, depth) => {
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const it of items) {
      if (c.entries >= MAX_ENTRIES) { c.truncated = true; return; }
      c.entries++;
      if (it.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(it.name) && !it.name.startsWith('.')) walk(path.join(d, it.name), depth + 1);
        continue;
      }
      const ext = path.extname(it.name).slice(1).toLowerCase();
      if (CODE.has(ext)) c.code++;
      else if (TEXT_DOC.has(ext)) c.textDocs++;
      else if (BINARY_DOC.has(ext)) c.binaryDocs++;
    }
  };
  walk(dir, 1);
  return c;
}

// counts -> { profile, reason }. A README in a code project is normal, so text documents alone never outvote code.
function recommend(c) {
  const docs = c.textDocs + c.binaryDocs;
  if (c.code >= 3 && c.binaryDocs >= 3) return { profile: 'full', reason: `${c.code} code files and ${c.binaryDocs} PDF/Office files: both code navigation and document conversion apply` };
  if (c.code >= 3 && c.code >= c.binaryDocs) return { profile: 'coding', reason: `${c.code} code files against ${c.binaryDocs} PDF/Office files` };
  if (docs >= 3) return { profile: 'docs', reason: `${docs} document files (${c.textDocs} text, ${c.binaryDocs} PDF/Office) and only ${c.code} code files` };
  return { profile: 'minimal', reason: `too few code or document files to tell (${c.code} code, ${docs} documents)` };
}

function suggest(dir) {
  const counts = scan(dir);
  return { dir, counts, ...recommend(counts) };
}

module.exports = { scan, recommend, suggest };
