'use strict';
// One findings list per context and folder. check renders this list; it does not collect a second time.
const cache = new WeakMap();

const KNOWN = [
  [/HANDOFF\.md is the empty template/, 'handoff.empty'],
  [/no \.ai-work\/HANDOFF\.md/, 'handoff.missing'],
  [/handoff is stale/, 'handoff.stale'],
  [/handoff is fresh/, 'handoff.fresh'],
  [/ANTHROPIC_API_KEY/, 'billing.anthropic-key'],
  [/ANTHROPIC_BASE_URL/, 'billing.anthropic-proxy'],
  [/OPENAI_API_KEY/, 'billing.openai-key'],
  [/useG1Credits is true/, 'billing.g1-credits'],
  [/default model is .+most expensive/, 'model.default-expensive'],
  [/no default model/, 'model.default-missing'],
  [/no AGENTS\.md/, 'repo.agents-missing'],
  [/– not installed/, null],
];

function slug(msg) {
  const s = String(msg).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 48);
  return s || 'finding';
}

function idFor(row) {
  for (const [re, id] of KNOWN) {
    if (!re.test(row.msg)) continue;
    if (id) return id;
    return `host.absent.${row.area}`;
  }
  return slug(row.msg);
}

function place(row) {
  if (row.area === 'repo') return { area: 'repo', host: '' };
  if (row.area === 'billing') return { area: 'cost', host: /OPENAI/.test(row.msg) ? 'codex' : 'claude' };
  if (row.area === 'time') return { area: 'cost', host: 'claude' };
  if (row.area === 'codex') return { area: 'config', host: 'codex' };
  if (row.area === 'antigravity') return { area: 'config', host: 'agy' };
  if (row.area === 'cursor') return { area: 'config', host: 'cursor' };
  if (row.area === 'claude') return { area: 'config', host: 'claude' };
  return { area: 'config', host: row.area || '' };
}

const SEVERITY = { fail: 'now', warn: 'later', info: 'info', ok: 'ok' };

function toFinding(row, seen) {
  const where = place(row);
  let id = idFor(row);
  const n = seen.get(id) || 0;
  seen.set(id, n + 1);
  if (n) id = `${id}.${n + 1}`;
  const finding = {
    id,
    area: where.area,
    host: where.host,
    severity: SEVERITY[row.level] || 'info',
    message: row.msg,
    fix: row.fix || '',
    autoFix: /^askai (scaffold|init|session init)\b/.test(row.fix || ''),
    group: row.area,
  };
  if (row.estTokens) finding.estTokens = row.estTokens;
  return finding;
}

function collectFindings(ctx, dir) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('collectFindings needs a context');
  let byDir = cache.get(ctx);
  if (!byDir) { byDir = new Map(); cache.set(ctx, byDir); }
  const key = String(dir || '');
  if (byDir.has(key)) return byDir.get(key);
  const check = require('./check');
  const raw = [...check.machine(ctx), ...(dir ? check.repo(dir) : [])];
  const seen = new Map();
  const out = raw.map(row => toFinding(row, seen));
  byDir.set(key, out);
  return out;
}

function forget(ctx, dir) {
  const byDir = ctx && cache.get(ctx);
  if (!byDir) return;
  if (dir === undefined) cache.delete(ctx);
  else byDir.delete(String(dir || ''));
}

module.exports = { collectFindings, forget };
