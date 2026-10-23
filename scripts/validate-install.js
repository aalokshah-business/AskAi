#!/usr/bin/env node
'use strict';
// Read-only check of an AskAI install on THIS machine: every check that does not need typing inside a tool, then the list of
// what to type inside each tool. Writes nothing. Works on Windows, macOS, Linux and WSL; needs only Node.
//   node scripts/validate-install.js [repo-folder] [--json]
// Exit code 1 when anything FAILs. Paste the output when asking for help: the home folder is shown as ~ and no secrets are printed.
const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const { targetIncludes } = require('../lib/cursor');
const args = process.argv.slice(2); const asJson = args.includes('--json'); const filesOnly = args.includes('--files'); const repoArg = args.find(a => !a.startsWith('--'));
const HOME = os.homedir(); const tilde = s => String(s).split(HOME).join('~');
const DIR = { claude: path.join(HOME, '.claude'), codex: process.env.CODEX_HOME || path.join(HOME, '.codex'), agy: path.join(HOME, '.gemini'), cursor: path.join(HOME, '.cursor') };
const askaiDir = require('../lib/claude-config').claudePaths(DIR.claude, false).askaiDir;
const repo = repoArg ? path.resolve(repoArg) : null;
const want = { claude: [], codex: [], agy: [], cursor: [] }; // MCP servers each tool should have (filled from the manifest below)
const rows = []; const add = (level, area, msg, fix) => rows.push({ level, area, msg, fix: fix || '' });
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
const readJ = f => { try { return JSON.parse(read(f)); } catch (_) { return null; } };
const has = (f, re) => { const t = read(f); return t !== null && re.test(t); };
const exists = f => fs.existsSync(f);
const which = b => cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', [b], { encoding: 'utf8' }).status === 0;

// ---- AskAI itself --------------------------------------------------------------------------------------------------------
const appJs = path.join(askaiDir, 'app', 'askai.js');
if (!exists(appJs)) {
  add('FAIL', 'askai', 'AskAI is not installed on this machine', 'run the one-line install from the README (it ends with your to-do list)');
  finish();
}
const run = a => { const r = cp.spawnSync(process.execPath, [appJs, ...a], { encoding: 'utf8', timeout: 180000, env: process.env }); return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }; };
const manifest = readJ(path.join(askaiDir, 'manifest.json')) || {};
const comps = manifest.components || {};
const selected = host => targetIncludes(manifest.target, host);
if (filesOnly) add('PASS', 'askai', 'command checks skipped (--files); askai setup already ran them');
else {
const ver = run(['version']).out.trim();
/^\d+\.\d+\.\d+$/.test(ver) ? add('PASS', 'askai', `version ${ver}`) : add('FAIL', 'askai', `askai version printed "${tilde(ver).slice(0, 80)}"`, 'run the one-line install again');
const srcVer = (readJ(path.join(askaiDir, 'src', 'package.json')) || {}).version;
if (srcVer && srcVer !== ver) add('WARN', 'askai', `installed ${ver} but the downloaded source is ${srcVer}`, 'askai upgrade');
which(process.platform === 'win32' ? 'askai.cmd' : 'askai') ? add('PASS', 'askai', '`askai` is on PATH in this terminal') : add('WARN', 'askai', '`askai` is not on PATH in this terminal', `open a NEW terminal (PATH changes need one); or run: node ${tilde(appJs)}`);
Object.keys(comps).length ? add('PASS', 'askai', `manifest: profile ${manifest.profile || '?'}, target ${manifest.target || '?'}, ${Object.keys(comps).length} components recorded`) : add('FAIL', 'askai', 'manifest has no components: nothing was installed', 'askai install --yes --target all --profile max --project <repo>');
const helpN = (run(['help', 'all']).out.match(/^askai /gm) || []).length;
helpN >= 45 ? add('PASS', 'askai', `askai help all prints ${helpN} commands`) : add('FAIL', 'askai', `askai help all printed only ${helpN} commands`);
for (const [v, lvl, why] of [['ANTHROPIC_API_KEY', 'FAIL', 'Claude Code bills this key, not your plan'], ['ANTHROPIC_BASE_URL', 'FAIL', 'Claude Code goes through a proxy'], ['OPENAI_API_KEY', 'WARN', 'Codex may bill the API']]) if (process.env[v] && selected(v === 'OPENAI_API_KEY' ? 'codex' : 'claude')) add(lvl, 'billing', `${v} is set in this terminal: ${why}`, `unset it (and remove it from your shell profile), then check /status inside the tool`);
const ready = run(['plugins', 'ready', '--json', ...(repo ? ['--path', repo] : [])]);
ready.code === 0 && /"tools"/.test(ready.out) ? add('PASS', 'askai', 'askai plugins ready reports which tools wait and which one-time step is left') : add('FAIL', 'askai', 'askai plugins ready failed', tilde(ready.out.split('\n').slice(0, 3).join(' | ')));
const infra = run(['infra', ...(repo ? [repo] : [])]);
infra.code === 0 && /\[Repository\]|CLI /.test(infra.out) ? add('PASS', 'askai', 'askai infra runs') : add('FAIL', 'askai', 'askai infra failed', tilde(infra.out.split('\n').slice(0, 3).join(' | ')));
const todo = run(['todo', ...(repo ? [repo] : [])]);
todo.code === 0 ? add('PASS', 'askai', `askai todo: ${(todo.out.match(/(\d+) open/) || [0, 'no'])[1]} item(s) for you (sign-ins, restarts, settings)`) : add('FAIL', 'askai', 'askai todo failed', tilde(todo.out.slice(0, 160)));
const chk = run(['check', ...(repo ? [repo] : [])]); const failing = Number((chk.out.match(/(\d+) failing/) || [0, 0])[1]); const toImprove = Number((chk.out.match(/(\d+) to improve/) || [0, 0])[1]);
if (failing) add('FAIL', 'check', `askai check: ${failing} failing: ${tilde(chk.out.split('\n').filter(l => /^\s*FAIL/.test(l)).map(l => l.trim()).join(' | '))}`, 'askai check --fix');
else add('PASS', 'check', `askai check: no failing items${toImprove ? ` (${toImprove} to improve: askai check --fix)` : ''}`);
}

// ---- what was installed, per tool: the manifest says what AskAI believes, the files say what is true -----------------
const hostsOf = id => (comps[id] && comps[id].hosts) || [];
for (const [h, id] of [['claude', 'serena'], ['codex', 'codex-serena'], ['agy', 'agy-serena'], ['cursor', 'cursor-serena']]) if (comps[id]) want[h].push('serena');
for (const [id, name] of [['headroom', 'headroom'], ['context7', 'context7'], ['codebase-memory', 'codebase-memory-mcp']]) for (const h of hostsOf(id)) if (want[h]) want[h].push(name);
const mcpHas = (h, name) => {
  if (h === 'codex') return has(path.join(DIR.codex, 'config.toml'), new RegExp(`^\\[mcp_servers\\.${name}\\]`, 'm'));
  const f = h === 'claude' ? path.join(HOME, '.claude.json') : h === 'cursor' ? path.join(DIR.cursor, 'mcp.json') : path.join(DIR.agy, 'config', 'mcp_config.json');
  const j = readJ(f); return !!(j && j.mcpServers && j.mcpServers[name]);
};
const NAME = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', cursor: 'Cursor' };
function mcp(h) {
  const missing = want[h].filter(n => !mcpHas(h, n));
  if (!want[h].length) return add('PASS', NAME[h], 'no MCP servers expected (profile has none)');
  missing.length ? add('FAIL', NAME[h], `MCP servers missing from its config: ${missing.join(', ')}`, `askai install --only ${missing.map(n => n === 'codebase-memory-mcp' ? 'codebase-memory' : n === 'serena' ? (h === 'claude' ? 'serena' : `${h}-serena`) : n).join(',')} --force`) : add('PASS', NAME[h], `MCP servers in its config: ${want[h].join(', ')}`);
}

if (!selected('claude')) add('PASS', 'Claude Code', `not part of this install. ${tilde(askaiDir)} is AskAI's own folder, not Claude Code`);
else if (!which('claude') && !exists(path.join(DIR.claude, 'settings.json')) && !comps.baseline && !comps.caveman) add('PASS', 'Claude Code', `Claude Code is not installed here. ${tilde(askaiDir)} is AskAI's own folder, so Claude file checks are skipped`);
else if (exists(DIR.claude)) {
  const s = readJ(path.join(DIR.claude, 'settings.json'));
  if (!s) add('FAIL', 'Claude Code', '~/.claude/settings.json is missing or unreadable', 'askai install --only baseline');
  else {
    add(s.model && !/opus/i.test(s.model) ? 'PASS' : 'WARN', 'Claude Code', `default model ${s.model || 'not set'}`, 'askai install --only baseline');
    const hookOk = ev => JSON.stringify((s.hooks || {})[ev] || []).includes('askai');
    comps['prompt-hooks'] ? (hookOk('SessionStart') && hookOk('UserPromptSubmit') ? add('PASS', 'Claude Code', 'reminder hooks registered (SessionStart, UserPromptSubmit)') : add('FAIL', 'Claude Code', 'reminder hooks missing', 'askai install --only prompt-hooks --force')) : 0;
    comps.statusline ? (s.statusLine && /askai/.test(JSON.stringify(s.statusLine)) ? add('PASS', 'Claude Code', 'status line set') : add('WARN', 'Claude Code', 'AskAI status line not set (you may have your own)', 'askai install --only statusline')) : 0;
    comps.rtk ? (JSON.stringify(s.hooks || {}).includes('rtk') ? add('PASS', 'Claude Code', 'RTK hook registered') : add('WARN', 'Claude Code', 'RTK recorded but its hook is not in settings.json', 'askai install --only rtk --force')) : 0;
    const plug = Object.keys(s.enabledPlugins || {}).join(' ');
    for (const [id, re, label] of [['caveman-plugin', /caveman/i, 'Caveman'], ['context-mode', /context-mode/i, 'Context Mode'], ['code-intel', /lsp/i, 'LSP'], ['claude-mem', /claude-mem/i, 'claude-mem']]) if (comps[id]) add(re.test(plug) ? 'PASS' : 'WARN', 'Claude Code', `${label} plugin ${re.test(plug) ? 'enabled' : 'recorded but not in enabledPlugins: check /plugin inside Claude Code'}`);
  }
  has(path.join(DIR.claude, 'CLAUDE.md'), /askai:begin/) ? add('PASS', 'Claude Code', 'rules block in ~/.claude/CLAUDE.md') : add('FAIL', 'Claude Code', 'AskAI rules block missing from ~/.claude/CLAUDE.md', 'askai install --only caveman');
  exists(path.join(DIR.claude, 'commands', 'askai-cli.md')) ? add('PASS', 'Claude Code', '/askai-cli command present') : add('FAIL', 'Claude Code', '/askai-cli command missing', 'askai install --target all --yes');
  exists(path.join(DIR.claude, 'commands', 'askai-plugins.md')) ? add('PASS', 'Claude Code', '/askai-plugins command present') : add('FAIL', 'Claude Code', '/askai-plugins command missing', 'askai install --target all --yes');
  mcp('claude');
  which('claude') ? add('PASS', 'Claude Code', 'CLI on PATH') : add('WARN', 'Claude Code', 'CLI not on PATH in this terminal');
}
if (selected('codex') && exists(DIR.codex)) {
  has(path.join(DIR.codex, 'AGENTS.md'), /askai:begin/) ? add('PASS', 'Codex', 'rules block in ~/.codex/AGENTS.md') : add('FAIL', 'Codex', 'AskAI rules block missing from ~/.codex/AGENTS.md', 'askai install --only codex-rules');
  has(path.join(DIR.codex, 'config.toml'), /model_reasoning_effort/) ? add('PASS', 'Codex', 'config.toml has the effort setting') : add('WARN', 'Codex', 'no model_reasoning_effort in config.toml', 'askai install --only codex-baseline');
  exists(path.join(HOME, '.agents', 'skills', 'askai-cli', 'SKILL.md')) ? add('PASS', 'Codex', '$askai-cli skill present') : add('FAIL', 'Codex', '$askai-cli skill missing', 'askai install --target all --yes');
  exists(path.join(HOME, '.agents', 'skills', 'askai-plugins', 'SKILL.md')) ? add('PASS', 'Codex', '$askai-plugins skill present') : add('FAIL', 'Codex', '$askai-plugins skill missing', 'askai install --target all --yes');
  mcp('codex'); which('codex') ? add('PASS', 'Codex', 'CLI on PATH') : add('WARN', 'Codex', 'CLI not on PATH in this terminal');
}
if (selected('agy') && exists(DIR.agy)) {
  has(path.join(DIR.agy, 'GEMINI.md'), /askai:begin/) ? add('PASS', 'Antigravity', 'rules block in ~/.gemini/GEMINI.md') : add('FAIL', 'Antigravity', 'AskAI rules block missing from ~/.gemini/GEMINI.md', 'askai install --only agy-rules');
  const set = readJ(path.join(DIR.agy, 'antigravity-cli', 'settings.json')) || {};
  set.useG1Credits === true ? add('FAIL', 'Antigravity', 'useG1Credits is true: paid credits can be spent silently', 'set it to false (askai check --fix)') : add('PASS', 'Antigravity', 'paid credits are off');
  exists(path.join(DIR.agy, 'antigravity-cli', 'skills', 'askai-cli', 'SKILL.md')) || exists(path.join(DIR.agy, 'config', 'skills', 'askai-cli', 'SKILL.md')) ? add('PASS', 'Antigravity', 'askai-cli skill present') : add('FAIL', 'Antigravity', 'askai-cli skill missing', 'askai install --target all --yes');
  exists(path.join(DIR.agy, 'antigravity-cli', 'skills', 'askai-plugins', 'SKILL.md')) || exists(path.join(DIR.agy, 'config', 'skills', 'askai-plugins', 'SKILL.md')) ? add('PASS', 'Antigravity', 'askai-plugins skill present') : add('FAIL', 'Antigravity', 'askai-plugins skill missing', 'askai install --target all --yes');
  mcp('agy'); which('agy') ? add('PASS', 'Antigravity', 'CLI (agy) on PATH') : add('WARN', 'Antigravity', 'CLI (agy) not on PATH in this terminal');
}
if (selected('cursor') && exists(DIR.cursor)) {
  exists(path.join(DIR.cursor, 'rules', 'askai-tokens.mdc')) ? add('PASS', 'Cursor', 'always-on rules file present') : add('FAIL', 'Cursor', '~/.cursor/rules/askai-tokens.mdc missing', 'askai install --only cursor-rules');
  for (const name of ['askai-cli', 'askai-plugins']) {
    const projectCommand = repo && path.join(repo, '.cursor', 'commands', `${name}.md`);
    const globalCommand = path.join(DIR.cursor, 'commands', `${name}.md`);
    if (projectCommand && exists(projectCommand)) add('PASS', 'Cursor', `/${name} command in project workspace root`);
    else if (exists(globalCommand)) add(repo ? 'WARN' : 'PASS', 'Cursor', `/${name} global command present${repo ? ', but project command missing (remote workspaces may not see global commands)' : ''}`, repo ? `askai init ${tilde(repo)} --refresh --yes` : '');
    else add('FAIL', 'Cursor', `/${name} command missing`, repo ? `askai init ${tilde(repo)} --refresh --yes` : 'askai install --target cursor --yes');
  }
  mcp('cursor');
}

// ---- the repository -----------------------------------------------------------------------------------------------------
if (repo) {
  const f = p => path.join(repo, p);
  const need = require('../lib/validate-files').NEED.slice();
  const agents = [['claude', '.claude/agents', 'md'], ['codex', '.codex/agents', 'toml'], ['cursor', '.cursor/agents', 'md'], ['agy', '.agents/agents', 'md']].filter(([h]) => selected(h) && exists(DIR[h]));
  for (const [, d, ext] of agents) for (const n of ['architect', 'builder', 'runner']) need.push(`${d}/${n}.${ext}`);
  for (const d of ['.claude/skills', '.agents/skills']) for (const n of ['architecture-map', 'prompt-refiner', 'investigate-bug', 'verify-and-review']) need.push(`${d}/${n}/SKILL.md`);
  const missing = need.filter(p => !exists(f(p)));
  missing.length ? add('FAIL', 'repo', `${missing.length} project file(s) missing: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}`, `askai init ${tilde(repo)}`) : add('PASS', 'repo', `all ${need.length} project files present (router, docs/ai, subagents, skills)`);
  const lines = (read(f('AGENTS.md')) || '').split('\n').length;
  if (exists(f('AGENTS.md'))) lines <= 333 ? add('PASS', 'repo', `AGENTS.md is ${lines} lines (limit 333)`) : add('FAIL', 'repo', `AGENTS.md is ${lines} lines (limit 333): it loads every session`, 'move detail into docs/ai/ and keep AGENTS.md a router');
  for (const n of ['architect', 'builder', 'runner']) {
    const m = (read(f(`.agents/agents/${n}.md`)) || '').match(/^model:\s*(\S+)/m);
    if (m && !['inherit', 'flash_lite', 'flash', 'pro'].includes(m[1])) add('FAIL', 'repo', `Antigravity agent ${n} has model "${m[1]}": Antigravity skips the file unless it is inherit, flash_lite, flash or pro`, 'askai init --refresh');
    const c = (read(f(`.codex/agents/${n}.toml`)) || '').match(/^model\s*=\s*"([^"]+)"/m);
    if (c && !['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5'].includes(c[1])) add('WARN', 'repo', `Codex agent ${n} uses ${c[1]}: confirm it is offered on your plan (/model inside Codex)`, 'askai models set codex.<tier> <id>:<effort>');
  }
  const excluded = [f('.gitignore'), f('.git/info/exclude')].some(p => has(p, /\.ai-work\/?/));
  excluded ? add('PASS', 'repo', '.ai-work/ is excluded from Git') : add('WARN', 'repo', '.ai-work/ is not excluded from Git: handoffs could be committed', 'askai project hide-local');
} else add('WARN', 'repo', 'no repository given, so project files were not checked', 'node scripts/validate-install.js <repo-folder>');
finish();

// ---- report ---------------------------------------------------------------------------------------------------------------
function finish() {
  const n = l => rows.filter(r => r.level === l).length;
  if (asJson) { console.log(JSON.stringify({ rows, pass: n('PASS'), warn: n('WARN'), fail: n('FAIL') }, null, 2)); process.exit(n('FAIL') ? 1 : 0); }
  console.log(`AskAI validation (${os.platform()}, Node ${process.versions.node})${repo ? `, repository ${tilde(repo)}` : ''}\n`);
  for (const r of rows) console.log(`${r.level.padEnd(4)}  ${r.area.padEnd(11)} ${tilde(r.msg)}${r.level !== 'PASS' && r.fix ? `\n${' '.repeat(18)}fix: ${tilde(r.fix)}` : ''}`);
  console.log(`\n${n('PASS')} pass, ${n('WARN')} warn, ${n('FAIL')} FAIL`);
  const inTool = [];
  if (selected('claude') && exists(DIR.claude)) inTool.push('Claude Code (new session in the project): /status shows your plan, not API billing; /mcp lists ' + (want.claude.join(', ') || 'no servers') + '; /plugin lists the plugins above; /askai-cli opens the terminal; /askai-plugins does one-time plugin setup.');
  if (selected('codex') && exists(DIR.codex)) inTool.push('Codex: /mcp lists ' + (want.codex.join(', ') || 'no servers') + '; $askai-cli opens the AskAI terminal; $askai-plugins does one-time plugin setup; /model offers the models on your plan.');
  if (selected('agy') && exists(DIR.agy)) inTool.push('Antigravity: /mcp lists ' + (want.agy.join(', ') || 'no servers') + '; /skills shows askai-cli and askai-plugins; /model lists available models; app settings: AI Credit Overages = Never.');
  if (selected('cursor') && exists(DIR.cursor)) inTool.push('Cursor (quit and reopen first): open the project folder as the workspace root; Settings, Rules shows AskAI rules; Settings, MCP lists ' + (want.cursor.join(', ') || 'no servers') + '; type /askai-cli or /askai-plugins in Agent chat; choose an available model in Settings, Models.');
  if (inTool.length) console.log('\nStill to check by hand, inside each tool:\n' + inTool.map(l => `  - ${l}`).join('\n'));
  console.log('\nDaily flow: askai next; askai go <tool> "task"; askai run -- <command>; askai break; askai handoff "next step"; askai clear; askai resume.\nWeekly: askai savings --week; askai check.\nRead-only previews: askai update --dry-run; askai uninstall --dry-run.');
  process.exit(n('FAIL') ? 1 : 0);
}
