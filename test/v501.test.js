'use strict';
// askai 5.0.1: aliases, diff, graph, prompt kinds, security guide, base tools, infra plugin coverage.
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const { tmpHome, rm, write, makeCtx, cli, fs, path } = require('./helpers');
const comps = require('../lib/components');
const guide = require('../lib/guide');
const promptLib = require('../lib/prompt');
const infra = require('../lib/infra');
const project = require('../lib/project');
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };

test('aliases and the etiquette in the terminal: work, etiquette, continue, checkpoint, guide security', () => withHome(h => {
  assert.match(cli(['work']).out, /^WORK/); assert.match(cli(['etiquette']).out, /SECURITY/);
  assert.ok(guide.ORDER.includes('security') && /untrusted/.test(guide.render('security')));
  assert.strictEqual(cli(['checkpoint', '--repo', h, '--summary', 'menu done', '--next', 'tests']).code, 0);
  assert.ok(fs.readFileSync(path.join(h, '.ai-work', 'SESSION_LEDGER.md'), 'utf8').includes('menu done'));
  assert.match(cli(['continue', '--repo', h]).out, /Read AGENTS\.md/);
  for (const c of ['work', 'etiquette', 'continue', 'checkpoint', 'diff', 'graph']) assert.strictEqual(cli(['help', c]).code, 0, c);
}));

test('diff and graph', () => withHome(h => {
  const g = a => cp.spawnSync('git', ['-C', h, ...a], { encoding: 'utf8' });
  g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  write(path.join(h, 'a.txt'), 'one\n'); g(['add', '.']); g(['commit', '-qm', 'x']); write(path.join(h, 'a.txt'), 'one\ntwo \n');
  const d = cli(['diff', h]); assert.match(d.out, /a\.txt/); assert.match(d.out, /whitespace check: problems/); assert.strictEqual(d.code, 1);
  assert.strictEqual(cli(['graph', h]).code, 1);
  project.init(h, { yes: true }, makeCtx(h), () => {});
  const gr = cli(['graph', h]); assert.strictEqual(gr.code, 0); assert.match(gr.out, /flowchart LR/);
  assert.match(fs.readFileSync(path.join(h, 'docs', 'ai', 'ARCHITECTURE.md'), 'utf8'), /Critical invariants[\s\S]*Sensitive boundaries/);
  assert.match(fs.readFileSync(path.join(h, 'AGENTS.md'), 'utf8'), /\.ai-work\/last\.log/);
}));

test('prompt kinds add the pattern line', () => {
  for (const k of Object.keys(promptLib.KINDS)) assert.ok(promptLib.task({ ask: 'fix the cart rounding', kind: k }).text.includes(promptLib.KINDS[k]), k);
});

test('base-tools: opt-in, detects missing tools, plans winget, Homebrew or manual installs', () => withHome(h => {
  const c = comps.byId('base-tools'); assert.ok(c.optIn && c.optInFlag === 'baseTools');
  assert.strictEqual(c.detect(makeCtx(h, {}, { tools: {} })).state, 'missing');
  assert.strictEqual(c.detect(makeCtx(h, {}, { tools: { rg: '/x/rg', jq: '/x/jq', gh: '/x/gh' } })).state, 'ok');
  const r = cli(['install', '--dry-run', '--yes', '--base-tools', '--only', 'base-tools', '--claude-home', path.join(h, 'c')]);
  assert.strictEqual(r.code, 0, r.out); assert.match(r.out, /base-tools/);
}));

test('base-tools: every missing tool is tried and one combined command is reported, not just the first failure', { skip: process.platform === 'win32' ? 'apt/dnf hint is Unix-only' : false }, () => withHome(h => {
  const ctx = makeCtx(h, {}, { tools: {} });
  assert.throws(() => comps.byId('base-tools').install(ctx), err => /sudo apt-get install -y ripgrep jq gh/.test(err.message) && !/BurntSushi|jqlang|GitHub\.cli/.test(err.message));
}));

test('uv tool upgrade that cannot replace its folder: stop the tool\'s processes, clear that one folder, reinstall (Windows)', { skip: process.platform === 'win32' ? false : 'Windows file-lock repair' }, () => withHome(h => {
  const root = path.join(h, 'uvtools'); fs.mkdirSync(path.join(root, 'serena-agent', 'Scripts'), { recursive: true }); write(path.join(root, 'serena-agent', 'Scripts', 'python.exe'), 'x');
  fs.mkdirSync(path.join(root, 'other-tool'));
  const ctx = makeCtx(h, {}, { tools: { uv: 'uv' } });
  ctx.probe = (cmd, args) => { ctx.calls.push(['probe', cmd, ...args].join(' ')); return { ok: true, status: 0, stdout: cmd === 'uv' ? `${root}\n` : '', stderr: '', error: null }; };
  const fail = { ok: false, status: 2, stdout: '', stderr: 'error: failed to remove directory `serena-agent\\Scripts`: Access is denied. (os error 5)', error: null };
  ctx.act = (label, cmd, args) => { ctx.calls.push(['act', cmd, ...args].join(' ')); return cmd === 'uv' && args[1] === 'upgrade' ? fail : { ok: true, status: 0, stdout: '', stderr: '', error: null }; };
  const saved = process.env.CLAUDE_CODE_ENTRYPOINT, savedAppData = process.env.APPDATA; process.env.CLAUDE_CODE_ENTRYPOINT = ''; process.env.APPDATA = path.join(h, 'AppData', 'Roaming');
  try {
    const r = comps.uvToolUpgrade(ctx, 'serena-agent');
    assert.ok(r.ok, 'ends with a successful reinstall');
    assert.ok(!fs.existsSync(path.join(root, 'serena-agent')), 'that tool\'s folder was cleared');
    assert.ok(fs.existsSync(path.join(root, 'other-tool')), 'other tools are untouched');
    assert.ok(ctx.calls.some(c => c.startsWith('probe powershell') && c.includes('Stop-Process')), 'its running processes were stopped first');
    assert.ok(ctx.calls.some(c => c.startsWith('act uv tool install') && c.includes('serena-agent') && c.includes('--force')), ctx.calls.join(' | '));
    const sandboxed = makeCtx(h, {}, { tools: { uv: 'uv' } }); sandboxed.probe = ctx.probe; process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop';
    assert.strictEqual(comps.repairUvToolDir(sandboxed, 'serena-agent'), false, 'never repairs inside the Claude desktop sandbox');
  } finally { process.env.CLAUDE_CODE_ENTRYPOINT = saved === undefined ? '' : saved; process.env.APPDATA = savedAppData; }
}));

test('infra lists every plugin and third-party tool with its state, plus project MCP servers and hooks', () => withHome(h => {
  const ctx = makeCtx(h, { codexHome: path.join(h, 'codex'), agyHome: path.join(h, 'gemini'), cursorHome: path.join(h, 'cursor') });
  write(path.join(h, 'repo', '.mcp.json'), JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } }));
  write(path.join(h, 'repo', '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] } }));
  const r = infra.collect(ctx, path.join(h, 'repo'));
  for (const id of ['serena', 'rtk', 'headroom', 'graphify', 'context7', 'claude-mem', 'karpathy', 'base-tools']) assert.ok(r.plugins.some(p => p.id === id), id);
  assert.deepStrictEqual(r.repo.mcp['claude (.mcp.json)'], ['playwright']); assert.deepStrictEqual(r.repo.hooks, ['PreToolUse']);
  const text = infra.render(r); assert.doesNotMatch(text, /\[Plugins and third-party tools\]/); assert.match(text, /project MCP servers/); assert.ok(r.plugins.some(p => p.id === 'headroom'));
}));
