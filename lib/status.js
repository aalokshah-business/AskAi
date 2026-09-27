'use strict';
// Read-only views: status (tools + measured savings), doctor (health checks), statusline (one line for Claude Code).
// Only numbers a tool reports itself are shown. RTK's `rtk gain` is the one cross-session counter; Context Mode reports
// per session inside Claude Code; Claude Code itself reports context use and prompt-cache figures to the status line, which
// askai keeps per session for `askai report`. Serena, Caveman and the rule files have no counter, so they show "not
// measured", never a guess.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const comps = require('./components');
const cursor = require('./cursor');
const profiles = require('./profiles');

const TTL_MS = 30000;
const SNAPSHOT_EVERY_MS = 30000;
const SNAPSHOT_KEEP_MS = 14 * 24 * 3600 * 1000;

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

// { ok, commands, input, output, saved, pct } from `rtk gain --format json`, cached briefly (the status line calls this often).
function rtkSavings(ctx, useCache) {
  const cache = path.join(ctx.paths.cache, 'rtk-gain.json');
  if (useCache) {
    try {
      const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (Date.now() - c.at < TTL_MS) return c.data;
    } catch (_) { /* no cache */ }
  }
  let data;
  if (!ctx.which('rtk')) data = { ok: false, reason: 'rtk not installed' };
  else {
    const r = ctx.probe('rtk', ['gain', '--format', 'json'], { timeout: 8000 });
    try {
      const s = JSON.parse(r.stdout).summary;
      if (!s) throw new Error('no summary');
      data = { ok: true, commands: s.total_commands, input: s.total_input, output: s.total_output, saved: s.total_saved, pct: s.avg_savings_pct };
    } catch (_) {
      data = { ok: false, reason: r.ok ? 'unexpected rtk gain output' : 'rtk gain failed' };
    }
  }
  // Best-effort cache, only where askai is already installed (a read-only command must not create the directory).
  try { if (fs.existsSync(ctx.paths.askaiDir)) { fs.mkdirSync(ctx.paths.cache, { recursive: true }); fs.writeFileSync(cache, JSON.stringify({ at: Date.now(), data })); } } catch (_) { /* ignore */ }
  return data;
}

const WIRING = {
  claude: 'CLI',
  baseline: 'settings.json',
  rtk: 'PreToolUse hook on Bash (settings.json)',
  'context-mode': 'plugin hooks + ctx_* MCP tools',
  serena: 'MCP server (user scope), model-chosen',
  markitdown: 'CLI on PATH; the docs rules tell Claude to convert a document once, then read the Markdown',
  ccusage: 'CLI on PATH; its report is shown by `askai report`',
  caveman: 'CLAUDE.md block, every session',
  'caveman-plugin': 'plugin hooks (opt-in)',
  rules: '~/.claude/rules/askai-*.md, loaded only when Claude reads a matching file',
  statusline: 'statusLine command',
  'cursor-rtk': 'shell hook in ~/.cursor/hooks.json (`rtk hook cursor`, written by rtk init)',
  'cursor-context-mode': 'MCP server in ~/.cursor/mcp.json; routing comes from the project rules (`askai project`)',
  'cursor-serena': 'MCP server in ~/.cursor/mcp.json, model-chosen',
};

function savingsText(ctx, id, state) {
  if (state === 'missing') return '-';
  if (id === 'rtk') {
    const s = rtkSavings(ctx, false);
    return s.ok
      ? `${fmt(s.saved)} tokens saved over ${s.commands} commands, avg ${Math.round(s.pct)}% (measured by rtk, its own token estimate)`
      : `unavailable (${s.reason})`;
  }
  if (id === 'context-mode') return 'per session: /context-mode:ctx-stats in Claude Code (tool-reported, not aggregated here)';
  if (id === 'serena') return 'not measured';
  if (id === 'cursor-rtk') return 'not measured per host; the rtk row shows RTK\'s own total';
  if (id === 'cursor-context-mode' || id === 'cursor-serena') return 'not measured (Cursor exposes no counter to askai)';
  if (id === 'markitdown' || id === 'rules') return 'not measured';
  if (id === 'ccusage') return 'saves nothing itself: it reports spend (see askai report)';
  if (id === 'caveman' || id === 'caveman-plugin') return 'not measured (fewer output tokens per reply, no A/B)';
  return '';
}

// The profile in effect and where it came from: --profile, the one the last install recorded, or the default.
function profileInfo(ctx) {
  const asked = ctx.opts.profile, kept = ctx.manifest.profile;
  try { return { ...profiles.get(asked || kept), source: asked ? '--profile' : kept ? 'recorded by askai install' : 'default, none recorded yet' }; }
  catch (_) { return { ...profiles.get(), source: 'default (recorded profile unknown)' }; }
}

// Whether Cursor is in play: the target asks for it, or auto found it. A sandboxed run without --cursor-home has no Cursor.
function cursorActive(ctx) {
  try { return cursor.hosts(ctx).cursor; } catch (_) { return false; }
}

function collect(ctx) {
  const prof = profileInfo(ctx);
  const cur = cursorActive(ctx);
  const safeDetect = c => { try { return c.detect(ctx); } catch (e) { return { state: 'partial', detail: `check failed: ${e.message}` }; } };
  return comps.ALL
    // Cursor rows only when Cursor is in play or askai recorded wiring it; opt-in tools only when added or present.
    .filter(c => c.host === 'cursor' ? (cur || !!ctx.manifest.components[c.id]) : (!c.optIn || ctx.manifest.components[c.id] || safeDetect(c).state === 'ok'))
    .map(c => {
      const d = safeDetect(c);
      // wanted: part of the profile (a Cursor twin follows the tool it mirrors), or something the user added on purpose.
      // A tool outside the profile is not a problem when absent.
      const wanted = prof.components.includes(c.id) || !!(c.mirrors && prof.components.includes(c.mirrors)) || !!ctx.manifest.components[c.id];
      return { id: c.id, title: c.title, evidence: c.evidence, wiring: WIRING[c.id] || '', state: d.state, detail: d.detail, wanted, savings: savingsText(ctx, c.id, d.state) };
    });
}

function renderStatus(ctx) {
  const rows = collect(ctx);
  const prof = profileInfo(ctx);
  const w = Math.max(...rows.map(r => r.id.length));
  const cur = cursorActive(ctx);
  const lines = [`askai status   (claude home: ${ctx.paths.home}${cur && ctx.cursorPaths ? `; cursor home: ${ctx.cursorPaths.home}` : ''})`, `profile: ${prof.name} (${prof.source}): ${prof.summary}`, ''];
  for (const r of rows) {
    lines.push(`${r.id.padEnd(w)}  ${r.state.padEnd(7)}  ${r.detail}`);
    if (r.wiring) lines.push(`${' '.repeat(w)}           wired: ${r.wiring}`);
    if (r.savings && r.savings !== '-') lines.push(`${' '.repeat(w)}           saved: ${r.savings}`);
  }
  lines.push('', 'Only tool-measured numbers are shown. RTK is the only cross-session counter. The net effect of the whole stack is not measured: /askai-report shows real spend per feature.');
  if (cur) lines.push('Cursor: the status line, cache figures, ccusage and the spend report read Claude Code only. Cursor usage is not measured by askai.');
  return { lines, rows, profile: prof.name };
}

// ---- doctor ------------------------------------------------------------------------------------------------------
function doctor(ctx) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

  add(comps.nodeOk(ctx.nodeVersion) ? 'ok' : 'warn', 'node', `Node ${ctx.nodeVersion}${comps.nodeOk(ctx.nodeVersion) ? '' : ' (< 22.5: Context Mode will not run)'}`);
  add(ctx.which('winget') ? 'ok' : (process.platform === 'win32' ? 'warn' : 'ok'), 'winget', ctx.which('winget') ? 'winget found' : (process.platform === 'win32' ? 'winget not found (needed to install tools)' : 'winget not applicable on this OS'));

  let settingsOk = true;
  try { cfg.readJson(ctx.paths.settings); add('ok', 'settings', `${ctx.paths.settings} parses`); } catch (e) { settingsOk = false; add('fail', 'settings', e.message); }

  if (cursorActive(ctx)) {
    for (const [id, file] of [['cursor-mcp', ctx.cursorPaths.mcp], ['cursor-hooks', ctx.cursorPaths.hooks]]) {
      if (!fs.existsSync(file)) continue;
      try { cfg.readJson(file); add('ok', id, `${file} parses`); } catch (e) { add('fail', id, e.message); }
    }
  }

  if (settingsOk) {
    const prof = profileInfo(ctx);
    for (const r of collect(ctx)) {
      if (r.id === 'statusline' && r.state === 'other') { add('ok', r.id, r.detail); continue; }
      if (r.state === 'missing' && !r.wanted) { add('ok', r.id, `${r.state}: ${r.detail} (not part of the ${prof.name} profile)`); continue; }
      add(r.state === 'ok' ? 'ok' : 'warn', r.id, `${r.state}: ${r.detail}`);
    }
    const hooks = cfg.listHooks(ctx.settings());
    const bashPre = hooks.filter(h => h.event === 'PreToolUse' && (!h.matcher || /bash/i.test(h.matcher)));
    if (bashPre.length > 1) add('warn', 'overlap', `${bashPre.length} PreToolUse hooks can touch Bash calls in settings.json; RTK plus Context Mode plugin hooks both rewrite Bash, interaction not verified`);
    const legacy = hooks.filter(h => /askai(-hook)?\.ps1/i.test(h.command));
    if (legacy.length) add('warn', 'legacy', `${legacy.length} retired askai hook(s) still registered; run \`askai install --only baseline\``);
  }

  const text = cfg.readText(ctx.paths.claudeMd) || '';
  const terse = (text.match(/^#+\s*Terse output \(caveman/gmi) || []).length;
  if (terse > 1) add('warn', 'caveman', `terse-output directive appears ${terse} times in CLAUDE.md`);
  if (ctx.manifest.components['caveman-plugin'] && cfg.hasTerseOutside(text)) add('warn', 'caveman', 'caveman plugin and a CLAUDE.md terse directive are both active');
  if (!fs.existsSync(ctx.paths.manifest)) add('warn', 'manifest', 'no askai manifest: uninstall cannot tell what askai added');
  return out;
}

// ---- Claude Code's own session figures (status line stdin) -------------------------------------------------------
// Claude Code passes a JSON document to the status line command: context_window.used_percentage, prompt_cache (main
// conversation, after the first API response) and, on Pro/Max, rate_limits. Every field can be absent, so each is checked.
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = v => (typeof v === 'string' && v ? v.slice(0, 60) : null);

function parseSession(text) {
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch (_) { return null; }
}

// The compact fields kept for one session.
function sessionFields(j) {
  const pc = j.prompt_cache && typeof j.prompt_cache === 'object' ? j.prompt_cache : {};
  const rl = j.rate_limits && typeof j.rate_limits === 'object' ? j.rate_limits : {};
  const win = w => (w && typeof w === 'object' ? num(w.used_percentage) : null);
  return {
    ctxPct: j.context_window && typeof j.context_window === 'object' ? num(j.context_window.used_percentage) : null,
    cache: {
      hitRatio: num(pc.hit_ratio), requests: num(pc.requests), misses: num(pc.misses), expectedRebuilds: num(pc.expected_rebuilds),
      cacheWriteTokens: num(pc.cache_write_tokens), missRecacheTokens: num(pc.miss_recache_tokens), lastMissCause: str(pc.last_miss_cause),
    },
    rate: { fiveHour: win(rl.five_hour), sevenDay: win(rl.seven_day) },
  };
}

// One JSON file per session under askai/sessions/, rewritten at most every 30 s (the status line runs on every update).
// Only where askai is installed: a read-only command must not create the directory. Files older than 14 days are dropped.
function saveSnapshot(ctx, j) {
  const id = typeof j.session_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(j.session_id) ? j.session_id : null;
  if (!id || !fs.existsSync(ctx.paths.askaiDir)) return;
  const file = path.join(ctx.paths.sessions, `${id}.json`);
  try { if (Date.now() - fs.statSync(file).mtimeMs < SNAPSHOT_EVERY_MS) return; } catch (_) { /* first write */ }
  fs.mkdirSync(ctx.paths.sessions, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ id, at: Date.now(), ...sessionFields(j) }));
  for (const n of fs.readdirSync(ctx.paths.sessions)) {
    const p = path.join(ctx.paths.sessions, n);
    try { if (Date.now() - fs.statSync(p).mtimeMs > SNAPSHOT_KEEP_MS) fs.unlinkSync(p); } catch (_) { /* next */ }
  }
}

// Snapshots seen in the last `hours`, newest first.
function sessionSnapshots(ctx, hours) {
  const out = [];
  let names;
  try { names = fs.readdirSync(ctx.paths.sessions); } catch (_) { return out; }
  const since = Date.now() - Number(hours) * 3600 * 1000;
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(ctx.paths.sessions, n), 'utf8'));
      if (s && typeof s.id === 'string' && Number.isFinite(s.at) && s.at >= since) out.push(s);
    } catch (_) { /* skip a damaged file */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

const pct = v => (v === null || v === undefined ? '-' : `${Math.round(v)}%`);
const stamp = at => new Date(at).toISOString().slice(0, 16).replace('T', ' ');

// { lines, rows } or null when nothing was recorded in the window.
function renderCache(ctx, hours) {
  const rows = sessionSnapshots(ctx, hours);
  if (!rows.length) return null;
  const head = ['session', 'last seen (UTC)', 'context', 'cache hit', 'misses/requests', 're-cache tokens', 'last miss cause'];
  const body = rows.map(s => {
    const c = s.cache || {};
    return [
      s.id.slice(0, 8), stamp(s.at), pct(s.ctxPct), c.hitRatio === null || c.hitRatio === undefined ? '-' : pct(c.hitRatio * 100),
      c.requests === null || c.requests === undefined ? '-' : `${c.misses ?? '-'}/${c.requests}`,
      c.missRecacheTokens === null || c.missRecacheTokens === undefined ? '-' : fmt(c.missRecacheTokens), c.lastMissCause || '-',
    ];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(r => r[i].length)));
  const line = r => r.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  const lines = [line(head), ...body.map(line)];
  const rate = rows.find(s => s.rate && (s.rate.fiveHour !== null || s.rate.sevenDay !== null));
  if (rate) lines.push('', `plan limits (latest report): 5-hour window ${pct(rate.rate.fiveHour)} used, 7-day window ${pct(rate.rate.sevenDay)} used`);
  lines.push('', 'Figures are what Claude Code last reported to the status line for each session (context_window, prompt_cache); askai does not recompute them.',
    'Cache hit and re-cache tokens cover the main conversation only, not subagents. A high re-cache figure means a long prefix was written to the cache again: a cold cache after idle time, or a changed prefix.');
  return { lines, rows };
}

// ---- status line -------------------------------------------------------------------------------------------------
// stdin (Claude Code's session JSON) is forwarded to `context-mode statusline` when that CLI exists; whether the plugin
// puts it on PATH is unverified, so its absence just drops that segment.
function renderStatusline(ctx, stdinText) {
  const parts = [];
  const j = parseSession(stdinText);
  if (j) {
    const f = sessionFields(j);
    if (f.ctxPct !== null) parts.push(`ctx ${Math.round(f.ctxPct)}%`);
    if (f.cache.hitRatio !== null) parts.push(`cache ${Math.round(f.cache.hitRatio * 100)}%`);
    try { saveSnapshot(ctx, j); } catch (_) { /* best effort: the line matters more than the record */ }
  }
  const s = rtkSavings(ctx, true);
  if (s.ok) parts.push(`rtk saved ${fmt(s.saved)}${s.pct ? ` (${Math.round(s.pct)}%)` : ''}`);
  if (ctx.which('context-mode')) {
    const r = ctx.probe('context-mode', ['statusline'], { input: stdinText || '', timeout: 3000 });
    const t = firstLine(r.stdout);
    if (r.ok && t) parts.push(t);
  }
  return parts.length ? parts.join(' | ') : 'askai';
}
const firstLine = s => String(s || '').trim().split(/\r?\n/)[0];

module.exports = { fmt, rtkSavings, collect, renderStatus, doctor, renderStatusline, profileInfo, sessionSnapshots, renderCache };
