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

test('code-intel follows the recorded max profile (ts, py) when this run names no --lsp, instead of failing every update', () => withHome(h => {
  const ctx = makeCtx(h, { dry: true }, { tools: { claude: '/bin/claude' } });
  ctx.manifest.profile = 'max';
  assert.doesNotThrow(() => comps.byId('code-intel').install(ctx));
  const lean = makeCtx(h, { dry: true }, { tools: { claude: '/bin/claude' } }); lean.manifest.profile = 'lean';
  assert.throws(() => comps.byId('code-intel').install(lean), /name the languages/, 'other profiles still ask which languages');
}));

test('todo asks for the Cursor CLI sign-in until the model check has an answer, and for the max rename while the profile is max', () => withHome(h => {
  const todo = require('../lib/todo');
  const ctx = makeCtx(h, { cursorHome: path.join(h, 'cursor') }, { tools: { agent: '/usr/bin/agent' } });
  fs.mkdirSync(path.join(h, 'cursor'), { recursive: true }); ctx.manifest.profile = 'max';
  const ids = () => todo.collectItems(ctx, null).map(i => i.id);
  assert.ok(ids().includes('cursor-signin') && ids().includes('profile-migrate'));
  const item = todo.collectItems(ctx, null).find(i => i.id === 'cursor-signin');
  assert.match(item.how, /agent login.*not at the askai> prompt.*askai install --retry/s); assert.strictEqual(item.auto, true);
  require('../lib/models').saveCursorDetection(ctx, { useSonnet: false });
  ctx.manifest.profile = 'experimental';
  assert.ok(!ids().includes('cursor-signin') && !ids().includes('profile-migrate'), 'both disappear once done');
}));

test('a shell command typed at the askai> prompt gets a pointer to the terminal instead of "Unknown command"', () => withHome(h => {
  const repo = path.join(h, 'repl'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  write(path.join(repo, 'package.json'), JSON.stringify({ name: 'r' })); write(path.join(repo, 'src', 'a.ts'), 'x');
  require('../lib/project').init(repo, { yes: true }, makeCtx(h), () => {});
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'askai.js'), 'cli', '--claude-home', path.join(h, 'c')], { cwd: repo, input: 'agent login\nexit\n', encoding: 'utf8', timeout: 60000 });
  assert.match(r.stdout, /"agent login" is a shell command, not an AskAI command/);
  assert.match(r.stdout, /askai install --retry/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /Unknown command/);
}));

test('project sync also refreshes the folder you are in when AskAI set it up, registered or not', () => withHome(h => {
  const repo = path.join(h, 'unregistered'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  write(path.join(repo, 'package.json'), JSON.stringify({ name: 'u' })); write(path.join(repo, 'src', 'a.ts'), 'x');
  const ctx = makeCtx(h); require('../lib/project').init(repo, { yes: true }, ctx, () => {});
  const file = path.join(repo, '.claude', 'agents', 'runner.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^effort: .*$/m, 'effort: low'));
  const r = cli(['project', 'sync', '--claude-home', path.join(h, 'c')], { cwd: repo });
  assert.strictEqual(r.code, 0, r.out + r.err); assert.match(r.out, /in 1 registered project/);
  assert.match(fs.readFileSync(file, 'utf8'), /effort: max/);
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
