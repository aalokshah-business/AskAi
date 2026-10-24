'use strict';
// askai 5.3: help for every command and flag, help all, a usage guide for every installable plugin, askai savings.
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, makeCtx, cli, fs, path } = require('./helpers');
const help = require('../lib/help');
const plugins = require('../lib/plugins');
const ug = require('../lib/usage-guide');
const savings = require('../lib/savings');
const infra = require('../lib/infra');
const todo = require('../lib/todo');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'askai.js'), 'utf8');
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };

test('every command has help, and askai help all prints all of them', () => {
  const cases = [...new Set([...SRC.matchAll(/^\s+case '([a-z-]+)'/gm)].map(m => m[1]))].filter(c => c !== 'version');
  for (const c of cases) assert.ok(help.has(c), `askai help ${c}`);
  const all = cli(['help', 'all']).out;
  for (const n of help.names()) assert.ok(all.includes(help.H[n].usage), `help all shows ${n}`);
  assert.match(cli([]).out + cli(['help']).out, /askai help all/);
});

test('public flags stay within the budget and advanced help keeps the full command form', () => {
  const surface = require('../lib/surface');
  assert.deepStrictEqual(surface.GLOBAL, ['--yes', '--dry-run', '--json', '--project']);
  for (const [name, , , flags] of surface.TIER1) {
    assert.ok(flags.length <= 4, name);
    const standard = help.render(name);
    for (const flag of flags) assert.ok(standard.includes(flag), `${name}: ${flag}`);
    assert.ok(help.render(name, { advanced: true }).includes(help.H[name].usage), name);
  }
});

test('every plugin AskAI can install has a usage guide: commands, check, savings, off switch', () => {
  for (const p of plugins.P) {
    if (!(p.how && (p.how.component || p.how.context7 || p.how.npm || p.how.graphify))) continue;
    const u = ug.get(p.id); assert.ok(u, `usage guide for ${p.id}`);
    assert.ok((u.terminal && u.terminal.length) || (u.agent && u.agent.length), `${p.id} has commands`);
    for (const k of ['check', 'savings', 'off']) assert.ok(u[k], `${p.id}.${k}`);
  }
  for (const id of ['caveman', 'lsp', 'ponytail', 'karpathy']) assert.ok(ug.get(id), id);
  const hr = cli(['plugins', 'info', 'headroom']).out;
  for (const w of ['headroom savings', 'headroom_compress', 'headroom_stats', 'Check it works', 'Switch it off', 'Careful']) assert.ok(hr.includes(w), w);
  assert.match(cli(['plugins', 'info', 'litellm']).out, /Not installed by AskAI/);
  assert.strictEqual(cli(['plugins', 'info']).code, 1);
});

test('askai savings runs the reports that exist and says how to add the others', () => withHome(h => {
  const bin = path.join(h, 'rtk' + (process.platform === 'win32' ? '.cmd' : ''));
  write(bin, process.platform === 'win32' ? '@echo Tokens saved: 1234 over 9 commands\r\n' : '#!/bin/sh\necho "Tokens saved: 1234 over 9 commands"\n');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  const ctx = makeCtx(h, {}, { tools: { rtk: bin } });
  const out = savings.report(ctx, 7, h);
  assert.match(out, /Tokens saved: 1234/); assert.match(out, /ccusage[\s\S]*not installed/); assert.match(out, /\/context-mode:ctx-stats/);
  write(path.join(h, 'graphify-out', 'GRAPH_REPORT.md'), '# g'); assert.match(savings.report(ctx, 7, h), /graph built/);
  assert.strictEqual(cli(['savings', '--claude-home', path.join(h, 'c')]).code, 0);
}));

test('infra points every installed plugin at its usage guide', () => withHome(h => {
  const ctx = makeCtx(h, {}, { tools: { markitdown: '/x/markitdown' } });
  assert.doesNotMatch(infra.render(infra.collect(ctx, null)), /\[Plugins/);
  const lines = [];
  plugins.list(ctx, s => lines.push(s));
  assert.match(lines.join('\n'), /markitdown/);
}));

test('weekly MCP calls and Codex models count event timestamps, with mtime fallback only for undated lines', () => withHome(h => {
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  const recent = new Date(Date.now() - 86400000).toISOString();
  const ctx = makeCtx(h);
  const claudeLog = path.join(h, 'projects', 'test.jsonl');
  write(claudeLog, [
    { timestamp: old, message: { content: [{ name: 'mcp__old__tool' }] } },
    { timestamp: recent, message: { content: [{ name: 'mcp__new__tool' }] } },
    { message: { content: [{ name: 'mcp__undated__tool' }] } },
  ].map(JSON.stringify).join('\n'));
  assert.deepStrictEqual(infra.mcpCalls(ctx), { new: 1, undated: 1 });
  const codexHome = path.join(h, '.codex');
  const codexLog = path.join(codexHome, 'sessions', 'test.jsonl');
  write(codexLog, [
    { timestamp: old, type: 'turn_context', payload: { model: 'old' } },
    { timestamp: recent, type: 'turn_context', payload: { model: 'new' } },
    { type: 'turn_context', payload: { model: 'undated' } },
  ].map(JSON.stringify).join('\n'));
  assert.deepStrictEqual(require('../lib/usage').codexModels(codexHome, 7), { new: 1, undated: 1 });
}));

test('Codex token increases belong to event dates, not session file mtime', () => withHome(h => {
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  const recent = new Date(Date.now() - 86400000).toISOString();
  const codexHome = path.join(h, '.codex');
  write(path.join(codexHome, 'sessions', 'test.jsonl'), [
    { timestamp: old, payload: { total_token_usage: { input_tokens: 100, output_tokens: 20 } } },
    { timestamp: recent, payload: { total_token_usage: { input_tokens: 150, output_tokens: 30 } } },
    { payload: { total_token_usage: { input_tokens: 170, output_tokens: 35 } } },
  ].map(JSON.stringify).join('\n'));
  const r = require('../lib/usage').codex(codexHome, 7);
  assert.deepStrictEqual([r.total.input, r.total.output, r.total.sessions], [70, 15, 1]);
  assert.strictEqual(r.byDay.length, 2);
  assert.deepStrictEqual(r.byDay.map(([, d]) => [d.input, d.output]), [[50, 10], [20, 5]]);
}));

test('infra finds Claude outside PATH, lists askai-cli.md and combines plugin with MCP state', () => withHome(h => {
  const claude = path.join(h, 'claude.exe');
  const ctx = makeCtx(h, {}, { claude, probe: cmd => ({ ok: cmd === claude, stdout: 'claude 2.0', stderr: '' }) });
  write(path.join(h, 'commands', 'askai-cli.md'), 'command');
  write(ctx.paths.settings, JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': true } }));
  write(ctx.paths.userJson, JSON.stringify({ mcpServers: { 'context-mode': {} } }));
  const r = infra.collect(ctx, null);
  assert.strictEqual(r.tools.claude.cli, 'claude 2.0');
  assert.ok(r.tools.claude.commands.includes('askai-cli.md'));
  assert.strictEqual(r.plugins.find(p => p.id === 'context-mode').state, 'claude configured, no call observed in available 7-day logs');
}));

test('plugins ready tells which tools wait and which one-time step is left', () => withHome(h => {
  const dir = path.join(h, 'repo');
  const ctx = makeCtx(h, { cursorHome: path.join(h, 'cursor') }, { tools: { graphify: '/fake/graphify', rtk: '/fake/rtk' } });
  write(ctx.cursorPaths.mcp, JSON.stringify({ mcpServers: { serena: { command: 'serena' }, context7: {} } }));
  write(ctx.paths.settings, JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': true } }));
  const report = require('../lib/plugins-ready').ready(ctx, dir);
  const row = id => report.tools.find(t => t.id === id);
  assert.strictEqual(row('serena').state, 'configured; live connection not verified');
  assert.strictEqual(row('context7').state, 'configured; live connection not verified');
  assert.strictEqual(row('headroom').state, 'not installed');
  assert.strictEqual(row('lsp').state, 'not installed');
  assert.strictEqual(row('markitdown').state, 'not installed');
  assert.strictEqual(row('context-mode').state, 'configured; live connection not verified');
  assert.strictEqual(row('graphify').state, 'installed, graph not built');
  assert.strictEqual(row('rtk').state, 'installed, hook not registered');
  assert.deepStrictEqual(report.actions.map(a => a.run), ['graphify update .', 'askai install --only rtk,cursor-rtk --yes']);
  assert.strictEqual(report.actions[0].tokens, false);
  write(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md'), '# g');
  write(ctx.cursorPaths.hooks, JSON.stringify({ hooks: { beforeShellExecution: [{ command: 'rtk hook cursor' }] } }));
  const done = require('../lib/plugins-ready').ready(ctx, dir);
  assert.strictEqual(done.tools.find(t => t.id === 'graphify').state, 'graph built');
  assert.match(done.tools.find(t => t.id === 'rtk').state, /hook on Cursor/);
  assert.deepStrictEqual(done.actions, []);
}));

test('infra marks an MCP server working only after a transcript call', () => withHome(h => {
  const cursorHome = path.join(h, 'cursor');
  const ctx = makeCtx(h, { cursorHome }, {});
  write(ctx.cursorPaths.mcp, JSON.stringify({ mcpServers: { serena: { command: 'serena' }, context7: { command: 'npx' } } }));
  write(path.join(cursorHome, 'projects', 'app', 'agent-transcripts', 'chat.jsonl'), [
    '{"role":"user","message":{"content":[{"type":"text","text":"namespaces user-serena user-context7"}]}}',
    '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"GetDynamicTools","input":{"namespace":"user-serena"}}]}}',
    '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"CallDynamicTool","input":{"namespace":"user-serena","toolName":"find_symbol"}}]}}',
  ].join('\n'));
  const r = infra.collect(ctx, null);
  assert.strictEqual(r.plugins.find(p => p.id === 'serena').state, 'cursor working, 1 call/7d');
  assert.strictEqual(r.plugins.find(p => p.id === 'context7').state, 'cursor configured, no call observed in available 7-day logs');
  assert.match(infra.render(r), /working means a transcript call/);
}));

test('todo names npm global bin folder when installed tools are absent from PATH', () => withHome(h => {
  const bin = path.join(h, 'npm-global');
  write(path.join(bin, 'ccusage' + (process.platform === 'win32' ? '.cmd' : '')), 'shim');
  const ctx = makeCtx(h, {}, { probe: (cmd, args) => ({ ok: cmd === 'npm' && args.join(' ') === 'prefix -g', stdout: bin + '\n' }) });
  const item = todo.items(ctx, null).find(i => i.id === 'npm-global-path');
  assert.ok(item && item.text.includes('ccusage') && item.how.includes(bin));
}));
