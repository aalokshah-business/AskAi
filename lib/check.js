'use strict';
// askai check [dir]: audits this machine and one repository against the Token-Saving Guide and says how to fix each gap.
// Read-only unless --fix (then only non-destructive repo fixes through askai scaffold). Levels: ok, warn (costs tokens), fail
// (bills you outside your plan or breaks a guideline badly), info.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const toml = require('./toml-lite');
const tips = require('./tips');
const cursor = require('./cursor');

const readJson = f => { try { return cfg.readJson(f); } catch (_) { return null; } };
const lines = f => { const t = cfg.readText(f); return t == null ? null : t.split(/\r?\n/).length; };
const count = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);

function machine(ctx) {
  const out = [];
  const add = (area, level, msg, fix) => out.push({ area, level, msg, fix: fix || '' });
  const selected = host => cursor.targetIncludes(ctx.manifest && ctx.manifest.target, host);
  const installed = host => {
    if (host === 'claude') return !!(ctx.which && ctx.which('claude')) || fs.existsSync(ctx.paths.settings);
    if (host === 'codex') return !!(ctx.which && ctx.which('codex')) || !!(ctx.codexPaths && fs.existsSync(ctx.codexPaths.home));
    if (host === 'agy') return !!(ctx.which && ctx.which('agy')) || !!(ctx.agyPaths && fs.existsSync(ctx.agyPaths.home));
    if (host === 'cursor') return !!(ctx.which && (ctx.which('cursor') || ctx.which('agent'))) || !!(ctx.cursorPaths && fs.existsSync(ctx.cursorPaths.home));
    return false;
  };
  const absent = host => { if (ctx.opts && ctx.opts.all) add(host, 'info', `${host} – not installed`, host === 'claude' ? 'askai install --target claude --seed-only' : ''); };
  for (const [v, lvl, why] of [['ANTHROPIC_API_KEY', 'fail', 'Claude Code bills this key, not your plan'], ['ANTHROPIC_BASE_URL', 'fail', 'Claude Code goes through a proxy (check /status)'], ['OPENAI_API_KEY', 'warn', 'Codex may bill the API instead of ChatGPT']]) {
    if (process.env[v] && selected(v === 'OPENAI_API_KEY' ? 'codex' : 'claude')) add('billing', lvl, `${v} is set: ${why}`, `unset ${v}`);
  }
  if (selected('claude') && !installed('claude')) absent('claude');
  else if (selected('claude')) {
  const s = readJson(ctx.paths.settings) || {};
  const env = s.env && typeof s.env === 'object' ? s.env : {};
  if (!s.model) add('claude', 'warn', 'no default model: Claude Code starts on Opus', 'askai install --only baseline');
  else if (/opus/i.test(s.model)) add('claude', 'warn', `default model is ${s.model}: the most expensive`, '/model sonnet or haiku for routine work');
  else add('claude', 'ok', `default model ${s.model}`);
  const sub = env.CLAUDE_CODE_SUBAGENT_MODEL;
  add('claude', !sub || /opus/i.test(sub) ? 'warn' : 'ok', sub ? `subagent model ${sub}` : 'no subagent model set (subagents inherit the session model)', sub ? '' : 'askai install --only baseline');
  const eff = s.effortLevel || env.CLAUDE_CODE_EFFORT_LEVEL;
  add('claude', !eff || eff === 'max' ? 'warn' : 'ok', !eff ? 'no default effort set' : eff === 'max' ? 'effort max: the most expensive thinking' : `effort ${eff}`, !eff ? 'askai install --only baseline' : eff === 'max' ? '/effort high for everyday work' : '');
  const idle = ['promptSuggestionEnabled', 'awaySummaryEnabled'].filter(k => s[k] !== false);
  add('claude', idle.length ? 'warn' : 'ok', idle.length ? `${idle.join(', ')} still on (extra requests you did not ask for)` : 'prompt suggestions and recaps off', idle.length ? 'askai install --only lean' : '');
  const md = lines(ctx.paths.claudeMd);
  if (md != null) add('claude', md > 200 ? 'warn' : 'ok', `~/.claude/CLAUDE.md: ${md} lines`, md > 200 ? 'move workflows into skills; keep it under 200 lines' : '');
  const mcp = count((readJson(ctx.paths.userJson) || {}).mcpServers);
  add('claude', mcp > 5 ? 'warn' : 'ok', `${mcp} user-scope MCP server(s)`, mcp > 5 ? 'disable the ones you do not use today (/mcp)' : '');
  const hooks = cfg.listHooks(s);
  if (hooks.some(h => /\brtk\b/i.test(h.command))) add('claude', 'warn', 'RTK hook is wired: paired benchmarks found no net saving (median +7% cost)', 'askai uninstall --only rtk, unless your own numbers show it helps');
  const ep = s.enabledPlugins && typeof s.enabledPlugins === 'object' ? s.enabledPlugins : {};
  if (Object.keys(ep).some(k => k.startsWith('context-mode') && ep[k] !== false)) add('claude', 'warn', 'Context Mode plugin is on: +33% to +72% cost in the one paired study', 'askai uninstall --only context-mode');
  }
  if (selected('codex') && ctx.codexPaths && fs.existsSync(ctx.codexPaths.home)) {
    const t = cfg.readText(ctx.codexPaths.config) || '';
    const miss = [['model_reasoning_effort'], ['model_verbosity'], ['personality']].filter(([k]) => toml.get(t, k) === undefined).map(([k]) => k);
    add('codex', miss.length ? 'warn' : 'ok', miss.length ? `config.toml lacks ${miss.join(', ')}` : 'effort, verbosity and personality set', miss.length ? 'askai install --target codex --only codex-baseline' : '');
    const eff2 = (toml.get(t, 'model_reasoning_effort') || '').replace(/"/g, '');
    if (/high|xhigh/.test(eff2)) add('codex', 'warn', `reasoning effort ${eff2} by default`, 'medium by default; raise it per task with Alt+.');
    const a = cfg.readText(ctx.codexPaths.agentsMd);
    if (a != null) add('codex', Buffer.byteLength(a) > 32768 ? 'warn' : 'ok', `~/.codex/AGENTS.md: ${Buffer.byteLength(a)} bytes`, Buffer.byteLength(a) > 32768 ? 'over the 32 KiB cap; shorten it' : '');
    const servers = (t.match(/^\s*\[mcp_servers\.[^\]]+\]/gm) || []).length;
    if (servers > 5) add('codex', 'warn', `${servers} MCP servers in config.toml`, 'set enabled = false on the ones you do not need');
  }
  if (selected('agy') && ctx.agyPaths && fs.existsSync(ctx.agyPaths.home)) {
    const st = readJson(ctx.agyPaths.cliSettings) || {};
    add('antigravity', st.useG1Credits === true ? 'fail' : 'ok', st.useG1Credits === true ? 'useG1Credits is true: paid credits are spent automatically' : 'paid credits off', st.useG1Credits === true ? 'set "useG1Credits": false' : '');
    const g = cfg.readText(ctx.agyPaths.rulesMd);
    if (g != null) add('antigravity', g.length > 12000 ? 'warn' : 'ok', `~/.gemini/GEMINI.md: ${g.length} characters`, g.length > 12000 ? 'move detail into rules with trigger: glob or model_decision' : '');
    const n = count((readJson(ctx.agyPaths.mcp) || {}).mcpServers);
    if (n > 5) add('antigravity', 'warn', `${n} MCP servers in mcp_config.json`, 'use "disabled": true or "disabledTools"');
  }
  if (selected('cursor') && ctx.cursorPaths && fs.existsSync(ctx.cursorPaths.home)) {
    const rules = path.join(ctx.cursorPaths.home, 'rules');
    const has = fs.existsSync(rules) && fs.readdirSync(rules).some(f => f.endsWith('.mdc'));
    add('cursor', has ? 'ok' : 'warn', has ? 'user rules present' : 'no user rules in ~/.cursor/rules', has ? '' : 'askai install --target cursor');
    const n = count((readJson(ctx.cursorPaths.mcp) || {}).mcpServers);
    if (n > 5) add('cursor', 'warn', `${n} MCP servers in ~/.cursor/mcp.json`, 'disable unused ones in Settings, MCP');
  }
  if (selected('claude')) add('time', tips.isPeak() ? 'warn' : 'info', tips.isPeak() ? 'Claude peak hours right now: big jobs drain the window faster' : `Claude off-peak now; peak in your time is ${tips.localWindow()} on US weekdays`, tips.isPeak() ? 'defer big refactors or agent runs' : '');
  return out;
}

function repo(dir) {
  const out = [];
  const add = (level, msg, fix) => out.push({ area: 'repo', level, msg, fix: fix || '' });
  const f = n => path.join(dir, n);
  const ag = lines(f('AGENTS.md'));
  if (ag == null) add('warn', 'no AGENTS.md: every agent re-discovers the project', 'askai scaffold');
  else add(ag > 200 ? 'warn' : ag > 60 ? 'info' : 'ok', `AGENTS.md: ${ag} lines`, ag > 60 ? 'aim for under 60 lines; link out to detail' : '');
  const cl = cfg.readText(f('CLAUDE.md'));
  if (cl == null) add('warn', 'no CLAUDE.md', 'askai scaffold');
  else {
    if (!/@AGENTS\.md/.test(cl)) add('info', 'CLAUDE.md does not import @AGENTS.md', 'add "@AGENTS.md" as its first line');
    const n = cl.split(/\r?\n/).length;
    add(n > 200 ? 'warn' : 'ok', `CLAUDE.md: ${n} lines`, n > 200 ? 'under 200 lines (Anthropic)' : '');
  }
  add(fs.existsSync(f('.cursorignore')) ? 'ok' : 'warn', fs.existsSync(f('.cursorignore')) ? '.cursorignore present' : 'no .cursorignore: Cursor can index build output, lockfiles and .env', fs.existsSync(f('.cursorignore')) ? '' : 'askai scaffold');
  const gi = cfg.readText(f('.gitignore')) || '';
  add(/^\/?\.ai-work\/?$/m.test(gi) ? 'ok' : 'warn', /^\/?\.ai-work\/?$/m.test(gi) ? '.ai-work/ is gitignored' : '.ai-work/ is not gitignored', /^\/?\.ai-work\/?$/m.test(gi) ? '' : 'askai session init');
  if (fs.existsSync(f('graphify-out')) && !/graphify-out\/?/.test(gi)) add('warn', 'graphify-out/ is not gitignored', 'askai session init');
  const slash = fs.existsSync(f('.cursor/commands/askai-cli.md')) && fs.existsSync(f('.cursor/commands/askai-plugins.md'));
  add(slash ? 'ok' : 'warn', slash ? 'Cursor commands /askai-cli and /askai-plugins are in this project' : 'Cursor commands /askai-cli and /askai-plugins are missing in this project', slash ? '' : 'askai init');
  const hs = require('./session').handoffState(dir);
  const handoffMsg = { missing: ['warn', 'no .ai-work/HANDOFF.md', 'askai session init'], template: ['warn', 'HANDOFF.md is the empty template', 'replace it from verified work'], stale: ['info', `handoff is stale (${Math.round(hs.ageMin)} min)`, 'askai resume'], fresh: ['ok', `handoff is fresh (${Math.round(hs.ageMin)} min)`, ''] }[hs.state];
  if (handoffMsg) add(handoffMsg[0], handoffMsg[1], handoffMsg[2]);
  return out;
}

function run(ctx, dir, o = {}, print = console.log) {
  const rows = [...machine(ctx), ...(dir ? repo(dir) : [])];
  if (o.fix && dir) {
    const scaffold = require('./scaffold');
    const session = require('./session');
    scaffold.run(dir, {}, () => {}); session.ensure(dir, false);
    print(`fixed what can be fixed in ${dir} (scaffold, .ai-work); machine items: run the commands listed`);
  }
  if (o.json) { print(JSON.stringify(rows, null, 2)); return rows.some(r => r.level === 'fail') ? 1 : 0; }
  const mark = { ok: 'ok  ', warn: 'fix ', fail: 'FAIL', info: 'info' };
  let area = '';
  for (const r of rows) {
    if (r.area !== area) { area = r.area; print(`\n[${area}]`); }
    print(`  ${mark[r.level]}  ${r.msg}${r.fix ? `\n          -> ${r.fix}` : ''}`);
  }
  const n = l => rows.filter(r => r.level === l).length;
  print(`\n${n('ok')} ok, ${n('warn')} to improve, ${n('fail')} failing.${dir ? '' : ' Add a folder (askai check .) to audit a repository too.'} \`askai ask <topic>\` explains any rule.`);
  return n('fail') ? 1 : 0;
}

module.exports = { run, machine, repo };
