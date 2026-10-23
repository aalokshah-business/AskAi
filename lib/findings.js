'use strict';
// One findings list per context and folder. check, doctor, status, and todo each render a view.
// None of them scans again until the context is forgotten or a watched file, profile, or done-list changes.
const fs = require('fs');
const path = require('path');
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
  [/container home and are lost on rebuild/, 'env.ephemeral-home'],
  [/MCP servers are on and unused/, 'mcp.unused'],
  [/is a large file/, 'ctx.large-file'],
  [/agents\.drift/, 'agents.drift'],
  [/effort max/, 'effort.max'],
  [/no default effort/, 'effort.missing'],
  [/reasoning effort/, 'effort.default-high'],
  [/profile\.legacy-max/, 'profile.legacy-max'],
  [/lsp\.clangd-inactive/, 'lsp.clangd-inactive'],
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
  if (row.estTokens != null) finding.estTokens = row.estTokens;
  if (row.evidence) finding.evidence = row.evidence;
  return finding;
}

function slot(ctx) {
  let s = cache.get(ctx);
  if (!s || !s.dirs) { s = { dirs: new Map(), doctor: null, doctorStamp: '', cost: new Map(), statusRows: null, statusStamp: '' }; cache.set(ctx, s); }
  return s;
}

function collectFindings(ctx, dir) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('collectFindings needs a context');
  const box = slot(ctx);
  const key = String(dir || '');
  if (box.dirs.has(key)) return box.dirs.get(key);
  const check = require('./check');
  const raw = [...check.machine(ctx), ...(dir ? check.repo(dir, ctx) : [])];
  const seen = new Map();
  const out = raw.map(row => toFinding(row, seen));
  box.dirs.set(key, out);
  return out;
}

function watched(ctx) {
  const p = ctx.paths || {};
  const files = [p.settings, p.claudeMd, p.manifest, p.userJson];
  if (ctx.cursorPaths) files.push(ctx.cursorPaths.mcp, ctx.cursorPaths.hooks);
  if (ctx.agyPaths) files.push(ctx.agyPaths.cliSettings, ctx.agyPaths.mcp);
  if (ctx.codexPaths) files.push(ctx.codexPaths.agentsMd, ctx.codexPaths.config);
  return files.filter(Boolean).map(f => {
    try { const st = fs.statSync(f); return `${f}:${st.mtimeMs}:${st.size}`; } catch (_) { return `${f}:0`; }
  }).join('|');
}

function doctorStamp(ctx) {
  const mem = `${ctx.manifest && ctx.manifest.profile}|${ctx.nodeVersion}|${ctx.which && ctx.which('winget') ? 1 : 0}|${process.env.ANTHROPIC_API_KEY ? 1 : 0}|${process.env.ANTHROPIC_BASE_URL || ''}|${process.env.OPENAI_API_KEY ? 1 : 0}`;
  return `${mem}|${watched(ctx)}`;
}

function healthFinding(row) {
  return {
    id: row.id,
    area: 'tools',
    host: 'claude',
    severity: SEVERITY[row.level] || 'info',
    message: row.msg,
    fix: '',
    autoFix: false,
    group: 'doctor',
  };
}

function fileStamp(p) {
  if (!p) return '0';
  try { const st = fs.statSync(p); return `${st.mtimeMs}:${st.size}`; } catch (_) { return '0'; }
}
function todoStamp(ctx, dir) {
  const todo = require('./todo');
  let done = '';
  try { done = fs.readFileSync(todo.doneFile(ctx), 'utf8'); } catch (_) { /* none yet */ }
  const repo = dir ? ['AGENTS.md', 'docs/ai/PROJECT_MAP.md', 'docs/ai/ARCHITECTURE.md', 'docs/ai/FEATURES.md', 'graphify-out/GRAPH_REPORT.md']
    .map(n => fileStamp(path.join(dir, n))).join(',') : '';
  const env = `${process.env.ANTHROPIC_API_KEY ? 1 : 0}|${process.env.ANTHROPIC_BASE_URL || ''}|${process.env.OPENAI_API_KEY ? 1 : 0}`;
  return `${String(dir || '')}|${done}|${repo}|${env}|${statusStamp(ctx)}`;
}
function statusStamp(ctx) {
  const manifest = ctx.manifest || {};
  const opts = ctx.opts || {};
  const ids = manifest.components && typeof manifest.components === 'object' ? Object.keys(manifest.components).sort().join(',') : '';
  const homes = `${ctx.cursorPaths ? 1 : 0}${ctx.codexPaths ? 1 : 0}${ctx.agyPaths ? 1 : 0}`;
  return `${opts.profile || ''}|${manifest.profile || ''}|${manifest.target || ''}|${ids}|${homes}|${doctorStamp(ctx)}`;
}

function view(ctx, name, dir) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('view needs a context');
  const box = slot(ctx);
  if (name === 'cost') {
    const key = String(dir || '');
    if (!box.cost) box.cost = new Map();
    if (box.cost.has(key)) return box.cost.get(key);
    const rows = collectFindings(ctx, dir).filter(f => f.area === 'cost');
    box.cost.set(key, rows);
    return rows;
  }
  if (name === 'todo') {
    const key = String(dir || '');
    if (!box.todo) box.todo = new Map();
    const stamp = todoStamp(ctx, dir);
    const hit = box.todo.get(key);
    if (hit && hit.stamp === stamp) return hit.rows;
    const rows = require('./todo').collectItems(ctx, dir);
    box.todo.set(key, { stamp, rows });
    return rows;
  }
  if (name === 'status') {
    const stamp = statusStamp(ctx);
    if (!box.statusRows || box.statusStamp !== stamp) {
      box.statusRows = require('./status').collectRows(ctx);
      box.statusStamp = stamp;
    }
    return box.statusRows;
  }
  if (name !== 'doctor') throw new Error(`unknown findings view ${name}`);
  const stamp = doctorStamp(ctx);
  if (!box.doctor || box.doctorStamp !== stamp) {
    const status = require('./status');
    box.doctor = status.healthRows(ctx).map(healthFinding);
    box.doctorStamp = stamp;
  }
  return box.doctor;
}

function why(findings, id) {
  const hit = (findings || []).find(f => f.id === id);
  if (!hit) return `No finding ${id}.`;
  return hit.fix ? `${hit.message}\n${hit.fix}` : String(hit.message || '');
}
function forget(ctx, dir) {
  const box = ctx && cache.get(ctx);
  if (!box || !box.dirs) return;
  if (dir === undefined) cache.delete(ctx);
  else {
    const key = String(dir || '');
    box.dirs.delete(key);
    if (box.cost) box.cost.delete(key);
    if (box.todo) box.todo.delete(key);
  }
}

module.exports = { collectFindings, view, why, forget };
