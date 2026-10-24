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
function wrap(value, width) {
  const out = [];
  width = Math.max(1, width);
  for (let line of String(value == null ? '' : value).split(/\r?\n/)) {
    while (line.length > width) {
      let cut = line.lastIndexOf(' ', width);
      if (cut < 1) cut = width;
      out.push(line.slice(0, cut)); line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out;
}
// Wrap cells rather than truncating evidence. Narrow terminals use labeled records.
function table(headers, rows, options = {}) {
  const width = Math.max(20, Number(options.width || process.stdout.columns) || 120);
  if (width < headers.length * 14) {
    return rows.flatMap((row, i) => [ ...(i ? [''] : []), ...headers.flatMap((h, c) => wrap(`${h}: ${row[c] == null ? '' : row[c]}`, width)) ]);
  }
  const widths = headers.map((h, i) => options.widths ? Math.max(1, Number(options.widths[i]) || 1) : Math.max(h.length, ...rows.map(r => String(r[i] == null ? '' : r[i]).length), 1));
  while (widths.reduce((a, b) => a + b, 0) + 3 * (headers.length - 1) > width) {
    const i = widths.indexOf(Math.max(...widths)); widths[i]--;
  }
  const render = row => {
    const cells = headers.map((_, c) => wrap(row[c], widths[c]));
    return Array.from({length:Math.max(...cells.map(c => c.length))}, (_, n) => cells.map((c, i) => (c[n] || '').padEnd(widths[i])).join(' | ').trimEnd());
  };
  return [...render(headers), widths.map(w => '-'.repeat(w)).join('-+-'), ...rows.flatMap(render)];
}
module.exports = { layout, zip, lines, wrap, table };
