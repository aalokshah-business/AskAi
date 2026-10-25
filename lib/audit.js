'use strict';
// askai audit: the seven-point token audit (memory, tools, model, hooks, subagents, scheduled work, cache), read-only, sorted by
// severity. Claude Code in full; Codex, Cursor and Antigravity checks included. Output: TOOL | SCOPE | FINDING | SEVERITY | EVIDENCE | COST.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const cfg = require('./claude-config');
const mcp = require('./mcp');
const usage = require('./usage');

const HOST_NAMES = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  agy: 'Antigravity',
  all: 'All tools'
};

const tok = s => Math.ceil(String(s || '').length / 4);
const readT = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };

function memoryFiles(ctx, cwd) {
  const seen = new Set(); const out = [];
  const toolOf = f => {
    const base = path.basename(f);
    if (base.startsWith('CLAUDE')) return 'claude';
    if (base.startsWith('GEMINI')) return 'agy';
    if (base.includes('.cursor') || base.endsWith('.mdc') || base === '.cursorrules') return 'cursor';
    if (base === 'AGENTS.md') return 'all';
    return 'all';
  };
  const add = (f, via, scope) => {
    if (!f) return;
    f = path.resolve(f); if (seen.has(f)) return; const t = readT(f); if (t === null) return; seen.add(f);
    out.push({ file: f, tokens: tok(t), via, tool: toolOf(f), scope: scope || 'project' });
    for (const m of t.matchAll(/^@(\S+)\s*$/gm)) {
      const p = m[1].startsWith('~') ? path.join(os.homedir(), m[1].slice(1)) : path.resolve(path.dirname(f), m[1]);
      if (!seen.has(path.resolve(p))) add(p, `@import in ${path.basename(f)}`, scope);
    }
  };
  if (ctx.paths && ctx.paths.claudeMd) add(ctx.paths.claudeMd, 'user', 'machine');
  if (ctx.agyPaths && ctx.agyPaths.home) {
    add(path.join(ctx.agyPaths.home, 'GEMINI.md'), 'user', 'machine');
  }
  if (ctx.codexPaths && ctx.codexPaths.home) {
    add(path.join(ctx.codexPaths.home, 'AGENTS.md'), 'user', 'machine');
  }
  if (ctx.cursorPaths && ctx.cursorPaths.home) {
    const cr = path.join(ctx.cursorPaths.home, 'rules');
    try { for (const n of fs.readdirSync(cr)) if (n.endsWith('.mdc')) add(path.join(cr, n), 'user', 'machine'); } catch (_) {}
  }
  let d = path.resolve(cwd || process.cwd()); const stop = path.parse(d).root;
  for (let i = 0; i < 12; i++) {
    for (const n of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md'), 'AGENTS.md', 'GEMINI.md']) {
      add(path.join(d, n), 'project', 'project');
    }
    const prRules = path.join(d, '.cursor', 'rules');
    try { for (const n of fs.readdirSync(prRules)) if (n.endsWith('.mdc')) add(path.join(prRules, n), 'project', 'project'); } catch (_) {}
    if (d === stop || d === os.homedir()) break;
    d = path.dirname(d);
  }
  return out;
}

function newestClaudeLog(ctx) {
  if (!ctx.paths || !ctx.paths.home) return null;
  const root = path.join(ctx.paths.home, 'projects'); let best = null;
  for (const f of usage.walk(root)) { if (/[\\/]subagents[\\/]/.test(f)) continue; try { const m = fs.statSync(f).mtimeMs; if (!best || m > best.m) best = { f, m }; } catch (_) { /* skip */ } }
  return best && best.f;
}

function parseClaude(file) {
  const r = { file, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: [], switches: 0, efforts: [], effortSwitches: 0, compactions: 0, subagents: {} };
  let last = null, lastEffort = null;
  for (const line of (readT(file) || '').split(/\r?\n/)) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.isCompactSummary || j.type === 'summary') r.compactions++;
    const u = j.message && j.message.usage; if (j.type !== 'assistant' || !u) continue;
    r.turns++; r.input += u.input_tokens || 0; r.output += u.output_tokens || 0; r.cacheRead += u.cache_read_input_tokens || 0; r.cacheWrite += u.cache_creation_input_tokens || 0;
    const m = j.message.model; if (m && m !== '<synthetic>') { if (last && m !== last) r.switches++; if (!r.models.includes(m)) r.models.push(m); last = m; }
    const ef = j.effort; if (ef) { if (lastEffort && ef !== lastEffort) r.effortSwitches++; if (!r.efforts.includes(ef)) r.efforts.push(ef); lastEffort = ef; }
  }
  const sub = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  for (const f of usage.walk(sub)) for (const line of (readT(f) || '').split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.type === 'assistant' && j.message && j.message.model) { const k = `${j.message.model}${j.effort ? ` @ ${j.effort}` : ''}`; r.subagents[k] = (r.subagents[k] || 0) + 1; }
  }
  return r;
}

function run(ctx, cwd, o = {}, print = console.log) {
  let rows = [];
  const add = (finding, severity, evidence, cost, host = 'claude', scope = 'machine') => {
    rows.push({ host, scope, finding, severity, evidence: evidence || '', cost: cost || '' });
  };
  const rank = { now: 'high', later: 'medium', info: 'info', ok: 'ok' };
  for (const f of require('./findings').view(ctx, 'cost', cwd)) {
    const fHost = f.host || (f.group === 'repo' ? 'all' : 'claude');
    const fScope = f.group === 'repo' || /repo|project/i.test(f.id) ? 'project' : 'machine';
    add(f.message, rank[f.severity] || 'info', f.id, f.fix || '', fHost, fScope);
  }
  // 1 memory
  const mem = memoryFiles(ctx, cwd);
  const total = mem.reduce((a, m) => a + m.tokens, 0);
  for (const m of mem) {
    if (m.tokens > 5000) {
      add(`Large memory file ${path.basename(m.file)}`, 'high', `${m.file}: ~${m.tokens} tokens (${m.via})`, `~${m.tokens} tokens in this candidate instruction file`, m.tool || 'all', m.scope || 'project');
    }
  }
  add('Memory files in scope', total > 10000 ? 'high' : total > 4000 ? 'medium' : 'ok', mem.map(m => `${path.basename(path.dirname(m.file))}/${path.basename(m.file)} ~${m.tokens}`).join('; ') || 'none', `~${total} tokens across candidate files (all tools combined)`, 'all', 'project');
  // 2 tools
  for (const t of ['claude', 'codex', 'cursor', 'agy']) {
    const on = mcp.list(ctx).filter(r => r.tool === t && r.state === 'on');
    if (t === 'claude') {
      add('MCP servers (Claude Code, user scope)', on.length > 5 ? 'medium' : 'ok', on.map(s => s.name).join(', ') || 'none', on.length > 5 ? 'tool names and instructions in every session' : '', 'claude', 'machine');
    } else if (on.length > 5) {
      add(`MCP servers (${HOST_NAMES[t]}, user scope)`, 'medium', `${on.length} servers: ${on.map(s => s.name).join(', ')}`, 'tool names and instructions in every session', t, 'machine');
    }
  }
  add('MCP tool deferral', process.env.ENABLE_TOOL_SEARCH === 'false' ? 'high' : 'ok', process.env.ENABLE_TOOL_SEARCH === 'false' ? 'ENABLE_TOOL_SEARCH=false: every tool definition loads up front' : 'default (tool definitions load on demand)', '', 'claude', 'machine');
  if (process.env.ANTHROPIC_BASE_URL) add('PROXY IN THE REQUEST PATH', 'high', `ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}`, 'may switch billing to per-token and break caching', 'claude', 'machine');
  const agySettings = ctx.agyPaths && (ctx.agyPaths.cliSettings || ctx.agyPaths.settings);
  if (agySettings && fs.existsSync(agySettings)) {
    try {
      const ast = JSON.parse(readT(agySettings) || '{}');
      if (ast.useG1Credits === true) {
        add('Antigravity paid credits enabled', 'high', 'useG1Credits: true in settings.json', 'paid credits are spent automatically instead of free tier', 'agy', 'machine');
      }
    } catch (_) {}
  }
  // 3 model
  let s = {}; try { if (ctx.paths && ctx.paths.settings) s = cfg.readJson(ctx.paths.settings); } catch (_) { /* unreadable */ }
  let ps = {}; try { ps = cfg.readJson(path.join(cwd || '.', '.claude', 'settings.json')); } catch (_) { /* none */ }
  const model = ps.model || s.model; const effort = process.env.CLAUDE_CODE_EFFORT_LEVEL || ps.effortLevel || s.effortLevel;
  const claudeOn = !!(ctx.which && ctx.which('claude'));
  if (claudeOn || model) add('Default model', !model ? 'high' : /opus/i.test(model) ? 'medium' : 'ok', model ? `${model} (${ps.model ? 'project' : 'user'} settings)` : 'no default model in settings', !model || /opus/i.test(model) ? 'the most expensive model for routine work' : '', 'claude', ps.model ? 'project' : 'machine');
  if (/opusplan/i.test(model || '')) add('Model changes automatically', 'medium', 'opusplan switches between Opus and Sonnet by mode', 'each switch rebuilds the prompt cache', 'claude', 'project');
  add('Default effort', /max|xhigh/.test(effort || '') ? 'medium' : 'ok', effort ? `${effort} (${process.env.CLAUDE_CODE_EFFORT_LEVEL ? 'environment' : 'settings'})` : 'model default', /max|xhigh/.test(effort || '') ? 'thinking is billed as output' : '', 'claude', ps.effortLevel ? 'project' : 'machine');
  if (ctx.codexPaths && ctx.codexPaths.config && fs.existsSync(ctx.codexPaths.config)) {
    const toml = readT(ctx.codexPaths.config) || '';
    const effM = /model_reasoning_effort\s*=\s*["']?(\w+)["']?/i.exec(toml);
    if (effM && /high|xhigh/i.test(effM[1])) {
      add('Codex default reasoning effort', 'medium', `reasoning effort: ${effM[1]}`, 'high reasoning effort burns output quota quickly', 'codex', 'machine');
    }
  }
  // 4 hooks
  const hooks = cfg.listHooks(s); const pre = hooks.filter(h => h.event === 'PreToolUse');
  if (pre.length) add('PreToolUse hooks', 'info', pre.map(h => h.command).join('; '), 'noisy commands still need a cap', 'claude', 'machine');
  // 5 subagents
  const agentDirs = [];
  if (ctx.paths && ctx.paths.home) agentDirs.push({ dir: path.join(ctx.paths.home, 'agents'), host: 'claude', scope: 'machine' });
  agentDirs.push({ dir: path.join(cwd || '.', '.claude', 'agents'), host: 'claude', scope: 'project' });
  agentDirs.push({ dir: path.join(cwd || '.', '.agents', 'agents'), host: 'agy', scope: 'project' });
  if (ctx.agyPaths && ctx.agyPaths.home) {
    agentDirs.push({ dir: path.join(ctx.agyPaths.home, 'agents'), host: 'agy', scope: 'machine' });
  }
  for (const ad of agentDirs) {
    let names = []; try { names = fs.readdirSync(ad.dir).filter(n => n.endsWith('.md')); } catch (_) { continue; }
    const models = require('./models');
    const prefs = models.load(ctx);
    const tierOf = { architect: 'lead', builder: 'build', runner: 'chore' };
    for (const n of names) {
      const t = readT(path.join(ad.dir, n)) || '';
      const fm = (/^---\n([\s\S]*?)\n---/.exec(t.replace(/\r\n/g, '\n')) || [])[1] || '';
      const m = /^model:\s*(\S+)/m.exec(fm);
      const e = /^effort:\s*(\S+)/m.exec(fm);
      const tier = tierOf[n.replace(/\.md$/, '')];
      const want = tier ? models.pick(prefs, ad.host, tier) : null;
      if (want && ((m && m[1] !== want.model) || (e && e[1] !== want.effort))) {
        add('agents.drift', 'medium', `${n.replace(/\.md$/, '')}: file ${m ? m[1] : '-'} / ${e ? e[1] : '-'}; current tier ${want.model} / ${want.effort}`, 'askai project refresh --agents', ad.host, ad.scope);
      } else {
        add(`Subagent ${n.replace(/\.md$/, '')}`, !m || m[1] === 'inherit' ? 'medium' : 'ok', `model ${m ? m[1] : 'inherits the session'}, effort ${e ? e[1] : 'inherits'}`, !m || m[1] === 'inherit' ? 'runs on the session model, possibly the most expensive' : '', ad.host, ad.scope);
      }
    }
  }
  // 6 scheduled work
  if (process.platform === 'win32') {
    try {
      const r = cp.spawnSync('schtasks', ['/query', '/fo', 'CSV', '/nh'], { encoding: 'utf8', timeout: 5000 });
      const jobs = String(r.stdout || '').split('\n').filter(l => /claude|codex|agy|cursor-agent|askai/i.test(l));
      const names = jobs.map(l => (l.split('","')[0] || l).replace(/^"/, ''));
      add('Scheduled jobs (Task Scheduler)', names.length ? 'medium' : 'ok', names.length ? names.join(' | ') : 'none', names.length ? 'each run starts cold if its interval exceeds the 1 h cache' : '', 'all', 'machine');
    } catch (_) { /* schtasks unavailable */ }
  } else {
    try {
      const r = cp.spawnSync('crontab', ['-l'], { encoding: 'utf8', timeout: 3000 });
      const jobs = String(r.stdout || '').split('\n').filter(l => /claude|codex|agy|cursor-agent/.test(l) && !l.startsWith('#'));
      add('Scheduled jobs (cron)', jobs.length ? 'medium' : 'ok', jobs.length ? jobs.join(' | ') : 'none', jobs.length ? 'each run starts cold if its interval exceeds the 1 h cache' : '', 'all', 'machine');
    } catch (_) { /* no crontab */ }
  }
  add('In-session schedules', 'info', 'Claude Code /loop, an in-app scheduled task or cron, and agent teams resend the full context on every fire; keep each interval under the 1 h cache lifetime or expect full-price reprocessing. askai break lists agent CLIs still running.', '', 'claude', 'session');

  // 7 cache & sessions (only when not filtered to project-only)
  if (o.project !== true && o.scope !== 'project') {
    const wantTool = (o.tool || o.host || '').toLowerCase();
    if (!wantTool || wantTool === 'claude' || wantTool === 'claude-code') {
      const log = newestClaudeLog(ctx);
      if (log) {
        const r = parseClaude(log); const inAll = r.input + r.cacheRead + r.cacheWrite || 1; const share = Math.round(100 * r.cacheRead / inAll);
        add('Prompt cache reuse (newest session)', share < 60 ? 'high' : share < 80 ? 'medium' : 'ok', `${r.turns} turns: cache read ${share}%, cache write ${Math.round(100 * r.cacheWrite / inAll)}%, uncached ${Math.round(100 * r.input / inAll)}%, output ${r.output.toLocaleString('en-US')} tokens`, share < 80 ? 'misses re-process the conversation at full price' : '', 'claude', 'session');
        if (r.switches) add('Model switches in that session', 'high', `${r.switches} switch(es): ${r.models.join(' -> ')}`, 'each switch rebuilds the cache', 'claude', 'session');
        if (r.effortSwitches) add('Effort switches in that session', 'medium', `${r.effortSwitches} switch(es): ${r.efforts.join(' -> ')}`, 'disputed cache-breaker (Anthropic says no, three creator videos say yes) — compare cache read % before and after to measure it yourself', 'claude', 'session');
        if (r.compactions >= 2) add('Repeated compaction', 'medium', `${r.compactions} compactions in one session`, 'hand off and /clear instead', 'claude', 'session');
        for (const [k, n] of Object.entries(r.subagents)) add('Subagent model actually used', 'info', `${k}: ${n} turns`, '', 'claude', 'session');
      }
    }
    if ((!wantTool || wantTool === 'codex') && ctx.codexPaths && ctx.codexPaths.home && fs.existsSync(ctx.codexPaths.home)) {
      const c = usage.codex(ctx.codexPaths.home, 7);
      if (c.total.sessions) add('Codex cached input (7 days)', c.total.cached / (c.total.input || 1) < 0.5 ? 'medium' : 'ok', `${Math.round(100 * c.total.cached / (c.total.input || 1))}% of ${c.total.input.toLocaleString('en-US')} input tokens were cached`, '', 'codex', 'session');
      const m = usage.codexModels(ctx.codexPaths.home, 7);
      if (Object.keys(m).length) add('Codex models actually used (7 days)', 'info', Object.entries(m).map(([k, n]) => `${k}: ${n}`).join(', '), '', 'codex', 'session');
    }
  }

  // Filtering
  if (o.tool || o.host) {
    const want = String(o.tool || o.host).toLowerCase();
    const alias = { claude: 'claude', 'claude-code': 'claude', cursor: 'cursor', codex: 'codex', agy: 'agy', antigravity: 'agy', gemini: 'agy' };
    const norm = alias[want] || want;
    rows = rows.filter(r => r.host === norm || r.host === 'all');
  }
  if (o.scope) {
    const wantScope = String(o.scope).toLowerCase();
    rows = rows.filter(r => r.scope === wantScope);
  } else if (o.project === true) {
    rows = rows.filter(r => r.scope === 'project');
  }

  const order = { high: 0, medium: 1, info: 2, ok: 3 };
  rows.sort((a, b) => order[a.severity] - order[b.severity]);

  if (o.json) {
    print(JSON.stringify(rows, null, 2));
    return rows.some(r => r.severity === 'high') ? 1 : 0;
  }

  for (const severity of ['high', 'medium', 'info', 'ok']) {
    const group = rows.filter(r => r.severity === severity);
    if (!group.length) continue;
    print('[' + severity.toUpperCase() + ']');
    for (const line of require('./columns').table(['Tool', 'Scope', 'Finding', 'Evidence', 'Impact / next step'], group.map(r => [HOST_NAMES[r.host] || r.host, r.scope, r.finding, r.evidence, r.cost]), {width:o.width, widths:[12,9,30,40,30]})) print(line);
    print('');
  }
  print('Memory estimates use characters / 4 in candidate files. Imports and conditional rules may overlap; these are not measured tokens per session or plan usage.');

  const counts = { high: 0, medium: 0, info: 0, ok: 0 };
  const scopeCounts = { project: 0, machine: 0, session: 0 };
  for (const r of rows) {
    if (counts[r.severity] != null) counts[r.severity]++;
    if (scopeCounts[r.scope] != null) scopeCounts[r.scope]++;
  }
  print('');
  print(`Audit summary: ${counts.high} high · ${counts.medium} medium · ${counts.info} info · ${counts.ok} ok  │  scope: ${scopeCounts.project} project · ${scopeCounts.machine} machine · ${scopeCounts.session} session`);

  return rows.some(r => r.severity === 'high') ? 1 : 0;
}

module.exports = { run, memoryFiles, parseClaude, newestClaudeLog };
