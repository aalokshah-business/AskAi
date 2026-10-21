'use strict';
// askai 5.4: install from GitHub (get.sh / get.ps1), askai upgrade, CI workflow, community files. A local git repository stands
// in for GitHub: the same clone, fetch and install steps, no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const hasGit = cp.spawnSync('git', ['--version']).status === 0;
function fakeGitHub(base) {
  const repo = path.join(base, 'github-AskAi');
  fs.cpSync(ROOT, repo, { recursive: true, filter: s => !/[\\/](\.git|node_modules)$/.test(s) });
  const g = a => cp.spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-qm', 'askai']);
  return repo;
}

test('get.sh fetches AskAI from the repository and runs the installer with the options given', { skip: (!hasGit || process.platform === 'win32') && 'needs git and bash' }, () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-gh-'));
  try {
    const repo = fakeGitHub(H); fs.mkdirSync(path.join(H, 'shop'));
    const env = { ...process.env, HOME: H, ASKAI_REPO_URL: repo, ASKAI_DIR: path.join(H, 'src') };
    const r = cp.spawnSync('bash', [path.join(ROOT, 'get.sh'), '--target', 'claude', '--profile', 'minimal', '--skip', 'claude', '--project', '.', '--yes', '--claude-home', path.join(H, '.claude')], { cwd: path.join(H, 'shop'), env, encoding: 'utf8', input: '', timeout: 180000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(H, 'src', 'askai.js')) && fs.existsSync(path.join(H, 'src', '.git')), 'source checkout kept for askai upgrade');
    assert.ok(fs.existsSync(path.join(H, 'shop', 'AGENTS.md')), 'project pack in the current folder');
    const again = cp.spawnSync('bash', [path.join(ROOT, 'get.sh'), '--dry-run', '--target', 'claude', '--yes', '--claude-home', path.join(H, '.claude')], { cwd: H, env, encoding: 'utf8', input: '', timeout: 180000 });
    assert.strictEqual(again.status, 0, again.stdout + again.stderr); assert.match(again.stdout, /updating/);
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

test('askai upgrade clones or updates the source and re-runs install with the recorded profile', { skip: !hasGit && 'needs git' }, () => {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-up-'));
  try {
    const repo = fakeGitHub(H); const env = { ...process.env, HOME: H, ASKAI_REPO_URL: repo };
    const askai = a => cp.spawnSync(process.execPath, [path.join(ROOT, 'askai.js'), ...a], { env, encoding: 'utf8', input: '', timeout: 180000 });
    const c = path.join(H, 'c');
    const ins = askai(['install', '--yes', '--profile', 'minimal', '--target', 'claude', '--skip', 'claude', '--no-path', '--claude-home', c]); assert.strictEqual(ins.status, 0, ins.stdout + ins.stderr);
    const dry = askai(['upgrade', '--dry-run', '--claude-home', c]); assert.match(dry.stdout, /would clone[\s\S]*--profile minimal --target claude/);
    const up = askai(['upgrade', '--only', 'caveman', '--no-path', '--claude-home', c]);
    assert.strictEqual(up.status, 0, up.stdout + up.stderr); assert.match(up.stdout, /AskAI .* -> 1\.2\.0/);
    assert.ok(fs.existsSync(path.join(c, 'askai', 'src', 'askai.js')));
    const again = askai(['upgrade', '--only', 'caveman', '--no-path', '--claude-home', c]); assert.strictEqual(again.status, 0, 'update an existing checkout to the latest'); assert.match(again.stdout, /-> 1\.2\.0/);
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

test('get.ps1 forwards every option, resolves -Project, never closes the window, always installs the latest, supports forks', () => {
  const ps = read('get.ps1');
  for (const s of ['ASKAI_REPO_URL', 'ASKAI_REPO', 'Tls12', "-ieq '-Project'", 'Resolve-Path', '@fwd', 'ExecutionPolicy Bypass', 'archive/refs/heads/main.zip', 'Unblock-File', 'origin HEAD']) assert.ok(ps.includes(s), s);
  for (const f of ['get.ps1', 'get.sh', 'askai.js', 'lib/help.js', 'README.md', 'INSTALL.md', 'docs/INSTALL.md', 'SECURITY.md', 'docs/RELEASING.md']) assert.ok(!/ASKAI_REF|--ref\b/.test(read(f)), `${f}: always the latest, no version pinning`);
  assert.ok(!/^\s*exit\b/m.test(ps), 'no exit: it runs inside the caller\'s PowerShell');
  const sh = read('get.sh'); for (const s of ['ASKAI_REPO_URL', '/dev/tty', 'archive/refs/heads/main.tar.gz', 'git clone', 'origin HEAD']) assert.ok(sh.includes(s), s);
});

test('CI workflow and community files are in place; package.json points at the repository', () => {
  const ci = read('.github/workflows/test.yml');
  for (const s of ['ubuntu-latest', 'macos-latest', 'windows-latest', 'node --test test/*.test.js', 'gen-docs.js --check', 'windows-selftest.ps1', 'preview-matrix.sh']) assert.ok(ci.includes(s), s);
  for (const f of ['CONTRIBUTING.md', 'SECURITY.md', 'docs/RELEASING.md', 'scripts/sums.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.strictEqual(JSON.parse(read('package.json')).repository.url, 'https://github.com/aalokshah-business/AskAi.git');
  assert.match(read('README.md'), /raw\.githubusercontent\.com\/aalokshah-business\/AskAi\/main\/get\.sh \| bash -s --/);
});
