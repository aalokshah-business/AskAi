'use strict';
// One-file reader for knowledge/*.yaml. Supports key: value, a list, and one nested map. No other YAML.
const fs = require('fs');
const path = require('path');

function parse(text) {
  const root = {};
  const lines = String(text).split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (!raw.trim() || /^\s*#/.test(raw) || raw.startsWith(' ')) continue;
    const cut = raw.indexOf(':');
    if (cut < 0) continue;
    const key = raw.slice(0, cut).trim();
    const value = raw.slice(cut + 1).trim();
    if (value) { root[key] = value; continue; }
    const block = [];
    while (n + 1 < lines.length && (lines[n + 1].startsWith('  ') || !lines[n + 1].trim())) {
      n++;
      if (lines[n].trim()) block.push(lines[n]);
    }
    if (block.length && block[0].trim().startsWith('- ')) root[key] = block.map(l => l.trim().replace(/^- /, ''));
    else {
      const map = {};
      for (const l of block) {
        const c = l.indexOf(':');
        map[l.slice(0, c).trim()] = l.slice(c + 1).trim();
      }
      root[key] = map;
    }
  }
  return root;
}
function entry(file) {
  const doc = parse(fs.readFileSync(file, 'utf8'));
  return { id: doc.id, title: doc.title, tags: doc.tags || [], rule: doc.rule, why: doc.why, how: doc.how || {}, auto: doc.auto || null };
}
function load(dir, id) {
  const file = path.join(dir, `${id}.yaml`);
  return fs.existsSync(file) ? entry(file) : null;
}
function loadAll(dir) {
  const order = fs.readFileSync(path.join(dir, 'order.txt'), 'utf8')
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const files = new Set(fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => f.slice(0, -5)));
  const missing = order.filter(id => !files.has(id));
  const extra = [...files].filter(id => !order.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`knowledge order mismatch: missing ${missing.join(',') || '-'} extra ${extra.join(',') || '-'}`);
  }
  return order.map(id => entry(path.join(dir, `${id}.yaml`)));
}
module.exports = { parse, entry, load, loadAll };
