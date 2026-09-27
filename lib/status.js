'use strict';
// Read-only views: status (tools + measured savings), doctor (health checks), statusline (one line for Claude Code).
// Only numbers a tool reports itself are shown. RTK's `rtk gain` is the one cross-session counter; Context Mode reports
// per session inside Claude Code; Serena and Caveman have no counter, so they show "not measured", never a guess.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const comps = require('./components');

const TTL_MS = 30000;

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
  caveman: 'CLAUDE.md block, every session',
  'caveman-plugin': 'plugin hooks (opt-in)',
  statusline: 'statusLine command',
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
  if (id === 'caveman' || id === 'caveman-plugin') return 'not measured (fewer output tokens per reply, no A/B)';
  return '';
}

function collect(ctx) {
  return comps.ALL
    .filter(c => !c.optIn || ctx.manifest.components[c.id] || c.detect(ctx).state === 'ok')
    .map(c => {
      let d;
      try { d = c.detect(ctx); } catch (e) { d = { state: 'partial', detail: `check failed: ${e.message}` }; }
      return { id: c.id, title: c.title, evidence: c.evidence, wiring: WIRING[c.id] || '', state: d.state, detail: d.detail, savings: savingsText(ctx, c.id, d.state) };
    });
}

function renderStatus(ctx) {
  const rows = collect(ctx);
  const w = Math.max(...rows.map(r => r.id.length));
  const lines = [`askai status   (claude home: ${ctx.paths.home})`, ''];
  for (const r of rows) {
    lines.push(`${r.id.padEnd(w)}  ${r.state.padEnd(7)}  ${r.detail}`);
    if (r.wiring) lines.push(`${' '.repeat(w)}           wired: ${r.wiring}`);
    if (r.savings && r.savings !== '-') lines.push(`${' '.repeat(w)}           saved: ${r.savings}`);
  }
  lines.push('', 'Only tool-measured numbers are shown. RTK is the only cross-session counter. The net effect of the whole stack is not measured: /askai-report shows real spend per feature.');
  return { lines, rows };
}

// ---- doctor ------------------------------------------------------------------------------------------------------
function doctor(ctx) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

  add(comps.nodeOk(ctx.nodeVersion) ? 'ok' : 'warn', 'node', `Node ${ctx.nodeVersion}${comps.nodeOk(ctx.nodeVersion) ? '' : ' (< 22.5: Context Mode will not run)'}`);
  add(ctx.which('winget') ? 'ok' : (process.platform === 'win32' ? 'warn' : 'ok'), 'winget', ctx.which('winget') ? 'winget found' : (process.platform === 'win32' ? 'winget not found (needed to install tools)' : 'winget not applicable on this OS'));

  let settingsOk = true;
  try { cfg.readJson(ctx.paths.settings); add('ok', 'settings', `${ctx.paths.settings} parses`); } catch (e) { settingsOk = false; add('fail', 'settings', e.message); }

  if (settingsOk) {
    for (const r of collect(ctx)) {
      if (r.id === 'statusline' && r.state === 'other') { add('ok', r.id, r.detail); continue; }
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

// ---- status line -------------------------------------------------------------------------------------------------
// stdin (Claude Code's session JSON) is forwarded to `context-mode statusline` when that CLI exists; whether the plugin
// puts it on PATH is unverified, so its absence just drops that segment.
function renderStatusline(ctx, stdinText) {
  const parts = [];
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

module.exports = { fmt, rtkSavings, collect, renderStatus, doctor, renderStatusline };
