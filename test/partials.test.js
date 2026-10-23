'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const { tmpHome, rm, write, makeCtx, cli, fs, path } = require('./helpers');

test('resume reads expires_at from the latest status-line snapshot', () => {
  const home = tmpHome();
  const repo = path.join(home, 'repo');
  try {
    fs.mkdirSync(path.join(home, 'askai', 'sessions'), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    write(path.join(home, 'askai', 'sessions', 's.json'), JSON.stringify({ id: 's', at: Date.now(), cache: { expiresAt: '2026-10-23T18:00:00Z', recacheTokensIfCold: 1200 } }));
    write(path.join(repo, '.ai-work', 'LAST_BREAK'), new Date(Date.now() - 90 * 60000).toISOString());
    const lines = [];
    require('../lib/session').run('resume', { repo, host: 'claude', claudeHome: home }, l => lines.push(l));
    assert.match(lines.join('\n'), /expires_at 2026-10-23T18:00:00Z/);
    assert.match(lines.join('\n'), /recache_tokens_if_cold 1200/);
  } finally { rm(home); }
});

test('usage cache prints expires_at when a snapshot has it', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home);
    fs.mkdirSync(ctx.paths.sessions, { recursive: true });
    write(path.join(ctx.paths.sessions, 'abc.json'), JSON.stringify({ id: 'abcdef12', at: Date.now(), cache: { expiresAt: '2026-10-23T18:00:00Z', recacheTokensIfCold: 50, hitRatio: 0.5 } }));
    const text = require('../lib/status').renderCache(ctx, 24).lines.join('\n');
    assert.match(text, /expires_at 2026-10-23T18:00:00Z/);
    assert.match(text, /recache_tokens_if_cold 50/);
  } finally { rm(home); }
});

test('ask cache names the legacy env vars and does not recommend them', () => {
  const r = cli(['ask', 'what breaks the prompt cache']);
  assert.match(r.out, /ENABLE_PROMPT_CACHING_1H/);
  assert.match(r.out, /not recommended/);
});

test('a recorded legacy install shows token-kit, and a fresh one does not', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home);
    ctx.manifest.components['token-kit'] = { installedByAskai: true };
    const text = require('../lib/status').renderStatus(ctx).lines.join('\n');
    assert.match(text, /^token-kit /m);
  } finally { rm(home); }
});

test('a Zephyr tree with no docs source says so', () => {
  const dir = tmpHome();
  try {
    write(path.join(dir, 'west.yml'), 'manifest:\n  projects: []\n');
    require('../lib/scaffold').run(dir, {});
    const text = fs.readFileSync(path.join(dir, 'docs', 'ai', 'PROJECT_PROFILE.md'), 'utf8');
    assert.match(text, /no official docs source configured/);
    assert.match(text, /compile_commands\.json at the repo root/);
  } finally { rm(dir); }
});

test('check and the validator share validateFiles', () => {
  const dir = tmpHome();
  try {
    const files = require('../lib/validate-files');
    assert.match(files.validateFiles(dir).text, /Files: missing AGENTS\.md/);
    for (const rel of files.NEED) write(path.join(dir, rel), 'x\n');
    assert.strictEqual(files.validateFiles(dir).text, 'Files: project pack present');
    const lines = [];
    require('../lib/check').run(makeCtx(dir), dir, {}, l => lines.push(l));
    assert.ok(lines.includes('Files: project pack present'));
  } finally { rm(dir); }
});

test('clangd-lsp with no clangd process is lsp.clangd-inactive, and --lsp auto adds cpp only when both inputs exist', () => {
  const home = tmpHome();
  const repo = path.join(home, 'repo');
  try {
    write(path.join(home, 'settings.json'), JSON.stringify({ model: 'claude-haiku-5-5', enabledPlugins: { 'clangd-lsp@claude-plugins-official': true } }));
    const ctx = makeCtx(home);
    ctx.paths.settings = path.join(home, 'settings.json');
    const rows = require('../lib/findings').collectFindings(ctx);
    assert.ok(rows.some(r => r.id === 'lsp.clangd-inactive'));
    fs.mkdirSync(repo, { recursive: true });
    write(path.join(repo, 'compile_commands.json'), '[]\n');
    const lsp = require('../lib/lsp-auto');
    assert.strictEqual(lsp.autoCpp({ which: () => null }, repo), false);
    assert.strictEqual(lsp.autoCpp({ which: n => (n === 'clangd' ? 'clangd' : null) }, repo), true);
  } finally { rm(home); }
});

test('profiles migrate renames max and keeps the tool list', () => {
  const home = tmpHome();
  try {
    fs.mkdirSync(path.join(home, 'askai'), { recursive: true });
    write(path.join(home, 'askai', 'manifest.json'), JSON.stringify({ profile: 'max', components: { baseline: { installedByAskai: true } } }));
    const r = cli(['profiles', 'migrate', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /Installed tools were not changed/);
    const saved = JSON.parse(fs.readFileSync(path.join(home, 'askai', 'manifest.json'), 'utf8'));
    assert.strictEqual(saved.profile, 'experimental');
    assert.ok(saved.components.baseline);
  } finally { rm(home); }
});

test('stop never selects the current process, tmux, sshd, or the Cursor server', () => {
  const daily = require('../lib/daily');
  const kept = daily.killable([
    { name: 'claude', pid: '10' },
    { name: 'tmux', pid: '11' },
    { name: 'sshd', pid: '12' },
    { name: 'cursor-server', pid: '13' },
    { name: 'claude', pid: String(process.pid) },
  ], process.pid, process.ppid);
  assert.deepStrictEqual(kept, [{ name: 'claude', pid: '10' }]);
});

test('snapshot only reads git diff and leaves the branch alone', () => {
  const dir = tmpHome();
  try {
    cp.spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    write(path.join(dir, 'a.txt'), 'hello\n');
    const text = require('../lib/daily').snapshot(dir, {});
    assert.match(text, /snapshot /);
    const stash = cp.spawnSync('git', ['-C', dir, 'stash', 'list'], { encoding: 'utf8' });
    assert.strictEqual((stash.stdout || '').trim(), '');
    const log = cp.spawnSync('git', ['-C', dir, 'log', '--oneline'], { encoding: 'utf8' });
    assert.strictEqual((log.stdout || '').trim(), '');
    const status = cp.spawnSync('git', ['-C', dir, 'status', '--short'], { encoding: 'utf8' });
    assert.match(status.stdout, /a\.txt/);
  } finally { rm(dir); }
});

test('hide-local undo works when .git is a file', () => {
  const dir = tmpHome();
  try {
    const real = path.join(dir, 'real');
    const work = path.join(dir, 'work');
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    cp.spawnSync('git', ['init'], { cwd: real, encoding: 'utf8' });
    write(path.join(work, '.git'), `gitdir: ${path.join(real, '.git').replace(/\\/g, '/')}\n`);
    const daily = require('../lib/daily');
    const hid = daily.hideLocal(work, {});
    assert.strictEqual(hid.code, 0, hid.text);
    assert.match(hid.text, /info[\\/]exclude/);
    const undo = daily.hideLocal(work, { undo: true });
    assert.strictEqual(undo.code, 0, undo.text);
    const exclude = cp.spawnSync('git', ['-C', work, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' });
    const body = fs.readFileSync(path.resolve(work, exclude.stdout.trim()), 'utf8');
    assert.ok(!body.includes('# askai hide-local'));
  } finally { rm(dir); }
});

test('a successful run offers run --save, and --save records it', () => {
  const dir = tmpHome();
  try {
    const daily = require('../lib/daily');
    const offered = daily.runCmd(dir, 'node -e "process.exit(0)"', {});
    assert.strictEqual(offered.code, 0);
    assert.match(offered.text, /askai run --save NAME/);
    const saved = daily.runCmd(dir, 'node -e "process.exit(0)"', { save: 'build' });
    assert.match(saved.text, /saved build/);
    const data = JSON.parse(fs.readFileSync(path.join(dir, '.ai-work', 'named-runs.json'), 'utf8'));
    assert.match(data.build.cmd, /process\.exit/);
  } finally { rm(dir); }
});

test('setup without a TTY continues, and --dry-run still writes nothing', () => {
  const home = tmpHome();
  try {
    const r = cli(['setup', '--dry-run', '--claude-home', home, '--no-path'], { env: { HOME: home, USERPROFILE: home } });
    assert.match(r.out, /would run: askai install --yes/);
    assert.ok(!fs.existsSync(path.join(home, 'settings.json')));
  } finally { rm(home); }
});

test('line budgets for next, check, status, usage, break and resume', () => {
  const home = tmpHome();
  const repo = path.join(home, 'repo');
  try {
    fs.mkdirSync(repo, { recursive: true });
    const ctx = makeCtx(home);
    const count = text => String(text).split(/\n/).filter(l => l.length).length;
    assert.ok(count(require('../lib/daily').next(ctx, repo)) <= 15);
    const checkLines = [];
    require('../lib/check').run(ctx, repo, {}, l => checkLines.push(l));
    assert.ok(count(checkLines.join('\n')) <= 30, `check ${count(checkLines.join('\n'))}`);
    assert.ok(count(require('../lib/status').renderStatus(ctx, repo).lines.join('\n')) <= 25, 'status');
    const usage = require('../lib/usage').summarizeUsage({ days: 7, claudeText: '', claudeError: '', codex: { files: 0 }, claudeInstalled: false, codexInstalled: false });
    assert.ok(count(usage) <= 5, usage);
    const session = require('../lib/session');
    const br = []; session.run('break', { repo, dry: true }, l => br.push(l));
    const re = []; session.run('resume', { repo }, l => re.push(l));
    assert.ok(count(br.join('\n')) <= 15, `break ${count(br.join('\n'))}`);
    assert.ok(count(re.join('\n')) <= 15, `resume ${count(re.join('\n'))}`);
  } finally { rm(home); }
});

test('the same sentence is not printed by both guide and tips', () => {
  const guide = require('../lib/guide').render('all');
  const tips = require('../lib/tips').render();
  const sentences = text => String(text).split(/(?<=[.])\s+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 80);
  const a = new Set(sentences(guide));
  const dup = sentences(tips).filter(s => a.has(s));
  assert.deepStrictEqual(dup, []);
});

test('assert-skips prints a skip reason and rejects a silent skip', () => {
  const dir = tmpHome();
  try {
    const loud = path.join(dir, 'loud.tap');
    write(loud, 'ok 1 - preview # SKIP needs bash\n');
    const ok = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'assert-skips.js'), loud], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /needs bash/);
    const quiet = path.join(dir, 'quiet.tap');
    write(quiet, 'ok 2 - hidden # SKIP\n');
    const bad = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'assert-skips.js'), quiet], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 1);
  } finally { rm(dir); }
});
