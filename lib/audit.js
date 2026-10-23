'use strict';
// askai audit: the seven-point token audit (memory, tools, model, hooks, subagents, scheduled work, cache), read-only, sorted by
// severity. Claude Code in full; Codex for its session logs. Output: FINDING | SEVERITY | EVIDENCE | COST.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const cfg = require('./claude-config');
const mcp = require('./mcp');
const usage = require('./usage');

const tok = s => Math.ceil(String(s || '').length / 4);
const readT = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
function memoryFiles(ctx, cwd) {
  const seen = new Set(); const out = [];
  const add = (f, via) => {
    f = path.resolve(f); if (seen.has(f)) return; const t = readT(f); if (t === null) return; seen.add(f);
    out.push({ file: f, tokens: tok(t), via });
    for (const m of t.matchAll(/^@(\S+)\s*$/gm)) { const p = m[1].startsWith('~') ? path.join(os.homedir(), m[1].slice(1)) : path.resolve(path.dirname(f), m[1]); if (!seen.has(path.resolve(p))) add(p, `@import in ${path.basename(f)}`); }
  };
  add(ctx.paths.claudeMd, 'user');
  let d = path.resolve(cwd || process.cwd()); const stop = path.parse(d).root;
  for (let i = 0; i < 12; i++) { for (const n of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]) add(path.join(d, n), 'project'); if (d === stop || d === os.homedir()) break; d = path.dirname(d); }
  return out;
}
function newestClaudeLog(ctx) {
  const root = path.join(ctx.paths.home, 'projects'); let best = null;
  for (const f of usage.walk(root)) { if (/[\\/]subagents[\\/]/.test(f)) continue; try { const m = fs.statSync(f).mtimeMs; if (!best || m > best.m) best = { f, m }; } catch (_) { /* skip */ } }
  return best && best.f;
}
function parseClaude(file) {
  const r = { file, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: [], switches: 0, compactions: 0, subagents: {} };
  let last = null;
  for (const line of (readT(file) || '').split(/\r?\n/)) {
    if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.isCompactSummary || j.type === 'summary') r.compactions++;
    const u = j.message && j.message.usage; if (j.type !== 'assistant' || !u) continue;
    r.turns++; r.input += u.input_tokens || 0; r.output += u.output_tokens || 0; r.cacheRead += u.cache_read_input_tokens || 0; r.cacheWrite += u.cache_creation_input_tokens || 0;
    const m = j.message.model; if (m && m !== '<synthetic>') { if (last && m !== last) r.switches++; if (!r.models.includes(m)) r.models.push(m); last = m; }
  }
  const sub = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  for (const f of usage.walk(sub)) for (const line of (readT(f) || '').split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.type === 'assistant' && j.message && j.message.model) { const k = `${j.message.model}${j.effort ? ` @ ${j.effort}` : ''}`; r.subagents[k] = (r.subagents[k] || 0) + 1; }
  }
  return r;
}
function run(ctx, cwd, o = {}, print = console.log) {
  const rows = []; const add = (finding, severity, evidence, cost) => rows.push({ finding, severity, evidence, cost: cost || '' });
  const rank = { now: 'high', later: 'medium', info: 'info', ok: 'ok' };
  for (const f of require('./findings').view(ctx, 'cost', cwd)) add(f.message, rank[f.severity] || 'info', f.id, f.fix || '');
  // 1 memory
  const mem = memoryFiles(ctx, cwd); const total = mem.reduce((a, m) => a + m.tokens, 0);
  for (const m of mem) if (m.tokens > 5000) add(`Large memory file ${path.basename(m.file)}`, 'high', `${m.file}: ~${m.tokens} tokens (${m.via})`, `~${m.tokens} tokens in every session and subagent`);
  add('Memory files in scope', total > 10000 ? 'high' : total > 4000 ? 'medium' : 'ok', mem.map(m => `${path.basename(path.dirname(m.file))}/${path.basename(m.file)} ~${m.tokens}`).join('; ') || 'none', `~${total} tokens per session`);
  // 2 tools
  const servers = mcp.list(ctx).filter(r => r.tool === 'claude' && r.state === 'on');
  add('MCP servers (Claude Code, user scope)', servers.length > 5 ? 'medium' : 'ok', servers.map(s => s.name).join(', ') || 'none', servers.length > 5 ? 'tool names and instructions in every session' : '');
  add('MCP tool deferral', process.env.ENABLE_TOOL_SEARCH === 'false' ? 'high' : 'ok', process.env.ENABLE_TOOL_SEARCH === 'false' ? 'ENABLE_TOOL_SEARCH=false: every tool definition loads up front' : 'default (tool definitions load on demand)');
  if (process.env.ANTHROPIC_BASE_URL) add('PROXY IN THE REQUEST PATH', 'high', `ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}`, 'may switch billing to per-token and break caching');
  // 3 model
  let s = {}; try { s = cfg.readJson(ctx.paths.settings); } catch (_) { /* unreadable */ }
  let ps = {}; try { ps = cfg.readJson(path.join(cwd || '.', '.claude', 'settings.json')); } catch (_) { /* none */ }
  const model = ps.model || s.model; const effort = process.env.CLAUDE_CODE_EFFORT_LEVEL || ps.effortLevel || s.effortLevel;
  const claudeOn = !!(ctx.which && ctx.which('claude'));
  if (claudeOn || model) add('Default model', !model ? 'high' : /opus/i.test(model) ? 'medium' : 'ok', model ? `${model} (${ps.model ? 'project' : 'user'} settings)` : 'no default model in settings', !model || /opus/i.test(model) ? 'the most expensive model for routine work' : '');
  if (/opusplan/i.test(model || '')) add('Model changes automatically', 'medium', 'opusplan switches between Opus and Sonnet by mode', 'each switch rebuilds the prompt cache');
  add('Default effort', /max|xhigh/.test(effort || '') ? 'medium' : 'ok', effort ? `${effort} (${process.env.CLAUDE_CODE_EFFORT_LEVEL ? 'environment' : 'settings'})` : 'model default', /max|xhigh/.test(effort || '') ? 'thinking is billed as output' : '');
  // 4 hooks
  const hooks = cfg.listHooks(s); const pre = hooks.filter(h => h.event === 'PreToolUse');
  if (pre.length) add('PreToolUse hooks', 'info', pre.map(h => h.command).join('; '), 'noisy commands still need a cap');
  // 5 subagents
  for (const d of [path.join(ctx.paths.home, 'agents'), path.join(cwd || '.', '.claude', 'agents')]) {
    let names = []; try { names = fs.readdirSync(d).filter(n => n.endsWith('.md')); } catch (_) { continue; }
    for (const n of names) { const t = readT(path.join(d, n)) || ''; const fm = (/^---\n([\s\S]*?)\n---/.exec(t.replace(/\r\n/g, '\n')) || [])[1] || ''; const m = /^model:\s*(\S+)/m.exec(fm); const e = /^effort:\s*(\S+)/m.exec(fm);
      add(`Subagent ${n.replace(/\.md$/, '')}`, !m || m[1] === 'inherit' ? 'medium' : 'ok', `model ${m ? m[1] : 'inherits the session'}, effort ${e ? e[1] : 'inherits'}`, !m || m[1] === 'inherit' ? 'runs on the session model, possibly the most expensive' : ''); }
  }
  // 6 scheduled work
  if (process.platform !== 'win32') { try { const r = cp.spawnSync('crontab', ['-l'], { encoding: 'utf8', timeout: 3000 }); const jobs = String(r.stdout || '').split('\n').filter(l => /claude|codex|agy|cursor-agent/.test(l) && !l.startsWith('#'));
    add('Scheduled jobs (cron)', jobs.length ? 'medium' : 'ok', jobs.length ? jobs.join(' | ') : 'none', jobs.length ? 'each run starts cold if its interval exceeds the 1 h cache' : ''); } catch (_) { /* no crontab */ } }
  add('In-session schedules', 'info', 'check /loop and /goal inside Claude Code; askai break lists agent CLIs still running', '');
  // 7 cache
  const log = newestClaudeLog(ctx);
  if (log) {
    const r = parseClaude(log); const inAll = r.input + r.cacheRead + r.cacheWrite || 1; const share = Math.round(100 * r.cacheRead / inAll);
    add('Prompt cache reuse (newest session)', share < 60 ? 'high' : share < 80 ? 'medium' : 'ok', `${r.turns} turns: cache read ${share}%, cache write ${Math.round(100 * r.cacheWrite / inAll)}%, uncached ${Math.round(100 * r.input / inAll)}%, output ${r.output.toLocaleString('en-US')} tokens`, share < 80 ? 'misses re-process the conversation at full price' : '');
    if (r.switches) add('Model switches in that session', 'high', `${r.switches} switch(es): ${r.models.join(' -> ')}`, 'each switch rebuilds the cache');
    if (r.compactions >= 2) add('Repeated compaction', 'medium', `${r.compactions} compactions in one session`, 'hand off and /clear instead');
    for (const [k, n] of Object.entries(r.subagents)) add('Subagent model actually used', 'info', `${k}: ${n} turns`, '');
  }
  if (ctx.codexPaths && fs.existsSync(ctx.codexPaths.home)) {
    const c = usage.codex(ctx.codexPaths.home, 7);
    if (c.total.sessions) add('Codex cached input (7 days)', c.total.cached / (c.total.input || 1) < 0.5 ? 'medium' : 'ok', `${Math.round(100 * c.total.cached / (c.total.input || 1))}% of ${c.total.input.toLocaleString('en-US')} input tokens were cached`, '');
    const m = usage.codexModels(ctx.codexPaths.home, 7);
    if (Object.keys(m).length) add('Codex models actually used (7 days)', 'info', Object.entries(m).map(([k, n]) => `${k}: ${n}`).join(', '), '');
  }
  const order = { high: 0, medium: 1, info: 2, ok: 3 }; rows.sort((a, b) => order[a.severity] - order[b.severity]);
  if (o.json) { print(JSON.stringify(rows, null, 2)); return rows.some(r => r.severity === 'high') ? 1 : 0; }
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  print('FINDING | SEVERITY | EVIDENCE | COST');
  for (const r of rows) print(`${r.finding} | ${r.severity.toUpperCase()} | ${clip(r.evidence, 48)} | ${clip(r.cost, 36)}`);
  return rows.some(r => r.severity === 'high') ? 1 : 0;
}
module.exports = { run, memoryFiles, parseClaude, newestClaudeLog };
