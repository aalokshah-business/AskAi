'use strict';
// askai todo [dir] [done <id> | undo <id>]: everything only you can do, per tool and for the repository: sign-ins, app settings,
// restarts, model IDs to confirm, one-time steps a plugin needs, and project files that still hold placeholders.
// "auto" items are checked every time and disappear once done; "confirm" items stay until you run askai todo done <id>.
const fs = require('fs');
const path = require('path');

const doneFile = ctx => path.join(ctx.paths.askaiDir, 'todo-done.json');
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
function present(ctx) {
  const ex = p => !!p && fs.existsSync(p); const w = b => !!(ctx.which && ctx.which(b));
  return { claude: ex(ctx.paths.settings) || w('claude'), codex: !!ctx.codexPaths && (ex(ctx.codexPaths.home) || w('codex')),
    agy: !!ctx.agyPaths && (ex(ctx.agyPaths.home) || w('agy')), cursor: !!ctx.cursorPaths && (ex(ctx.cursorPaths.home) || w('agent') || w('cursor')) };
}
function collectItems(ctx, dir) {
  const out = []; const add = (area, id, text, how, auto, habit) => out.push({ area, id, text, how, auto: !!auto, habit: !!habit });
  const p = present(ctx); const man = (ctx.manifest && ctx.manifest.components) || {};
  const has = id => !!man[id] && Object.keys(man[id]).length > 1;
  let servers = []; try { servers = require('./mcp').list(ctx); } catch (_) { /* none */ }
  const reg = name => servers.some(s => s.name === name && s.state === 'on');
  for (const [v, why] of [['ANTHROPIC_API_KEY', 'Claude Code bills this key, not your plan'], ['ANTHROPIC_BASE_URL', 'Claude Code goes through a proxy'], ['OPENAI_API_KEY', 'Codex may bill the API']]) if (process.env[v]) add('All tools', `unset-${v.toLowerCase()}`, `Unset ${v}: ${why}`, 'askai guide install (section on billing variables)', true);
  if (p.claude) {
    add('Claude Code', 'claude-signin', 'Sign in with your plan; /status must show Pro, Max or Team, not an API key', 'claude, then /login and /status', false, true);
    add('Claude Code', 'claude-restart', 'Open a new session after installing, so settings, hooks, plugins and MCP servers load', 'exit Claude Code and start it again');
    if (has('code-intel')) add('Claude Code', 'lsp-check', 'Check the LSP plugins loaded', '/plugin inside Claude Code');
    if (has('caveman-plugin')) add('Claude Code', 'caveman-level', 'Pick the Caveman plugin level once', '/caveman lite | full | ultra');
    if (has('context-mode')) add('Claude Code', 'ctx-stats', 'See what Context Mode saves after a day', '/context-mode:ctx-stats');
    if (has('claude-mem')) add('Claude Code', 'claude-mem-worker', 'Restart Claude Code so claude-mem starts its worker; it summarises sessions with Claude in the background, which uses your plan', 'restart, then check ~/.claude-mem/logs');
  }
  if (p.codex) {
    add('Codex', 'codex-signin', 'Sign in with ChatGPT, not an API key', 'codex login status', false, true);
    add('Codex', 'codex-trust', 'Trust each project when Codex asks, so it loads .codex/agents and the project config', 'open codex in the repository and accept the trust prompt');
    add('Codex', 'codex-models', 'Confirm gpt-6.1-sol and gpt-6-luna are offered on your plan', '/model inside Codex; change one with askai models set codex.<tier> <id>', false, true);
  }
  if (p.agy) {
    add('Antigravity', 'agy-signin', 'Sign in; in the app set AI Credit Overages to Never', 'agy, then the app settings', false, true);
    add('Antigravity', 'agy-effort', 'At the start of each session pick Flash and high effort (agent files cannot carry effort)', '/model, then /effort high', false, true);
  }
  if (p.cursor) {
    add('Cursor', 'cursor-restart', 'Reload the window, then type / and choose askai-cli', dir ? `${dir}/.cursor/commands/askai-cli.md. On SSH or a devcontainer, ~/.cursor/commands on the remote is ignored. The window root must be this folder, not its parent.` : 'open the project folder that contains .cursor/commands/askai-cli.md, not its parent');
    add('Cursor', 'cursor-models', 'Settings, Models: Auto or Grok 4.7 for routine work; with a Premium plan switch AskAI to the Sonnet tiers', 'askai models set cursor.useSonnet true; IDs: agent models', false, true);
    if (!servers.length) add('Cursor', 'cursor-mcp', 'Settings, MCP: confirm the servers you want are on, switch off the rest', 'askai mcp', false, true);
  }
  if (reg('headroom')) add('All tools', 'headroom-check', 'After a big task, ask the agent for headroom_stats; keep its proxy mode off', 'inside the session: headroom_stats. askai savings runs headroom perf', false, true);
  if (reg('context7') && !(ctx.which && ctx.which('npx'))) add('All tools', 'context7-node', 'Install Node.js so npx can start Context7', 'askai guide install', true);
  if (has('rtk')) add('All tools', 'rtk-check', 'After a day, compare rtk gain with askai usage (its counter overstates savings)', 'rtk gain; askai usage 7');
  if (man['base-tools']) for (const [b, m] of [['rg', 'ripgrep'], ['jq', 'jq'], ['gh', 'gh']]) if (!(ctx.which && ctx.which(b))) add('All tools', `install-${b}`, `${m} is still missing`, require('./pkg').describe(ctx, b === 'rg' ? 'BurntSushi.ripgrep.MSVC' : b === 'jq' ? 'jqlang.jq' : 'GitHub.cli'), true);
  if (ctx.probe && ['ccusage', 'repomix'].some(b => !(ctx.which && ctx.which(b)))) {
    const npm = ctx.probe('npm', ['prefix', '-g']);
    if (npm && npm.ok) {
      const binDir = process.platform === 'win32' ? npm.stdout.trim() : path.join(npm.stdout.trim(), 'bin');
      const missing = ['ccusage', 'repomix'].filter(b => !(ctx.which && ctx.which(b)) && fs.existsSync(path.join(binDir, b + (process.platform === 'win32' ? '.cmd' : ''))));
      if (missing.length) add('All tools', 'npm-global-path', `${missing.join(' and ')} installed but npm global bin folder is missing from PATH`, `Add ${binDir} to PATH, then open a new terminal`, true);
    }
  }
  if (dir && fs.existsSync(path.join(dir, 'AGENTS.md'))) {
    const f = n => path.join(dir, n); const ag = read(f('AGENTS.md')) || '';
    if (/\(one or two sentences/.test(ag)) add('Repository', 'agents-about', 'Describe the project in AGENTS.md (two sentences)', `askai init ${dir} --about "..." --refresh`, true);
    if (/\(add the test, lint and build commands\)/.test(ag)) add('Repository', 'agents-commands', 'Add the test, lint and build commands to AGENTS.md', 'edit the Commands section', true);
    const map = read(f('docs/ai/PROJECT_MAP.md')) || ''; const empty = (map.match(/^\| `[^`]+\/` \| \d+ \| [^|]* \|\s*\|$/gm) || []).length;
    if (empty) add('Repository', 'map-purposes', `Fill the Purpose column for ${empty} folder(s) in docs/ai/PROJECT_MAP.md`, 'or ask the agent: "use the architecture-map skill"', true);
    const arch = read(f('docs/ai/ARCHITECTURE.md')) || '';
    if (/## Data flow\n- \n/.test(arch) || /## Critical invariants[^\n]*\n- \n/.test(arch) || /No flow verified automatically|No critical invariant stated explicitly/.test(arch)) add('Repository', 'architecture', 'Verify the data flow and critical invariants in docs/ai/ARCHITECTURE.md', 'review the generated evidence or use the architecture-map skill', true);
    const feat = read(f('docs/ai/FEATURES.md')) || ''; if (feat && !/^\| (?!Feature|---)[^|]+\|/m.test(feat)) add('Repository', 'features', 'List the main features in docs/ai/FEATURES.md, one line each', 'as you work, or ask the agent once', true);
    if (ctx.which && ctx.which('graphify') && !fs.existsSync(f('graphify-out/GRAPH_REPORT.md'))) add('Repository', 'graphify-build', 'Build the knowledge graph once from source (graphify update . spends no tokens)', '/askai-plugins', true);
  }
  const done = new Set((readJ(doneFile(ctx)) || {}).done || []);
  return out.map(i => ({ ...i, done: !i.auto && done.has(i.id) }));
}
function items(ctx, dir) {
  return require('./findings').view(ctx, 'todo', dir);
}
function mark(ctx, id, on = true) {
  const f = doneFile(ctx); const d = new Set((readJ(f) || {}).done || []);
  if (on) d.add(id); else d.delete(id);
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ done: [...d] }, null, 2));
}
const open = list => list.filter(i => !i.done && !i.habit);
function render(list, all = false) {
  const show = (all ? list : list.filter(i => !i.habit)).filter(i => all || !i.done);
  if (!show.length) {
    const habits = list.filter(i => i.habit && !i.done).length;
    return habits && !all ? `Nothing left to finish. ${habits} habits are in askai tips, not this list.` : 'Nothing left for you to do. AskAI checks again every time you run askai todo.';
  }
  const out = []; let area = '';
  for (const i of show) { if (i.area !== area) { area = i.area; out.push(`\n[${area}]`); } out.push(`  ${i.done ? '[x]' : '[ ]'} ${i.text}\n        how: ${i.how}   (${i.auto ? 'checked automatically' : `askai todo done ${i.id}`})`); }
  out.push('', `${open(list).length} open. Items marked "checked automatically" disappear once done; mark the others with askai todo done <id>.`);
  return out.join('\n').replace(/^\n/, '');
}
module.exports = { items, collectItems, mark, render, open, present, doneFile };
