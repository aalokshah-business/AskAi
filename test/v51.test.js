'use strict';
// askai 5.1: the max profile; Headroom (MCP mode), Context7 and Graphify as install components for every tool in play.
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, readJson, write, makeCtx, cli, fs, path } = require('./helpers');
const comps = require('../lib/components');
const profiles = require('../lib/profiles');
const infra = require('../lib/infra');
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };
const ctxAll = (h, fakes) => makeCtx(h, { codexHome: path.join(h, 'codex'), agyHome: path.join(h, 'gemini'), cursorHome: path.join(h, 'cursor') }, fakes);

test('max profile: every optimiser in one command; opt-in components are off by default', () => {
  const max = profiles.get('max').components;
  for (const id of ['rtk', 'context-mode', 'caveman-plugin', 'headroom', 'graphify', 'context7', 'code-intel', 'base-tools', 'serena', 'markitdown', 'ccusage']) assert.ok(max.includes(id), id);
  for (const id of ['rtk', 'context-mode', 'headroom', 'graphify', 'context7', 'base-tools']) assert.ok(!profiles.get('coding').components.includes(id), `${id} is not in the default`);
});

test('headroom: uv tool, then an MCP server in Claude Code, Cursor, Antigravity and Codex; uninstall removes only its own', () => withHome(h => {
  const ctx = ctxAll(h, { tools: { uv: '/fake/uv', headroom: '/fake/headroom' } });
  write(ctx.paths.userJson, JSON.stringify({ mcpServers: { mine: { command: 'x' } } }));
  const c = comps.byId('headroom'); assert.strictEqual(c.detect(ctx).state, 'missing');
  c.install(ctx);
  assert.deepStrictEqual(readJson(ctx.paths.userJson).mcpServers.headroom, { command: '/fake/headroom', args: ['mcp', 'serve'] });
  assert.ok(readJson(ctx.cursorPaths.mcp).mcpServers.headroom && readJson(ctx.agyPaths.mcp).mcpServers.headroom);
  assert.match(fs.readFileSync(ctx.codexPaths.config, 'utf8'), /\[mcp_servers\.headroom\]\ncommand = "\/fake\/headroom"\nargs = \["mcp", "serve"\]/);
  assert.strictEqual(c.detect(ctx).state, 'ok');
  c.uninstall(ctx);
  assert.deepStrictEqual(Object.keys(readJson(ctx.paths.userJson).mcpServers), ['mine']);
  assert.ok(!/headroom/.test(fs.readFileSync(ctx.codexPaths.config, 'utf8')));
}));

test('context7 and graphify: registered for every tool in play; infra reflects them', () => withHome(h => {
  const ctx = ctxAll(h, { tools: { uv: '/fake/uv', graphify: '/fake/graphify', headroom: '/fake/headroom' } });
  comps.byId('context7').install(ctx);
  assert.deepStrictEqual(readJson(ctx.cursorPaths.mcp).mcpServers.context7, { command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
  comps.byId('headroom').install(ctx);
  const r = infra.collect(ctx, null);
  const hr = r.plugins.find(p => p.id === 'headroom'); assert.match(hr.state, /claude on/); assert.match(hr.state, /codex on/);
  assert.match(r.plugins.find(p => p.id === 'context7').state, /cursor on/);
  const dry = makeCtx(h, { dry: true, codexHome: path.join(h, 'codex'), agyHome: path.join(h, 'gemini'), cursorHome: path.join(h, 'cursor') }, { tools: { uv: '/fake/uv', graphify: '/fake/graphify' } });
  comps.byId('graphify').install(dry);
  for (const pl of ['claude', 'codex', 'cursor', 'antigravity']) assert.ok(dry.calls.some(x => x.includes(`install --platform ${pl}`)), `${pl}: ${dry.calls.join(' | ')}`);
}));

test('install --dry-run --profile max lists every optimiser for all four tools and writes nothing', () => withHome(h => {
  const r = cli(['install', '--dry-run', '--yes', '--profile', 'max', '--target', 'all', '--claude-home', path.join(h, 'c'), '--codex-home', path.join(h, 'x'), '--agy-home', path.join(h, 'g'), '--cursor-home', path.join(h, 'u')]);
  assert.strictEqual(r.code, 0, r.out);
  for (const id of ['rtk', 'cursor-rtk', 'codex-rtk', 'agy-rtk', 'context-mode', 'cursor-context-mode', 'caveman-plugin', 'headroom', 'graphify', 'context7', 'code-intel', 'base-tools', 'serena', 'codex-serena', 'agy-serena', 'cursor-serena']) assert.match(r.out, new RegExp(`\\b${id}\\b`), id);
  assert.match(r.out, /profile: max/);
  const u = path.join(h, 'u'); assert.ok(!fs.existsSync(u) || fs.readdirSync(u).length === 0, 'the dry run wrote nothing into the Cursor folder');
}));
