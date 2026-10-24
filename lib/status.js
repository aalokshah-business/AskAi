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
const agents = require('./agents');
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
  'cursor-context-mode': 'MCP server in ~/.cursor/mcp.json; the user rule tells the agent to call ctx_* tools',
  'cursor-serena': 'MCP server in ~/.cursor/mcp.json, model-chosen',
  'cursor-rules': 'always-applied and glob-scoped rules in ~/.cursor/rules, every project on this machine',
  'codex-baseline': '~/.codex/config.toml keys (effort, verbosity, personality, subagent effort)',
  'codex-rules': '~/.codex/AGENTS.md managed block, every Codex session',
  'codex-rtk': "RTK's Codex hook (written by rtk init -g --codex)",
  'codex-serena': '[mcp_servers.serena] in ~/.codex/config.toml, model-chosen',
  'agy-rules': '~/.gemini/GEMINI.md managed block, every Antigravity session',
  'agy-rtk': "RTK's Antigravity rules in ~/.gemini/config/rules or <project>/.agents/rules",
  'agy-serena': 'serena in ~/.gemini/config/mcp_config.json, model-chosen',
  handoff: 'retired launcher; ask the agent to write .ai-work/HANDOFF.md',
  lean: 'settings.json: prompt suggestions, recaps and idle goal check-ins off; cross-session messages held; Bash output cap; no git instructions; deny-read rules',
  'agy-path-rules': '~/.gemini/config/rules/askai-*.md, glob-triggered: loaded only when a matching file is touched',
  'code-intel': "Claude Code's official LSP plugins: symbol navigation and type errors after edits",
};

function savingsText(ctx, id, state) {
  if (state === 'missing') return '-';
  if (id === 'rtk') {
    const s = rtkSavings(ctx, false);
    return s.ok
      ? `${fmt(s.saved)} tokens saved over ${s.commands} commands, avg ${Math.round(s.pct)}% (rtk's own estimate of shell output trimmed, not of cost; paired benchmarks found no net saving)`
      : `unavailable (${s.reason})`;
  }
  if (id === 'context-mode') return 'per session: /context-mode:ctx-stats in Claude Code (tool-reported, not aggregated here)';
  if (id === 'serena') return 'not measured';
  if (id === 'cursor-rtk') return 'not measured per host; the rtk row shows RTK\'s own total';
  if (id === 'cursor-context-mode' || id === 'cursor-serena' || id === 'cursor-rules') return 'not measured (Cursor exposes no counter to askai)';
  if (id === 'markitdown' || id === 'rules') return 'not measured';
  if (agents.CODEX_HOSTED.includes(id) || agents.AGY_HOSTED.includes(id) || id === 'lean') return 'not measured';
  if (id === 'code-intel') return 'not measured here (one third-party benchmark: LSP navigation -13% cost)';
  if (id === 'handoff') return 'saves the re-discovery a fresh chat would need; not measured';
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
function hostActive(ctx, host) {
  try { return !!cursor.hosts(ctx)[host]; } catch (_) { return false; }
}

function collectRows(ctx) {
  const prof = profileInfo(ctx);
  const cur = cursorActive(ctx);
  // An old install target must not hide registrations in another client's configuration.
  const safeDetect = c => { try { return c.detect(c.host === 'any' ? { ...ctx, hostSel: null } : ctx); } catch (e) { return { state: 'partial', detail: `check failed: ${e.message}` }; } };
  return comps.ALL
    // Cursor rows only when Cursor is in play or askai recorded wiring it; opt-in tools only when added or present.
    .filter(c => c.host === 'cursor' ? (cur || !!ctx.manifest.components[c.id])
      : (c.host === 'codex' || c.host === 'agy') ? (hostActive(ctx, c.host) || !!ctx.manifest.components[c.id])
        : (!c.optIn || ctx.manifest.components[c.id] || safeDetect(c).state === 'ok'))
    .map(c => {
      const d = safeDetect(c);
      // wanted: part of the profile (a Cursor twin follows the tool it mirrors), or something the user added on purpose.
      // A tool outside the profile is not a problem when absent.
      const wanted = prof.components.includes(c.id) || !!(c.mirrors && prof.components.includes(c.mirrors)) || !!ctx.manifest.components[c.id];
      return { id: c.id, host: c.host || 'claude', title: c.title, evidence: c.evidence, wiring: WIRING[c.id] || '', state: d.state, detail: d.detail, ...(d.hosts ? { hosts: d.hosts } : {}), wanted, savings: savingsText(ctx, c.id, d.state) };
    });
}

// The component scan is cached on the context. A later status or doctor in the same run reuses it.
function collect(ctx) {
  return require('./findings').view(ctx, 'status');
}

function readProjectProfile(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, '.ai-work', 'profile.json'), 'utf8'));
    if (j && typeof j.profile === 'string' && j.profile) return j.profile;
  } catch (_) { /* none recorded */ }
  return null;
}
function rememberProjectProfile(dir, name) {
  if (!dir || !name) return false;
  const file = path.join(dir, '.ai-work', 'profile.json');
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ profile: name }, null, 2)}\n`);
  return true;
}
const STATUS_HOSTS = { codex: 'Codex', agy: 'Antigravity', cursor: 'Cursor', claude: 'Claude Code' };
function statusHost(value) {
  if (!value) return null;
  const host = String(value).toLowerCase();
  if (host === 'antigravity') return 'agy';
  if (!Object.hasOwn(STATUS_HOSTS, host)) throw new Error('status environment must be codex, antigravity (agy), cursor or claude');
  return host;
}
function statusRows(rows, host) {
  if (!host) return rows;
  return rows.filter(r => r.host === host || r.host === 'any').map(r => {
    if (!r.hosts) return r;
    const state = r.hosts[host] || 'other';
    return { ...r, state, detail: r.hosts[host] ? `${STATUS_HOSTS[host]}: ${state}` : 'not configured for this environment', hosts: { [host]: state } };
  });
}
function renderStatus(ctx, dir, options = {}) {
  const hostFilter = statusHost(options.host);
  const rows = collect(ctx);
  const prof = profileInfo(ctx);
  const cur = cursorActive(ctx);
  const recorded = new Set(Object.keys((ctx.manifest && ctx.manifest.components) || {}));
  const hidden = new Set(['handoff', 'token-kit', 'prompt-hooks'].filter(id => !recorded.has(id)));
  const shown = statusRows(rows.filter(r => !hidden.has(r.id)), hostFilter);
  const wanted = shown.filter(r => r.wanted);
  const effective = wanted.filter(r => r.state === 'ok').length;
  let projectName = 'unset';
  let suggested = 'unset';
  if (dir) {
    projectName = readProjectProfile(dir) || 'unset';
    try { suggested = require('./suggest').suggest(dir).profile; } catch (_) { /* no suggestion */ }
  }
  const lines = [
    `machine  ${prof.name} (${prof.source})  ${effective}/${wanted.length} effective${hostFilter ? '' : `  claude ${ctx.paths.home}${cur && ctx.cursorPaths ? `  cursor ${ctx.cursorPaths.home}` : ''}`}`,
    `project ${projectName}`,
    `suggested ${suggested}`,
    ...require('./columns').wrap(require('./runtime').describe(path.join(__dirname,'..')),Math.max(40,Number(options.width || process.stdout.columns) || 120)),
    '',
  ];
  const installed = host => {
    if (!host || host === 'any') return true;
    if (host === 'claude') return !!((ctx.which && ctx.which('claude')) || fs.existsSync(ctx.paths.settings));
    return hostActive(ctx, host);
  };
  const renderRows = items => {
  const output = [];
  const seen = new Set();
  for (const r of items) {
    const host = r.host || 'claude';
    const recorded = !!(ctx.manifest && ctx.manifest.components && ctx.manifest.components[r.id]);
    if (!installed(host) && !recorded) {
      if (!seen.has(host)) { seen.add(host); output.push(`${host} - not installed`); }
      continue;
    }
    output.push(`${r.id}  ${r.state}`, `  ${r.detail}`);
    if (r.wiring) output.push(`  wired: ${r.wiring}`);
    if (r.savings && r.savings !== '-' && !/^not measured/.test(r.savings)) output.push(`  saved: ${r.savings}`);
    output.push('');
  }
  return output;
  };
  if (hostFilter) {
    lines.push(STATUS_HOSTS[hostFilter], ...renderRows(shown));
  } else {
    const width = Math.max(20, Number(options.width || process.stdout.columns) || 160);
    const count = width >= 120 ? 4 : width >= 72 ? 2 : 1;
    const colWidth = Math.floor(width / count);
    const wrap = text => {
      const result = [];
      while (text.length > colWidth - 2) {
        let cut = text.lastIndexOf(' ', colWidth - 2);
        if (cut < 1) cut = colWidth - 2;
        result.push(text.slice(0, cut)); text = text.slice(cut).trimStart();
      }
      result.push(text); return result;
    };
    const blocks = Object.entries(STATUS_HOSTS).map(([host, title]) => {
      const items = statusRows(shown, host).filter(r => r.host !== 'any' || r.hosts);
      return [title, '-'.repeat(title.length), ...(items.length ? renderRows(items) : ['not installed / not configured'])].flatMap(wrap);
    });
    lines.push(...require('./columns').zip(blocks, count, width));
    const shared = shown.filter(r => r.host === 'any' && !r.hosts);
    if (shared.length) lines.push('Shared local tools (installation status)', ...renderRows(shared));
  }
  lines.push('', 'Only tool-measured numbers are shown. RTK is the only cross-session counter. The net effect of the whole stack is not measured: askai report shows real spend per feature.');
  if (cur && (!hostFilter || hostFilter === 'cursor')) lines.push('Cursor: the status line, cache figures, ccusage and the spend report read Claude Code only. Cursor usage is not measured by askai.');
  return { lines, rows, profile: prof.name };
}

// ---- doctor ------------------------------------------------------------------------------------------------------
function healthRows(ctx) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

  add(comps.nodeOk(ctx.nodeVersion) ? 'ok' : 'warn', 'node', `Node ${ctx.nodeVersion}${comps.nodeOk(ctx.nodeVersion) ? '' : ' (< 22.5: Context Mode will not run)'}`);
  if (process.platform === 'win32') add(ctx.which('winget') ? 'ok' : 'warn', 'winget', ctx.which('winget') ? 'winget found' : 'winget not found (needed to install tools)');

  let settingsOk = true;
  try { cfg.readJson(ctx.paths.settings); add('ok', 'settings', `${ctx.paths.settings} parses`); } catch (e) { settingsOk = false; add('fail', 'settings', e.message); }

  if (cursorActive(ctx)) {
    for (const [id, file] of [['cursor-mcp', ctx.cursorPaths.mcp], ['cursor-hooks', ctx.cursorPaths.hooks]]) {
      if (!fs.existsSync(file)) continue;
      try { cfg.readJson(file); add('ok', id, `${file} parses`); } catch (e) { add('fail', id, e.message); }
    }
  }

  if (settingsOk) {
    for (const r of collect(ctx)) {
      if (r.id === 'statusline' && r.state === 'other') { add('ok', r.id, r.detail); continue; }
      if (r.state === 'missing' && !r.wanted) continue;
      if (['handoff', 'token-kit', 'prompt-hooks'].includes(r.id) && !((ctx.manifest.components || {})[r.id])) continue;
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

  // Billing safety: these silently move usage from a subscription to pay-per-token billing or through a proxy.
  if (process.env.ANTHROPIC_API_KEY) add('warn', 'billing', 'ANTHROPIC_API_KEY is set: Claude Code uses it instead of your Pro/Max/Team plan (claude -p always does). Unset it unless you mean to pay per token');
  if (process.env.ANTHROPIC_BASE_URL) add('warn', 'billing', `ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}: Claude Code goes through a proxy; check /status for the billing source`);
  if (process.env.OPENAI_API_KEY) add('warn', 'billing', 'OPENAI_API_KEY is set: check `codex login status` shows your ChatGPT sign-in, not API billing');
  if (settingsOk) {
    const s = ctx.settings();
    if (!('model' in s) && !('ANTHROPIC_MODEL' in process.env)) add('warn', 'model', 'no default model in settings.json: Claude Code starts on Opus. `askai install --only baseline` sets sonnet');
    const env = s.env && typeof s.env === 'object' ? s.env : {};
    if (env.ANTHROPIC_API_KEY) add('warn', 'billing', 'settings.json env sets ANTHROPIC_API_KEY: every session bills per token');
  }
  const mdLines = text ? text.split(/\r?\n/).length : 0;
  if (mdLines > 200) add('warn', 'claude-md', `~/.claude/CLAUDE.md has ${mdLines} lines: Anthropic advises under 200; it loads in every session and every subagent. Move workflows into skills`);
  try {
    const proj = path.join(ctx.paths.home, 'projects');
    const long = fs.existsSync(proj) ? fs.readdirSync(proj).map(d => path.join(proj, d, 'memory', 'MEMORY.md')).filter(f => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).length > 200; } catch (_) { return false; } }) : [];
    if (long.length) add('warn', 'memory', `${long.length} auto-memory MEMORY.md file(s) over 200 lines: only the first 200 lines (25 KB) load at each start; trim them or move detail into topic files`);
  } catch (_) { /* no projects folder */ }
  try {
    const n = Object.keys(cfg.readJson(ctx.paths.userJson).mcpServers || {}).length;
    if (n > 5) add('warn', 'mcp', `${n} user-scope MCP servers: each adds tool names and instructions to every session; disable the ones you do not use today with /mcp`);
  } catch (_) { /* unreadable: reported elsewhere */ }
  let rtkOn = false;
  try { rtkOn = settingsOk && comps.rtkHooked(ctx); } catch (_) { /* settings unreadable: reported above */ }
  if (rtkOn) add('warn', 'rtk-evidence', 'RTK is wired: paired benchmarks measured no net saving (JetBrains +7.6% cost at low effort; median +7% across 6 studies). Keep it only if askai report shows it helping your work');
  if (text.length > 40000) add('warn', 'claude-md', `~/.claude/CLAUDE.md is ${text.length} characters: it loads in every session; move detail into skills or path-scoped rules`);
  if (hostActive(ctx, 'codex') && ctx.codexPaths) {
    const a = cfg.readText(ctx.codexPaths.agentsMd) || '';
    if (Buffer.byteLength(a) > 32768) add('warn', 'codex-agents', `~/.codex/AGENTS.md is over Codex's default 32 KiB instruction limit (project_doc_max_bytes); it is cut and re-sent each turn`);
  }
  if (hostActive(ctx, 'agy') && ctx.agyPaths) {
    try {
      const j = cfg.readJson(ctx.agyPaths.cliSettings);
      if (j.useG1Credits === true) add('warn', 'agy-credits', 'Antigravity useG1Credits is true: paid credits are spent automatically once your plan quota runs out');
    } catch (e) { add('fail', 'agy-settings', e.message); }
    if (fs.existsSync(ctx.agyPaths.mcp)) { try { cfg.readJson(ctx.agyPaths.mcp); } catch (e) { add('fail', 'agy-mcp', e.message); } }
  }
  return out;
}

// Doctor is a view of the shared findings list. The rows above are collected once per context until a watched file changes.
function doctor(ctx) {
  const level = { now: 'fail', later: 'warn', ok: 'ok', info: 'info' };
  return require('./findings').view(ctx, 'doctor').map(f => ({ level: level[f.severity] || 'info', id: f.id, msg: f.message }));
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
      cacheWriteTokens: num(pc.cache_write_tokens), missRecacheTokens: num(pc.miss_recache_tokens) ?? num(pc.recache_tokens_if_cold), lastMissCause: str(pc.last_miss_cause),
      warm: typeof pc.warm === 'boolean' ? pc.warm : null, ttl: str(pc.ttl), expiresAt: str(pc.expires_at), recacheTokensIfCold: num(pc.recache_tokens_if_cold),
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
  const cold = rows.find(s => s.cache && (s.cache.expiresAt || s.cache.recacheTokensIfCold != null));
  if (cold) lines.push(`Status line: expires_at ${cold.cache.expiresAt || 'absent'}, recache_tokens_if_cold ${cold.cache.recacheTokensIfCold == null ? 'absent' : cold.cache.recacheTokensIfCold}. Main conversation only.`);
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
function brief(ctx,dir,options={}) {
  const host=statusHost(options.host),servers=require('./mcp').list(ctx);
  const files={claude:ctx.paths.claudeMd,codex:ctx.codexPaths?.agentsMd,agy:ctx.agyPaths?.rulesMd,cursor:ctx.cursorPaths && path.join(ctx.cursorPaths.home,'rules','askai-tokens.mdc')};
  const rows=Object.entries(STATUS_HOSTS).filter(([key])=>!host||key===host).map(([key,label])=>({host:key,label,rules:!!files[key]&&fs.existsSync(files[key]),mcpOn:servers.filter(s=>s.tool===key&&s.state==='on').length,mcpOff:servers.filter(s=>s.tool===key&&s.state!=='on').length,live:'not checked'}));
  const result={mode:'configuration-only',runtime:require('./runtime').identity(path.join(__dirname,'..')),rows,project:dir?{path:dir,router:fs.existsSync(path.join(dir,'AGENTS.md')),handoff:require('./session').handoffState(dir).state}:null};
  const lines=[...require('./columns').wrap('Configuration snapshot; no subprocess versions, live MCP or usage-log scans.',120),...require('./columns').table(['Environment','Rule file','MCP on/off','Live connection'],rows.map(r=>[r.label,r.rules?'present':'missing',`${r.mcpOn}/${r.mcpOff}`,r.live]))];
  if(result.project)lines.push(`Project router: ${result.project.router?'present':'missing'}; handoff: ${result.project.handoff}`);
  lines.push('Full checks: askai status; explicit server probes: askai mcp verify.');
  return {result,lines};
}

module.exports = { brief, statusHost, statusRows, fmt, rtkSavings, collect, collectRows, renderStatus, doctor, healthRows, renderStatusline, profileInfo, sessionSnapshots, renderCache, readProjectProfile, rememberProjectProfile };
