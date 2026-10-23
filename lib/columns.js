'use strict';
// Shared column layout for help, ask topics, profiles, docs, and plugins ready.
function layout(width) {
  const raw = Number(width) || 80;
  if (raw < 60) return { cols: 1, width: raw };
  const w = Math.min(raw, 120);
  return { cols: w >= 100 ? 3 : 2, width: w };
}
function zip(blocks, cols, width) {
  const colW = Math.max(20, Math.floor(width / cols));
  const out = [];
  for (let i = 0; i < blocks.length; i += cols) {
    const slice = blocks.slice(i, i + cols);
    const h = Math.max(...slice.map(b => b.length));
    for (let r = 0; r < h; r++) {
      let line = '';
      for (let c = 0; c < slice.length; c++) line += (slice[c][r] || '').padEnd(colW).slice(0, colW);
      out.push(line.trimEnd());
    }
    out.push('');
  }
  return out;
}
function lines(items, width) {
  const list = (items || []).map(s => String(s));
  const { cols, width: w } = layout(width);
  const colW = Math.max(20, Math.floor(w / cols));
  if (cols === 1 || list.some(s => s.length >= colW)) return list;
  return zip(list.map(s => [s]), cols, w).filter(l => l.length);
}
module.exports = { layout, zip, lines };
