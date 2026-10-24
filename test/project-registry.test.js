'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const registry = require('../lib/project-registry');
const shell = require('../lib/project-shell');
const ASKAI = path.join(__dirname, '..', 'askai.js');

function fixture(fn) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(process.env.ASKAI_TEST_TMP || os.tmpdir(), 'askai-projects-')));
  const home = path.join(root, 'home'), config = path.join(home, '.askai');
  fs.mkdirSync(home);
  const a = path.join(root, 'alpha'), b = path.join(root, 'beta'), outside = path.join(root, 'outside');
  for (const dir of [a, b, outside]) fs.mkdirSync(dir);
  const env = { ...process.env, ASKAI_HOME: config, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    LOCALAPPDATA: path.join(home, 'LocalAppData') };
  const run = (args, options = {}) => {
    const r = cp.spawnSync(process.execPath, [ASKAI, ...args, '--claude-home', path.join(home, '.claude')],
      { encoding: 'utf8', env: { ...env, ...(options.env || {}) }, cwd: options.cwd || outside, input: options.input || '', timeout: 30000 });
    assert.ifError(r.error); return { code: r.status, output: r.stdout + r.stderr, stdout:r.stdout, stderr:r.stderr };
  };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    const result = fn({ root, home, config, a, b, outside, env, run });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup(); return result;
  } catch (e) { cleanup(); throw e; }
}

test('registered names resolve for flags, active selection, cwd discovery and default', () => fixture(({ a, b, outside, config, run }) => {
  for (const [name, dir] of [['alpha', a], ['beta', b]]) {
    const r = run(['init', '--name', name, '--path', dir, '--yes']); assert.equal(r.code, 0, r.output);
  }
  const lock = registry.file(config) + '.lock'; fs.writeFileSync(lock, 'held');
  const repeated = run(['init', '--project', 'alpha', '--refresh', '--yes']);
  assert.equal(repeated.code, 0, repeated.output, 'refresh of an existing alias must not need a registry write');
  fs.rmSync(lock);
  const rows = JSON.parse(run(['project', 'list', '--json']).output);
  assert.deepEqual(rows.map(r => r.name), ['alpha', 'beta']);
  const infra = (args, options) => {
    const r = run(['infra', '--json', ...args], options); assert.equal(r.code, 0, r.output);
    return JSON.parse(r.output).repo.dir;
  };
  assert.equal(infra(['-p', 'beta'], { cwd: a, env: { ASKAI_PROJECT: 'alpha' } }), b, 'explicit alias wins');
  assert.equal(infra(['--project', 'alpha'], { cwd: b }), a);
  assert.equal(infra([], { cwd: b, env: { ASKAI_PROJECT: 'alpha' } }), a, 'active alias wins');
  const nested = path.join(b, 'src'); fs.mkdirSync(nested);
  assert.equal(infra([], { cwd: nested }), b, 'registered ancestor detected');
  assert.equal(run(['set', 'default', 'alpha']).code, 0);
  assert.equal(infra([], { cwd: outside }), a, 'default applies outside projects');
  assert.equal(infra([], { cwd: b }), b, 'current project wins over default');
  assert.equal(run(['todo', '--project', 'beta']).code, 0);
  assert.equal(run(['check', '-p', 'beta']).code, 0);
  assert.equal(run(['project', 'show', '--project', 'beta']).stdout.trim(), `beta -> ${b}`);
  assert.equal(registry.read(config).default, 'alpha');
}));

test('rename, move and unregister preserve project files and reject bad registry state', () => fixture(({ a, b, config, run }) => {
  assert.equal(run(['init', a, '--name', 'alpha', '--yes']).code, 0);
  assert.equal(run(['init', b, '--name', 'beta', '--yes']).code, 0);
  assert.equal(run(['init', b, '--name', 'other', '--yes']).code, 1, 'duplicate path rejected');
  assert.equal(run(['init', b, '--name', 'alpha', '--yes']).code, 1, 'duplicate name rejected');
  assert.equal(run(['project', 'rename', 'beta', 'newbeta']).code, 0);
  const moved = path.join(path.dirname(b), 'moved'); fs.renameSync(b, moved);
  assert.equal(run(['infra', '--project', 'newbeta']).code, 1, 'stale path diagnosed');
  assert.equal(run(['project', 'path', 'newbeta', moved]).code, 0);
  assert.equal(JSON.parse(run(['infra', '--project', 'newbeta', '--json']).output).repo.dir, moved);
  assert.equal(run(['project', 'remove', 'newbeta']).code, 0);
  assert.ok(fs.existsSync(path.join(moved, 'AGENTS.md')));
  assert.equal(run(['infra', '--project', 'newbeta']).code, 1);
  fs.writeFileSync(registry.file(config), '{broken');
  const bad = run(['project', 'list']); assert.equal(bad.code, 1); assert.match(bad.output, /registry is unreadable/);
  assert.equal(fs.readFileSync(registry.file(config), 'utf8'), '{broken', 'corrupt file retained for repair');
}));

test('shell profile integration is idempotent and uninstall keeps user text', () => fixture(({ config, root }) => {
  for (const kind of ['powershell', 'bash', 'zsh']) {
    const profile = path.join(root, `profile-${kind}`); fs.writeFileSync(profile, '# user text\n');
    shell.install(config, profile, kind, ASKAI); shell.install(config, profile, kind, ASKAI);
    const content = fs.readFileSync(profile, 'utf8');
    assert.equal(content.match(/askai-project-shell:begin/g).length, 1);
    assert.match(shell.init(kind), /ASKAI_PROJECT/);
  }
  assert.equal(shell.uninstall(config).length, 3);
  for (const kind of ['powershell', 'bash', 'zsh']) assert.equal(fs.readFileSync(path.join(root, `profile-${kind}`), 'utf8'), '# user text\n');
}));

test('AskAI CLI keeps active project for later commands in the same terminal', () => fixture(({ a, b, env, outside, home, run }) => {
  assert.equal(run(['init', a, '--name', 'alpha', '--yes']).code, 0);
  assert.equal(run(['init', b, '--name', 'beta', '--yes']).code, 0);
  const r = cp.spawnSync(process.execPath, [ASKAI, 'cli', '--claude-home', path.join(home, '.claude')],
    { env, cwd: outside, encoding: 'utf8', input: 'set project alpha\nproject show\nset project beta\nproject show\nexit\n', timeout: 30000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`alpha -> ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(r.stdout, new RegExp(`beta -> ${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(run(['project', 'show']).code, 1, 'selection does not leak into another process');
}));

test('PowerShell integration keeps separate active projects in separate terminals', { skip: process.platform !== 'win32' ? 'Windows PowerShell integration only' : false }, () => fixture(({ a, b, env, outside, run }) => {
  assert.equal(run(['init', a, '--name', 'alpha', '--yes']).code, 0);
  assert.equal(run(['init', b, '--name', 'beta', '--yes']).code, 0);
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const setup = shell.init('powershell', ASKAI);
  const terminal = name => cp.spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    `${setup}\naskai set project ${name}\naskai project show\nWrite-Output "ACTIVE=$env:ASKAI_PROJECT"`],
  { env, cwd: outside, encoding: 'utf8', timeout: 30000 });
  const one = terminal('alpha'), two = terminal('beta');
  assert.equal(one.status, 0, one.stdout + one.stderr);
  assert.equal(two.status, 0, two.stdout + two.stderr);
  assert.match(one.stdout, /ACTIVE=alpha/); assert.match(two.stdout, /ACTIVE=beta/);
  assert.ok(one.stdout.includes(a)); assert.ok(two.stdout.includes(b));
}));

test('concurrent registrations keep every alias and an initialized legacy folder is discovered', async () => fixture(async ({ root, config, outside }) => {
  const legacy = path.join(root, 'legacy');
  fs.mkdirSync(path.join(legacy, '.ai-work'), { recursive: true });
  fs.writeFileSync(path.join(legacy, '.ai-work', 'askai-init.json'), '{}');
  assert.equal(registry.resolve(config, null, legacy).path, legacy);
  const jobs = Array.from({ length: 6 }, (_, i) => {
    const dir = path.join(root, `parallel-${i}`); fs.mkdirSync(dir);
    return new Promise((resolve, reject) => {
      const child = cp.spawn(process.execPath, ['-e',
        'require(process.argv[1]).register(process.argv[2], process.argv[3], process.argv[4])',
        require.resolve('../lib/project-registry'), config, `p${i}`, dir], { cwd: outside, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; child.stderr.on('data', part => { err += part; });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(err)));
    });
  });
  await Promise.all(jobs);
  assert.equal(Object.keys(registry.read(config).projects).length, 6);
}));
