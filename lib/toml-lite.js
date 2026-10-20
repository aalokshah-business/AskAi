'use strict';
// Just enough TOML for askai's add-if-absent edits of Codex's ~/.codex/config.toml. It never parses or re-serializes the file:
// it finds a `key = ...` line in the top-level region (before the first [table]) or inside one named [table], and inserts or
// removes single lines. Comments, ordering and everything else in the file are left byte-for-byte as they were.
//
// Values are written as TOML literals by `literal()`: strings quoted, numbers and booleans bare.

const NL = '\n';
const literal = v => (Array.isArray(v) ? `[${v.map(x => JSON.stringify(x)).join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : String(v));
const keyRe = key => new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
const isHeader = line => /^\s*\[\[?[^\]]+\]\]?\s*(#.*)?$/.test(line);
const headerName = line => (/^\s*\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line) || [])[1];

function splitLines(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : NL;
  return { lines: text.length ? text.split(/\r?\n/) : [], eol };
}

// [start, end) line range of a region: table === null is the top-level region.
function region(lines, table) {
  if (table === null) {
    const first = lines.findIndex(isHeader);
    return [0, first < 0 ? lines.length : first];
  }
  const start = lines.findIndex(l => isHeader(l) && headerName(l) === table && !/^\s*\[\[/.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && isHeader(l));
  if (end < 0) end = lines.length;
  return [start + 1, end];
}

// The raw value text of `key` in a region, or undefined.
function get(text, key, table = null) {
  const { lines } = splitLines(text || '');
  const r = region(lines, table);
  if (!r) return undefined;
  for (let i = r[0]; i < r[1]; i++) {
    if (keyRe(key).test(lines[i])) return lines[i].replace(keyRe(key), '').replace(/\s+#.*$/, '').trim();
  }
  return undefined;
}

// Add `key = value` when the region has no such key. Returns { text, changed }.
function setIfAbsent(text, key, value, table = null) {
  const src = text || '';
  if (get(src, key, table) !== undefined) return { text: src, changed: false };
  const { lines, eol } = splitLines(src);
  const line = `${key} = ${literal(value)}`;
  if (table === null) {
    const [, end] = region(lines, null);
    // Insert after the last non-blank line of the top-level region, so a blank line before the first table is kept.
    let at = end;
    while (at > 0 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, line);
  } else {
    const r = region(lines, table);
    if (r) {
      let at = r[1];
      while (at > r[0] && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, line);
    } else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length) lines.push('');
      lines.push(`[${table}]`, line);
    }
  }
  let out = lines.join(eol);
  if (!out.endsWith(eol)) out += eol;
  return { text: out, changed: true };
}

// Remove `key` only when it still holds `value` (what askai wrote). An emptied table header askai created is left alone:
// removing headers could drop comments that belong to the user.
function removeIfEqual(text, key, value, table = null) {
  const src = text || '';
  const cur = get(src, key, table);
  if (cur === undefined || cur !== literal(value)) return { text: src, changed: false };
  const { lines, eol } = splitLines(src);
  const r = region(lines, table);
  const i = lines.findIndex((l, idx) => idx >= r[0] && idx < r[1] && keyRe(key).test(l));
  lines.splice(i, 1);
  return { text: lines.join(eol), changed: true };
}

// Remove a [table] header when nothing but blank lines or comments is left under it (only for tables askai created).
function removeTableIfEmpty(text, table) {
  const { lines, eol } = splitLines(text || '');
  const r = region(lines, table);
  if (!r || lines.slice(r[0], r[1]).some(l => l.trim() && !l.trim().startsWith('#'))) return { text: text || '', changed: false };
  let start = r[0] - 1;
  while (start > 0 && !lines[start - 1].trim()) start--;
  lines.splice(start, r[1] - start);
  let out = lines.join(eol);
  if (out && !out.endsWith(eol)) out += eol;
  return { text: out, changed: true };
}

// True when a [table] exists, for example [mcp_servers.serena].
const hasTable = (text, table) => !!region(splitLines(text || '').lines, table);

module.exports = { get, setIfAbsent, removeIfEqual, removeTableIfEmpty, hasTable, literal };
