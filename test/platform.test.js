'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const platform = require('../lib/platform');
const { tmpHome, rm } = require('./helpers');

test('W1 spawnHost runs a Windows .cmd with shell so Node does not throw EINVAL', () => {
  const calls = [];
  platform.spawnHost('claude.cmd', ['--model', 'haiku'], {}, {
    platform: 'win32',
    spawn(cmd, args, opts) { calls.push([cmd, args, opts]); return { status: 0 }; },
  });
  assert.strictEqual(calls[0][0], 'claude.cmd');
  assert.deepStrictEqual(calls[0][1], ['--model', 'haiku']);
  assert.strictEqual(calls[0][2].shell, true);
});

test('W1 a fake .cmd host runs and receives its argument', () => {
  if (process.platform !== 'win32') return;
  const dir = tmpHome();
  try {
    const cmd = path.join(dir, 'host.cmd');
    const out = path.join(dir, 'out.txt');
    fs.writeFileSync(cmd, `@echo off\r\necho %~1> "${out}"\r\n`);
    const r = platform.spawnHost(cmd, ['ok-arg'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /ok-arg/);
  } finally { rm(dir); }
});

test('W2 findProcesses reads tasklist, then Get-CimInstance, then /proc', () => {
  const win = platform.findProcesses({
    platform: 'win32',
    spawn(cmd) {
      if (cmd === 'tasklist') return { status: 0, stdout: '"claude.exe","42"\r\n"notepad.exe","7"\r\n' };
      throw new Error('cim not used');
    },
  });
  assert.deepStrictEqual(win, [{ name: 'claude', pid: '42' }]);
  const cim = platform.findProcesses({
    platform: 'win32',
    spawn(cmd) {
      if (cmd === 'tasklist') return { status: 1, stdout: '' };
      return { status: 0, stdout: '"codex.exe","9"\r\n' };
    },
  });
  assert.deepStrictEqual(cim, [{ name: 'codex', pid: '9' }]);
  const dir = tmpHome();
  try {
    fs.mkdirSync(path.join(dir, '9'));
    fs.writeFileSync(path.join(dir, '9', 'comm'), 'agy\n');
    const proc = platform.findProcesses({ platform: 'linux', procRoot: dir, spawn: () => ({ status: 1, stdout: '' }) });
    assert.deepStrictEqual(proc, [{ name: 'agy', pid: '9' }]);
  } finally { rm(dir); }
});

test('W3 clipboard uses clip, then a file when nothing else works', () => {
  assert.strictEqual(platform.copyToClipboard('hi', { platform: 'win32', spawn: () => ({ status: 0 }) }), 'clip');
  const dir = tmpHome();
  try {
    const file = path.join(dir, 'clip.txt');
    const method = platform.copyToClipboard('saved', { platform: 'linux', spawn: () => ({ status: 1 }), file });
    assert.strictEqual(method, 'file');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'saved');
  } finally { rm(dir); }
});

test('W4 every shipped shell script is LF', () => {
  const root = path.join(__dirname, '..');
  const hits = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.sh') && fs.readFileSync(full).includes('\r')) hits.push(full);
    }
  };
  walk(root);
  assert.deepStrictEqual(hits, []);
});

test('W5 ASCII marks when the console is not UTF-8', () => {
  assert.strictEqual(platform.mark('ok', { TERM: 'dumb' }, 'win32'), 'ok');
  assert.strictEqual(platform.mark('bad', { LANG: 'C' }, 'linux'), 'x');
  assert.strictEqual(platform.mark('ok', { WT_SESSION: '1' }, 'win32'), '✔');
});

test('W6 get.ps1 stays Windows PowerShell 5.1 and names the bypass', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'get.ps1'), 'utf8');
  assert.ok(!text.includes('&&'));
  assert.ok(!/\?[^\r\n]*:/.test(text));
  assert.match(text, /ExecutionPolicy Bypass/);
});

test('W7 copyFile never creates a symlink', () => {
  const dir = tmpHome();
  try {
    const src = path.join(dir, 'a.txt');
    const dest = path.join(dir, 'b.txt');
    fs.writeFileSync(src, 'data');
    platform.copyFile(src, dest);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'data');
    assert.ok(!fs.lstatSync(dest).isSymbolicLink());
    assert.throws(() => platform.copyFile(src, dest, { symlink: true }), /symlinks/);
  } finally { rm(dir); }
});

test('W8 a deep path still gets a 12-character name', () => {
  const deep = path.join('C:\\very', ...Array.from({ length: 40 }, (_, i) => `dir${i}`), 'file name.docx');
  assert.strictEqual(platform.shortName(deep).length, 12);
});

test('W9 an EBUSY rename retries and then lands', () => {
  const dir = tmpHome();
  try {
    const file = path.join(dir, 'note.txt');
    let n = 0;
    platform.writeAtomic(file, 'ok', {
      write(p, text) { fs.writeFileSync(p, text); },
      rename(from, to) {
        n += 1;
        if (n < 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
        fs.renameSync(from, to);
      },
      unlink(p) { try { fs.unlinkSync(p); } catch (_) { /* gone */ } },
    });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'ok');
    assert.ok(n >= 3);
  } finally { rm(dir); }
});

test('W10 homeDirs uses os paths and a temp dir when HOME is unwritable', () => {
  const dir = tmpHome();
  try {
    const bad = platform.homeDirs({ HOME: path.join(dir, 'missing'), TEMP: dir }, () => { throw new Error('no'); });
    assert.strictEqual(bad.source, 'temp');
    assert.match(bad.note, /not writable/);
    assert.ok(!bad.home.includes('~'));
  } finally { rm(dir); }
});

test('W11 and L2 package managers are detected, and a missing one prints the command', () => {
  assert.strictEqual(platform.packageManager(n => (n === 'winget' ? 'winget' : null)).bin, 'winget');
  assert.strictEqual(platform.packageManager(n => (n === 'apk' ? '/sbin/apk' : null)).bin, 'apk');
  assert.match(platform.packageManager(() => null).command, /No package manager/);
});

test('L3 privilege text never waits on a password', () => {
  const text = platform.privilege('apt-get install git');
  assert.match(text, /will not prompt for a password/);
  assert.match(text, /apt-get install git/);
});

test('L5 headless copy uses OSC 52 before a file', () => {
  let written = '';
  const method = platform.copyToClipboard('prompt', {
    platform: 'linux',
    spawn: () => ({ status: 1 }),
    isTTY: true,
    write: chunk => { written += chunk; },
  });
  assert.strictEqual(method, 'osc52');
  assert.match(written, /\x1b\]52;c;/);
});

test('C1 Continue defaults to yes when stdin is closed, and --yes does not ask', () => {
  assert.deepStrictEqual(platform.continueAnswer({ stdinTTY: false, stdoutTTY: false }), { asked: false, ok: true });
  assert.deepStrictEqual(platform.continueAnswer({ yes: true, stdinTTY: true, stdoutTTY: true }), { asked: false, ok: true });
  assert.strictEqual(platform.continueAnswer({ stdinTTY: true, stdoutTTY: true, ask: () => false }).asked, true);
});

test('C2 dubious ownership prints the safe.directory line and does not throw', () => {
  const facts = platform.gitFacts('/work', (cmd, args) => {
    if (args[0] === '--version') return { status: 0, stdout: 'git version 2.46\n' };
    if (args.includes('status')) return { status: 128, stderr: 'fatal: detected dubious ownership in repository' };
    if (args.includes('--is-shallow-repository')) return { status: 0, stdout: 'true\n' };
    return { status: 1, stdout: '' };
  });
  assert.strictEqual(facts.dubious, true);
  assert.match(facts.fix, /safe\.directory \/work/);
  assert.strictEqual(facts.shallow, true);
  assert.strictEqual(facts.identity, false);
});

test('C8 LANG=C is ASCII and Node 20 prints one line without throwing', () => {
  assert.strictEqual(platform.supportsUnicode({ LANG: 'C' }, 'linux'), false);
  assert.match(platform.nodeNotice('v20.15.0'), /end-of-life \(2026-04-30\)/);
  assert.strictEqual(platform.nodeNotice('v22.14.0'), '');
  assert.strictEqual(platform.nodeNotice('v24.0.0'), '');
});

test('askai test header records the platform and stays inside the sandbox', () => {
  const selftest = require('../lib/selftest');
  const dir = tmpHome();
  try {
    const env = selftest.sandboxEnv(dir);
    assert.ok(env.HOME.startsWith(dir));
    assert.ok(!env.HOME.includes(`${path.sep}.claude${path.sep}askai`));
    const result = selftest.run({
      cwd: dir,
      out: path.join(dir, 'askai-test.txt'),
      version: '1.2.5',
      runner: () => ({ code: 0, stdout: 'ok\n', stderr: '' }),
    });
    const text = fs.readFileSync(result.file, 'utf8');
    for (const field of ['os:', 'shell:', 'node:', 'tty:', 'git:', 'container:', 'sandbox: yes']) assert.match(text, new RegExp(field));
    assert.strictEqual(result.header.sandbox, 'yes');
  } finally { rm(dir); }
});

test('check --env and version --all print the matrix without writing a home', () => {
  const { cli } = require('./helpers');
  const env = cli(['check', '--env']);
  assert.strictEqual(env.code, 0, env.err);
  assert.match(env.out, /Node:/);
  assert.match(env.out, /clipboard:/);
  const all = cli(['version', '--all']);
  assert.match(all.out, /Tier 1/);
  assert.match(all.out, /Windows PowerShell 5\.1/);
  assert.match(all.out, /Alpine/);
});
