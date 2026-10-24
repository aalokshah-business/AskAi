'use strict';
// askai check [dir]: audits this machine and one repository against the Token-Saving Guide and says how to fix each gap.
// Read-only unless --fix (then only non-destructive repo fixes through askai scaffold). Levels: ok, warn (costs tokens), fail
// (bills you outside your plan or breaks a guideline badly), info.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const toml = require('./toml-lite');
const cursor = require('./cursor');

const readJson = f => { try { return cfg.readJson(f); } catch (_) { return null; } };
const lines = f => { const t = cfg.readText(f); return t == null ? null : t.split(/\r?\n/).length; };
const count = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);

function machine(ctx) {
  const out = [];
  const add = (area, level, msg, fix, extra) => out.push({ area, level, msg, fix: fix || '', ...(extra || {}) });
  const selected = host => cursor.targetIncludes(ctx.manifest && ctx.manifest.target, host);
  const onPath = bin => !!(ctx.which && ctx.which(bin));
  const installed = host => {
    if (host === 'claude') return onPath('claude');
    if (host === 'codex') return onPath('codex');
    if (host === 'agy') return onPath('agy');
    if (host === 'cursor') return onPath('cursor') || onPath('agent') || onPath('cursor-agent');
    return false;
  };
  const absent = host => { if (ctx.opts && ctx.opts.all && host !== 'claude') add(host, 'info', `${host} – not installed`, ''); };
  for (const [v, lvl, why] of [['ANTHROPIC_API_KEY', 'fail', 'Claude Code bills this key, not your plan'], ['ANTHROPIC_BASE_URL', 'fail', 'Claude Code goes through a proxy (check /status)'], ['OPENAI_API_KEY', 'warn', 'Codex may bill the API instead of ChatGPT']]) {
    if (process.env[v] && selected(v === 'OPENAI_API_KEY' ? 'codex' : 'claude')) add('billing', lvl, `${v} is set: ${why}`, `unset ${v}`);
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES || process.env.ASKAI_EPHEMERAL_HOME) add('repo', 'warn', 'AskAI app and ~/.cursor config live in the container home and are lost on rebuild.', 'askai bootstrap');
  if (selected('claude') && !installed('claude')) add('claude', 'info', 'Claude Code not installed: askai install --target claude --seed-only', 'askai install --target claude --seed-only');
  else if (selected('claude')) {
  const s = readJson(ctx.paths.settings) || {};
  const env = s.env && typeof s.env === 'object' ? s.env : {};
  if (!s.model) add('claude', 'warn', 'no default model: Claude Code starts on Opus', 'askai install --only baseline', { estTokens: 'estimate', evidence: 'Claude Code starts on Opus when settings.json has no model.' });
  else if (/opus/i.test(s.model)) add('claude', 'warn', `default model is ${s.model}: the most expensive`, '/model sonnet or haiku for routine work', { estTokens: 'estimate', evidence: 'Opus is the most expensive default. Switching model forces a full re-read with no cache hits.' });
  else add('claude', 'ok', `default model ${s.model}`, '', { evidence: `settings.json model is ${s.model}` });
  const sub = env.CLAUDE_CODE_SUBAGENT_MODEL;
  add('claude', !sub || /opus/i.test(sub) ? 'warn' : 'ok', sub ? `subagent model ${sub}` : 'no subagent model set (subagents inherit the session model)', sub ? '' : 'askai install --only baseline');
  const eff = s.effortLevel || env.CLAUDE_CODE_EFFORT_LEVEL;
  const routineHigh = /haiku/i.test(String(s.model || '')) && eff === 'high';
  const effortBad = !eff || eff === 'max' || routineHigh;
  add('claude', effortBad ? 'warn' : 'ok', !eff ? 'no default effort set' : routineHigh ? 'effort high on the Haiku default: routine work uses medium' : eff === 'max' ? 'effort max: the most expensive thinking' : `effort ${eff}`, !eff || routineHigh ? 'askai install --only baseline' : eff === 'max' ? '/effort medium for everyday work' : '', effortBad ? { estTokens: 'estimate', evidence: routineHigh ? 'Haiku routine work uses medium effort.' : eff === 'max' ? 'effort max is the most expensive thinking.' : 'No default effort is set.' } : { evidence: `effort is ${eff}` });
  const idle = ['promptSuggestionEnabled', 'awaySummaryEnabled'].filter(k => s[k] !== false);
  add('claude', idle.length ? 'warn' : 'ok', idle.length ? `${idle.join(', ')} still on (extra requests you did not ask for)` : 'prompt suggestions and recaps off', idle.length ? 'askai install --only lean' : '');
  const md = lines(ctx.paths.claudeMd);
  if (md != null && md > 200) add('claude', 'warn', `~/.claude/CLAUDE.md is a large file: ${md} lines`, 'move workflows into skills; keep it under 200 lines', { estTokens: md * 4, evidence: 'estimate: line count times 4' });
  else if (md != null) add('claude', 'ok', `~/.claude/CLAUDE.md: ${md} lines`);
  const mcp = count((readJson(ctx.paths.userJson) || {}).mcpServers);
  add('claude', mcp > 5 ? 'warn' : 'ok', `${mcp} user-scope MCP server(s)`, mcp > 5 ? 'disable the ones you do not use today (/mcp)' : '');
  const hooks = cfg.listHooks(s);
  if (mcp > 0) {
    try {
      const calls = require('./infra').mcpCalls(ctx);
      const total = Object.values(calls).reduce((a, n) => a + (Number(n) || 0), 0);
      if (!total) add('claude', 'warn', 'MCP servers are on and unused for 7 days', 'askai mcp off for the ones this work does not need', { estTokens: 'estimate', evidence: 'No transcript call in 7 days. Token cost is not measured here.' });
    } catch (_) { /* no transcripts */ }
  }
  if (hooks.some(h => /\brtk\b/i.test(h.command))) add('claude', 'warn', 'RTK hook is wired: paired benchmarks found no net saving (median +7% cost)', 'askai uninstall --only rtk, unless your own numbers show it helps');
  const ep = s.enabledPlugins && typeof s.enabledPlugins === 'object' ? s.enabledPlugins : {};
  if (Object.keys(ep).some(k => k.startsWith('context-mode') && ep[k] !== false)) add('claude', 'warn', 'Context Mode plugin is on: +33% to +72% cost in the one paired study', 'askai uninstall --only context-mode');
  if (Object.keys(ep).some(k => k.startsWith('clangd-lsp') && ep[k] !== false)) {
    const running = require('./platform').findProcesses({ want: /^clangd$/i });
    if (!running.length) add('claude', 'warn', 'lsp.clangd-inactive: clangd-lsp is installed but no clangd process or usage after a session', 'open a C or C++ file in a Claude Code session, or restart the session');
  }
  }
  if (ctx.manifest && ctx.manifest.profile === 'max') add('claude', 'info', 'profile.legacy-max: max is the previous name of experimental. This check does not rewrite it.', 'askai profiles migrate');
  if (selected('codex') && ctx.codexPaths && fs.existsSync(ctx.codexPaths.home)) {
    const t = cfg.readText(ctx.codexPaths.config) || '';
    const miss = [['model_reasoning_effort'], ['model_verbosity'], ['personality']].filter(([k]) => toml.get(t, k) === undefined).map(([k]) => k);
    add('codex', miss.length ? 'warn' : 'ok', miss.length ? `config.toml lacks ${miss.join(', ')}` : 'effort, verbosity and personality set', miss.length ? 'askai install --target codex --only codex-baseline' : '');
    const eff2 = (toml.get(t, 'model_reasoning_effort') || '').replace(/"/g, '');
    if (/high|xhigh/.test(eff2)) add('codex', 'warn', `reasoning effort ${eff2} by default`, 'medium by default; raise it per task with Alt+.');
    const a = cfg.readText(ctx.codexPaths.agentsMd);
    if (a != null) add('codex', Buffer.byteLength(a) > 32768 ? 'warn' : 'ok', `~/.codex/AGENTS.md: ${Buffer.byteLength(a)} bytes`, Buffer.byteLength(a) > 32768 ? 'over the 32 KiB cap; shorten it' : '');
    const servers = (t.match(/^\s*\[mcp_servers\.(?:"[^"]+"|[\w-]+)\s*\]/gm) || []).length;
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
  return out;
}

function repo(dir, ctx) {
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
  const gi = `${cfg.readText(f('.gitignore')) || ''}\n${cfg.readText(f('.git/info/exclude')) || ''}`;
  add(/\.ai-work\/?/.test(gi) ? 'ok' : 'warn', /\.ai-work\/?/.test(gi) ? '.ai-work/ is excluded locally' : '.ai-work/ is not in .git/info/exclude', /\.ai-work\/?/.test(gi) ? '' : 'askai project hide-local');
  if (fs.existsSync(f('graphify-out')) && !/graphify-out\/?/.test(gi)) add('warn', 'graphify-out/ is not excluded locally', 'askai project hide-local');
  const slash = fs.existsSync(f('.cursor/commands/askai-cli.md')) && fs.existsSync(f('.cursor/commands/askai-plugins.md'));
  add(slash ? 'ok' : 'warn', slash ? 'Cursor commands /askai-cli and /askai-plugins are in this project' : 'Cursor commands /askai-cli and /askai-plugins are missing in this project', slash ? '' : 'askai init');
  const hs = require('./session').handoffState(dir);
  const handoffMsg = { missing: ['warn', 'no .ai-work/HANDOFF.md', 'askai session init'], template: ['warn', 'HANDOFF.md is the empty template', 'askai handoff "next step"'], draft: ['warn', 'HANDOFF.md is a draft', 'askai handoff "next step"'], stale: ['info', `handoff is stale (${Math.round(hs.ageMin)} min)`, 'askai resume'], fresh: ['ok', `handoff is fresh (${Math.round(hs.ageMin)} min)`, ''], complete: ['ok', `handoff is complete (${Math.round(hs.ageMin)} min)`, ''] }[hs.state];
  if (handoffMsg) add(handoffMsg[0], handoffMsg[1], handoffMsg[2]);
  const drifted = agentDrift(dir, ctx);
  if (drifted.length) add('warn', `agents.drift: generated agent files differ from the current tiers (${drifted.join(', ')})`, 'askai project refresh --agents');
  for (const rel of ['docs/ai/SOURCE_INDEX.md', 'graphify-out/GRAPH_REPORT.md']) {
    const n = lines(f(rel));
    if (n != null && n > 200) add('warn', `${rel} is a large file (${n} lines)`, 'use graphify query or search; do not read it whole');
  }
  return out;
}

function agentDrift(dir, ctx) {
  const models = require('./models');
  const prefs = ctx && ctx.paths ? models.load(ctx) : models.DEFAULTS;
  const tierOf = { architect: 'lead', builder: 'build', runner: 'chore' };
  const places = [['.claude/agents', 'claude'], ['.cursor/agents', 'cursor'], ['.codex/agents', 'codex'], ['.agents/agents', 'agy']];
  const names = [];
  for (const [rel, tool] of places) {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, rel)); } catch (_) { continue; }
    for (const n of files) {
      const tier = tierOf[n.replace(/\.(md|toml)$/, '')];
      if (!tier) continue;
      const text = cfg.readText(path.join(dir, rel, n)) || '';
      const model = (/^model:\s*(\S+)/m.exec(text) || /^model = "([^"]+)"/m.exec(text) || [])[1];
      const effort = (/^effort:\s*(\S+)/m.exec(text) || /^model_reasoning_effort = "([^"]+)"/m.exec(text) || [])[1];
      const want = models.pick(prefs, tool, tier);
      if ((model && model !== want.model) || (effort && effort !== want.effort)) names.push(n.replace(/\.(md|toml)$/, ''));
    }
  }
  return names;
}
function run(ctx, dir, o = {}, print = console.log) {
  const findings = require('./findings');
  if (o.fix && dir && o.dry) print(`would scaffold missing project files in ${dir}; dry-run made no changes`);
  if (o.fix && dir && !o.dry) {
    const scaffold = require('./scaffold');
    const session = require('./session');
    scaffold.run(dir, {}, () => {}); session.ensure(dir, false);
    print(`fixed what can be fixed in ${dir} (scaffold, .ai-work); machine items: run the commands listed`);
    findings.forget(ctx, dir);
  }
  const rows = findings.collectFindings(ctx, dir);
  const n = s => rows.filter(r => r.severity === s).length;
  if (o.brief) { print(`check: ${n('ok')} ok, ${n('later')} to improve, ${n('now')} failing`); return n('now') ? 1 : 0; }
  if (o.json) { print(JSON.stringify(rows, null, 2)); return rows.some(r => r.severity === 'now') ? 1 : 0; }
  print('Tool coverage (local configuration checks; not live sign-in verification):');
  for (const [host, label] of [['claude', 'Claude Code'], ['codex', 'Codex'], ['agy', 'Antigravity'], ['cursor', 'Cursor']]) {
    const found = rows.filter(r => r.host === host && r.severity !== 'info');
    const selected = cursor.targetIncludes(ctx.manifest && ctx.manifest.target, host);
    const text = !selected ? 'not selected for installation'
      : !found.length ? 'not checked: CLI or configuration unavailable'
      : `${found.filter(r => r.severity === 'ok').length} ok, ${found.filter(r => r.severity === 'later').length} to improve, ${found.filter(r => r.severity === 'now').length} failing`;
    print(`  ${label}: ${text}`);
  }
  if (!o.all) print('Passing rows hidden; use askai check --all for details.');
  const mark = { ok: 'ok  ', later: 'fix ', now: 'FAIL', info: 'info' };
  const shown = o.all ? rows : rows.filter(r => r.severity !== 'ok');
  let area = '';
  for (const r of shown) {
    if (r.group !== area) { area = r.group; print(`\n[${area}]`); }
    const again = r.fix && r.message.includes(r.fix);
    const msg = r.id ? String(r.message || '').replace(new RegExp('^' + r.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[: ]*'), '') : r.message;
    print(`  ${mark[r.severity]}  ${msg}${r.fix && !again ? `\n          -> ${r.fix}` : ''}`);
  }
  print(`\n${n('ok')} ok, ${n('later')} to improve, ${n('now')} failing.${dir ? '' : ' Add a folder (askai check .) to audit a repository too.'} \`askai ask <topic>\` explains any rule.`);
  if (dir) {
    print(require('./validate-files').validateFiles(dir).text);
  }
  return n('now') ? 1 : 0;
}

module.exports = { run, machine, repo };
