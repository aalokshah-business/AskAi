'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const project = require('../lib/project');
const daily = require('../lib/daily');
const { cli, tmpHome, rm, write, makeCtx } = require('./helpers');

test('detect scans the folder again after a file changes', () => {
  const home = tmpHome();
  const dir = path.join(home, 'app');
  fs.mkdirSync(dir);
  write(path.join(dir, 'src.js'), 'module.exports = 1;\n');
  try {
    const a = project.detect(dir);
    assert.strictEqual(project.detect(dir), a);
    write(path.join(dir, 'more.js'), 'module.exports = 2;\n');
    const b = project.detect(dir);
    assert.ok(b.source.scanned > a.source.scanned);
  } finally { rm(home); }
});

test('next stays within 15 lines', () => {
  const home = tmpHome();
  try {
    const text = daily.next(makeCtx(home), home);
    assert.ok(text.split(/\n/).length <= 15, text);
    assert.match(text, /Do now/);
    assert.match(text, /Later/);
  } finally { rm(home); }
});

test('handoff writes ticket and TODO fields', () => {
  const home = tmpHome();
  const dir = path.join(home, 'app');
  fs.mkdirSync(dir);
  try {
    const r = daily.writeHandoff(dir);
    assert.match(fs.readFileSync(r.file, 'utf8'), /TODO\(you\): acceptance criteria/);
    assert.match(r.text, /Goal draft:/);
  } finally { rm(home); }
});

test('weigh labels an estimate and flags a large file', () => {
  const home = tmpHome();
  const file = path.join(home, 'big.txt');
  write(file, 'x'.repeat(40000));
  try {
    const r = daily.weigh(file, 8000);
    assert.match(r.text, /estimate: 10000 tokens/);
    assert.match(r.text, /ctx.large-file/);
  } finally { rm(home); }
});

test('run keeps a risky command until --yes', () => {
  const home = tmpHome();
  try {
    const refused = daily.runCmd(home, 'echo flash', {});
    assert.strictEqual(refused.code, 1);
    const ran = daily.runCmd(home, 'node -e "console.log(1)"', {});
    assert.strictEqual(ran.code, 0);
    assert.match(ran.text, /exit 0/);
  } finally { rm(home); }
});

test('errors pulls a failing line with context', () => {
  const home = tmpHome();
  const log = path.join(home, 'build.log');
  write(log, 'ok\nbefore\nerror: boom\nafter\n');
  try {
    assert.match(daily.errors(log), /error: boom/);
  } finally { rm(home); }
});

test('route picks chore for a rename', () => {
  const r = cli(['route', 'rename the helper']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /tier: chore/);
});

test('prompt --kind commit names the log style', () => {
  const r = cli(['prompt', '--kind', 'commit', 'save the helper rename']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /git log subject style/);
});

test('status names a recorded project profile', () => {
  const home = tmpHome();
  const dir = path.join(home, 'app');
  fs.mkdirSync(dir);
  try {
    const status = require('../lib/status');
    const ctx = makeCtx(home);
    assert.match(status.renderStatus(ctx, dir).lines[1], /project unset/);
    status.rememberProjectProfile(dir, 'docs');
    assert.match(status.renderStatus(ctx, dir).lines[1], /project docs/);
  } finally { rm(home); }
});

test('bootstrap writes the devcontainer script once', () => {
  const home = tmpHome();
  try {
    const file = path.join(home, '.devcontainer', 'askai-postcreate.sh');
    assert.match(daily.bootstrap(home, 'coding'), /Personal Dev Containers dotfiles/);
    assert.ok(!fs.existsSync(file));
    assert.match(daily.bootstrap(home, 'coding', { repo: true }), /wrote/);
    const script = fs.readFileSync(file, 'utf8');
    assert.match(script, /^#!\/bin\/sh\n/);
    assert.match(script, /get\.sh \| bash -s -- --yes --profile coding/, 'first run downloads AskAI with the profile');
    for (const step of ['askai update', 'askai install --retry --yes', 'askai project sync', 'askai init --yes', 'askai init --refresh --yes', 'askai project refresh', 'askai check --all']) assert.ok(script.includes(step), step);
    assert.match(script, /sudo -n true/, 'uses sudo only when it needs no password');
    const syntax = require('child_process').spawnSync('sh', ['-n', file], { encoding: 'utf8' });
    if (!syntax.error) assert.strictEqual(syntax.status, 0, syntax.stderr);
    assert.match(daily.bootstrap(home, 'coding', { repo: true }), /already/);
  } finally { rm(home); }
});

test('convert scan lists an office file', () => {
  const home = tmpHome();
  write(path.join(home, 'spec.docx'), 'not a real document');
  try {
    assert.match(daily.scanOffice(home), /spec\.docx/);
    assert.match(daily.scanOffice(home), /estimate:/);
  } finally { rm(home); }
});

test('go without a host uses Claude Code and the chore tier for a rename', () => {
  const home = tmpHome();
  try {
    const pl = require('../lib/launch').plan(makeCtx(home), 'rename the helper', {});
    assert.strictEqual(pl.tool, 'claude');
    assert.strictEqual(pl.tier, 'chore');
  } finally { rm(home); }
});

test('go preflight stays within 6 lines before a paste note', () => {
  const home = tmpHome();
  const lines = [];
  try {
    const code = require('../lib/launch').run(makeCtx(home), 'rename the helper', { dry: true, repo: home, copy: false }, l => lines.push(l));
    assert.strictEqual(code, 0);
    const head = [];
    for (const l of lines) { if (String(l).startsWith('  Paste this')) break; head.push(l); }
    assert.ok(head.length <= 6, head.join('\n'));
    assert.match(head[0], /askai go claude/);
  } finally { rm(home); }
});

test('a firmware tree asks for compile_commands.json', () => {
  const home = tmpHome();
  write(path.join(home, 'prj.conf'), 'CONFIG_PRINTK=y\n');
  try {
    const list = require('../lib/todo').collectItems(makeCtx(home), home);
    assert.ok(list.some(i => i.id === 'compile-commands'));
  } finally { rm(home); }
});

test('askai next and askai weigh run from the CLI', () => {
  const home = tmpHome();
  const file = path.join(home, 'note.txt');
  write(file, 'hello');
  try {
    const n = cli(['next', '--claude-home', home, '--repo', home]);
    assert.strictEqual(n.code, 0, n.err);
    assert.match(n.out, /Do now/);
    const w = cli(['weigh', file, '--claude-home', home]);
    assert.strictEqual(w.code, 0, w.err);
    assert.match(w.out, /estimate:/);
  } finally { rm(home); }
});
