'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, cli, fs, path } = require('./helpers');

test('hide-local writes exclude and does not touch a tracked .gitignore', () => {
  const dir = tmpHome();
  try {
    fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
    write(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    write(path.join(dir, '.gitignore'), 'node_modules\n');
    const cp = require('child_process');
    cp.execSync('git init', { cwd: dir, stdio: 'ignore' });
    const before = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    const r = cli(['project', 'hide-local', dir, '--repo', dir]);
    assert.strictEqual(r.code, 0, r.err + r.out);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), before);
    const exclude = cp.execSync('git rev-parse --git-path info/exclude', { cwd: dir, encoding: 'utf8' }).trim();
    assert.match(fs.readFileSync(path.resolve(dir, exclude), 'utf8'), /# askai hide-local/);
  } finally { rm(dir); }
});

test('a handoff draft with TODO(you) is not safe to clear', () => {
  const dir = tmpHome();
  try {
    fs.mkdirSync(path.join(dir, '.ai-work'), { recursive: true });
    write(path.join(dir, '.ai-work', 'HANDOFF.md'), '# HANDOFF\nTODO(you): next steps\n');
    const hs = require('../lib/session').handoffState(dir);
    assert.strictEqual(hs.state, 'template');
    const gate = require('../lib/guide').clearGate(dir, 'cursor');
    assert.strictEqual(gate.fresh, false);
    assert.match(gate.text, /\/new in cursor/);
    assert.doesNotMatch(gate.text, /safe to run/);
  } finally { rm(dir); }
});

test('the Node 20 line is once per day, skipped for json, and kept for check --env', () => {
  const platform = require('../lib/platform');
  const line = platform.nodeNotice('v20.15.0');
  assert.match(line, /end-of-life/);
  assert.strictEqual(platform.nodeNoticeDue({ line, quiet: true, previous: '', day: '2026-10-23' }), false);
  assert.strictEqual(platform.nodeNoticeDue({ line, json: true, previous: '', day: '2026-10-23' }), false);
  assert.strictEqual(platform.nodeNoticeDue({ line, previous: '2026-10-23', day: '2026-10-23' }), false);
  assert.strictEqual(platform.nodeNoticeDue({ line, previous: '2026-10-22', day: '2026-10-23' }), true);
  assert.strictEqual(platform.nodeNoticeDue({ line, always: true, previous: '2026-10-23', day: '2026-10-23' }), true);
});

test('say hi is a chore and check does not repeat the fix', () => {
  assert.strictEqual(require('../lib/models').guessTier('say hi'), 'chore');
  const home = tmpHome();
  try {
    const r = cli(['check', '--claude-home', home, '--repo', home]);
    const hits = r.out.split('askai install --target claude --seed-only').length - 1;
    assert.ok(hits <= 1, r.out);
    assert.doesNotMatch(r.out, /peak hours/);
  } finally { rm(home); }
});

test('map excludes ThirdParty and does not tell you to read the graph report whole', () => {
  const dir = tmpHome();
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'ThirdParty', 'mod'), { recursive: true });
    write(path.join(dir, 'src', 'main.js'), 'console.log(1)\n');
    write(path.join(dir, 'ThirdParty', 'mod', 'main.js'), 'console.log(2)\n');
    write(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md'), '# g\n');
    const project = require('../lib/project');
    const info = project.detect(dir);
    assert.ok(!info.files.some(f => f.replace(/\\/g, '/').startsWith('ThirdParty/')));
    const text = project.map(dir, { dry: true }, () => {});
    assert.match(text, /excluded: ThirdParty/);
    assert.match(text, /graphify query/);
    assert.doesNotMatch(text, /read it before searching/);
  } finally { rm(dir); }
});

test('help is two columns at 80 and every visible command has a group', () => {
  const help = require('../lib/help');
  const text = help.index(80);
  const lines = text.split('\n').filter(l => l.length);
  assert.ok(lines.length <= 30, `help is ${lines.length} lines`);
  assert.ok(text.includes('DAILY') && text.includes('SESSION'));
  for (const name of help.names()) {
    const meta = help.groupOf(name);
    assert.ok(meta.group && meta.desc && meta.desc.length <= 25, name);
  }
  assert.strictEqual(help.layout(120).cols, 3);
  assert.strictEqual(help.layout(40).cols, 1);
  assert.ok(help.index(120).split('\n').filter(l => l.length).length <= 22);
});

test('next ranks only findings that check already shows, and check has no peak-hours row', () => {
  const home = tmpHome();
  const dir = path.join(home, 'app');
  fs.mkdirSync(dir);
  try {
    const { makeCtx } = require('./helpers');
    const ctx = makeCtx(home);
    const lines = [];
    require('../lib/check').run(ctx, dir, {}, s => lines.push(String(s)));
    const checkText = lines.join('\n');
    assert.doesNotMatch(checkText, /peak hours/);
    const nextText = require('../lib/daily').next(ctx, dir);
    const ranked = require('../lib/findings').collectFindings(ctx, dir).filter(f => f.severity === 'now' || f.severity === 'later');
    for (const f of ranked) {
      if (nextText.includes(f.id)) assert.ok(checkText.includes(f.message), f.id);
    }
  } finally { rm(home); }
});

test('askai test flags a command that is over its line budget', () => {
  const selftest = require('../lib/selftest');
  const flags = selftest.judge({ args: ['help'], stdout: Array(40).fill('line').join('\n'), stderr: '', code: 0, ms: 10 });
  assert.ok(flags.some(f => f.startsWith('over budget')));
});

test('chat prints the standing instruction once and default tips stay short', () => {
  const chat = require('../lib/chat').render();
  assert.strictEqual(chat.split('Instruction for every chat:').length - 1, 1);
  const tips = require('../lib/tips').render();
  assert.ok(tips.split('\n').length <= 20);
  assert.match(require('../lib/tips').render('claude'), /haiku/);
  assert.match(require('../lib/tips').render('claude'), /clangd-lsp/);
});

test('profiles lists four primary names and the shell is never unknown', () => {
  const home = tmpHome();
  try {
    const r = cli(['profiles', '--claude-home', home]);
    assert.match(r.out, /\* lean/);
    assert.match(r.out, /aliases: coding = code, max = experimental/);
    assert.ok(r.out.split('\n').filter(l => l.length).length <= 12);
  } finally { rm(home); }
  assert.notStrictEqual(require('../lib/platform').shellName({}), 'unknown');
});
