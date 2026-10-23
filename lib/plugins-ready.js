'use strict';
// askai plugins ready [dir]: what the connected token tools do on a prompt, and the few steps
// still waiting. A connected MCP server does not read the prompt. The agent calls it when the task matches.
const fs = require('fs');
const path = require('path');

const ROWS = [
  ['serena', 'Serena', 'You ask where a symbol or call path lives.', 'The agent calls its symbol tools.'],
  ['context7', 'Context7', 'You ask for the current docs of a library.', 'The agent fetches those docs.'],
  ['headroom', 'Headroom', 'A tool result is large.', 'The agent can compress that result. Leave its proxy off.'],
  ['context-mode', 'Context Mode', 'A command would print a long log.', 'The agent can run that command through Context Mode.'],
  ['graphify', 'Graphify', 'You ask how parts of this repo connect, after the graph exists.', 'The one-time build is graphify update . It reads source only and spends no tokens. Later questions use graphify query. /graphify . also reads docs and images and spends tokens, and it needs the Graphify skill in that session.'],
  ['rtk', 'RTK', 'A shell command runs where the RTK hook is installed.', 'The hook shortens that output. There is no per-prompt command.'],
  ['lsp', 'Claude LSP', 'You are navigating code in Claude Code.', 'The LSP plugins jump to symbols. They do not run in Cursor.'],
  ['caveman', 'Caveman', 'Every reply.', 'The terse rule is in the instruction files. The plugin command is Claude Code only.'],
  ['base-tools', 'ripgrep, jq, gh', 'The agent searches or inspects a file.', 'The agent runs these commands. They do not start on their own.'],
  ['markitdown', 'MarkItDown', 'You convert a document or a video.', 'askai convert runs it. It does not watch prompts.'],
];

function ready(ctx, dir) {
  const servers = (() => { try { return require('./mcp').list(ctx); } catch (_) { return []; } })();
  const on = name => servers.some(s => s.state === 'on' && s.name.toLowerCase().includes(name));
  const which = bin => !!(ctx.which && ctx.which(bin));
  let plugins = {};
  try { plugins = require('./claude-config').readJson(ctx.paths.settings).enabledPlugins || {}; } catch (_) { /* none */ }
  const pluginOn = id => Object.keys(plugins).some(k => k.startsWith(id) && plugins[k] !== false);
  let claudeRtk = false; let cursorRtk = false;
  try { claudeRtk = require('./components').rtkHooked(ctx); } catch (_) { /* settings unreadable */ }
  try { cursorRtk = require('./cursor').rtkHooked(ctx); } catch (_) { /* no Cursor hooks file */ }
  const graph = !!(dir && fs.existsSync(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md')));
  const actions = [];
  const tools = ROWS.map(([id, name, when, act]) => {
    let state = 'not installed';
    if (id === 'graphify') {
      state = which('graphify') ? (dir ? (graph ? 'graph built' : 'installed, graph not built') : 'installed') : 'not installed';
      if (which('graphify') && dir && !graph) actions.push({ id, run: 'graphify update .', tokens: false, why: 'One-time step inside /askai-plugins. It reads source with tree-sitter and spends no tokens. /graphify . also reads docs and images and spends tokens; run that only when asked.' });
    } else if (id === 'rtk') {
      const hooks = [claudeRtk && 'Claude Code', cursorRtk && 'Cursor'].filter(Boolean);
      state = which('rtk') ? (hooks.length ? `hook on ${hooks.join(' and ')}` : 'installed, hook not registered') : 'not installed';
      if (which('rtk') && !hooks.length) actions.push({ id, run: 'askai install --only rtk,cursor-rtk --yes', tokens: false, why: 'Register the shell hook. It then runs on shell commands by itself.' });
    } else if (id === 'lsp') {
      state = pluginOn('typescript-lsp') || pluginOn('pyright-lsp') ? 'enabled in Claude Code' : 'not installed';
    } else if (id === 'caveman') {
      const files = [ctx.paths && ctx.paths.claudeMd, ctx.cursorPaths && path.join(ctx.cursorPaths.home, 'rules', 'askai-tokens.mdc')].filter(Boolean);
      const rule = files.some(f => { try { return /caveman/i.test(fs.readFileSync(f, 'utf8')); } catch (_) { return false; } });
      state = rule ? 'always on in the rules' : (pluginOn('caveman') ? 'Claude plugin enabled' : 'not installed');
    } else if (id === 'base-tools') {
      const have = ['rg', 'jq', 'gh'].filter(which);
      state = have.length === 3 ? 'on PATH, the agent calls them' : (have.length ? `partial: ${have.join(', ')}` : 'not installed');
    } else if (id === 'markitdown') {
      state = which('markitdown') ? 'on PATH, runs only when you convert a file' : 'not installed';
    } else {
      const connected = on(id) || (id === 'context-mode' && pluginOn('context-mode'));
      state = connected ? 'connected, waits for a matching task' : (which(id) ? 'program installed, server off' : 'not installed');
    }
    return { id, name, state, when, act };
  });
  return { tools, actions, note: 'A connected server does not read each prompt. The agent calls it when the task matches. /askai-plugins does the actions below, then follows that rule for the rest of the chat.' };
}
function render(report) {
  const out = [];
  for (const t of report.tools) {
    const next = report.actions.find(a => a.id === t.id);
    out.push(`${t.id.padEnd(14)} ${t.state}${next ? `  next: ${next.run}` : ''}`);
  }
  out.push('when and what happens: askai plugins info <id>');
  return out.join('\n');
}
module.exports = { ready, render, ROWS };
