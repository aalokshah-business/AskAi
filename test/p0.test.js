'use strict';
// v1.3 P0 defects that are isolated: unknown command, savings failure, host marks, statusline, graph display.
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, makeCtx, cli, fs, path } = require('./helpers');
const savings = require('../lib/savings');
const askai = require('../askai');

test('unknown command suggests a close name and does not print the banner', () => {
  const r = cli(['sesion']);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /Unknown command "sesion"\. Did you mean: session\?/);
  assert.doesNotMatch(r.out + r.err, /Usage: askai/);
  assert.ok(r.err.trim().split(/\n/).length <= 3);
  const far = cli(['zzzz']);
  assert.strictEqual(far.code, 2);
  assert.match(far.err, /Unknown command "zzzz"\./);
  assert.doesNotMatch(far.err, /Did you mean/);
  assert.strictEqual(askai.suggestCommand('sesion'), 'session');
});

test('the help banner keeps the host list in one sentence', () => {
  const r = cli(['help']);
  const text = r.out + r.err;
  const i = text.indexOf('Claude Code');
  const j = text.indexOf('Antigravity');
  assert.ok(i >= 0 && j > i);
  assert.ok(!text.slice(i, j).includes('\n'), text.slice(i, j));
  assert.doesNotMatch(text, /--[a-z]/);
});

test('a failing plugin report is one line and the vendor text stays in the log', () => {
  const h = tmpHome();
  try {
    const bin = path.join(h, 'headroom' + (process.platform === 'win32' ? '.cmd' : ''));
    write(bin, process.platform === 'win32'
      ? '@echo off\r\necho No such command \'perf\'\r\necho usage: headroom\r\nexit /b 1\r\n'
      : '#!/bin/sh\necho "No such command \'perf\'"\necho "usage: headroom"\nexit 1\n');
    if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
    const ctx = makeCtx(h, {}, { tools: { headroom: bin } });
    const out = savings.report(ctx, 7, h);
    assert.match(out, /headroom: report unavailable \(see \.ai-work\/askai\.log\)/);
    assert.doesNotMatch(out, /No such command/);
    assert.doesNotMatch(out, /usage: headroom/);
    const log = fs.readFileSync(path.join(h, '.ai-work', 'askai.log'), 'utf8');
    assert.match(log, /No such command/);
  } finally { rm(h); }
});

test('a linux container does not open the architecture diagram', () => {
  assert.strictEqual(askai.diagramOpenable('linux', {}, true), false);
  assert.strictEqual(askai.diagramOpenable('linux', { DISPLAY: ':0' }, true), true);
  assert.strictEqual(askai.diagramOpenable('linux', { BROWSER: 'cursor' }, true), true);
  assert.strictEqual(askai.diagramOpenable('win32', {}, false), false);
});

test('ledger events are whole records and a template handoff is one line', () => {
  const h = tmpHome();
  const session = require('../lib/session');
  const lines = [];
  try {
    session.run('start', { repo: h, tool: 'codex', task: 'Fix nav' }, l => lines.push(l));
    const jsonl = fs.readFileSync(path.join(h, '.ai-work', 'session.jsonl'), 'utf8').trim().split(/\n/);
    const ev = JSON.parse(jsonl[0]);
    assert.strictEqual(ev.event, 'START');
    assert.strictEqual(typeof ev.tracked, 'number');
    assert.ok(!jsonl[0].includes('??'));
    lines.length = 0;
    session.run('resume', { repo: h }, l => lines.push(l));
    const text = lines.join('\n');
    assert.match(text, /Handoff: empty template/);
    assert.doesNotMatch(text, /No session recorded/);
    assert.strictEqual(session.handoffState(h).state, 'template');
  } finally { rm(h); }
});

test('ask with no topic lists groups, and a topic prints one answer', () => {
  const none = cli(['ask']);
  assert.strictEqual(none.code, 0);
  assert.match(none.out, /^topic listing\n/);
  assert.match(none.out, /Usage: askai ask/);
  assert.match(none.out, /Session:/);
  assert.doesNotMatch(none.out, /No rule matches/);
  const one = cli(['ask', 'headroom']);
  assert.strictEqual(one.code, 0);
  assert.strictEqual((one.out.match(/Rule:/g) || []).length, 1);
  assert.match(one.out, /Related:/);
});

test('the short banner names seven categories and no flags', () => {
  const out = cli(['help']).out;
  for (const name of ['work', 'project', 'setup', 'health', 'cost', 'learn', 'system']) assert.match(out, new RegExp('^  ' + name + '\\s+\\d+ commands', 'm'));
  assert.doesNotMatch(out, /--[a-z]/);
  assert.strictEqual(cli([]).code, 0);
});

test('a host that is not installed adds no warnings', () => {
  const h = tmpHome();
  try {
    const ctx = makeCtx(h, {}, { tools: {} });
    const rows = require('../lib/check').machine(ctx);
    const hints = rows.filter(r => /Claude Code/.test(r.msg));
    assert.deepStrictEqual(hints.map(r => r.msg), ['Claude Code not installed: askai install --target claude --seed-only']);
    assert.ok(!rows.some(r => /default model|starts on Opus/.test(r.msg)));
  } finally { rm(h); }
});

test('deletion-only review stays current, a content change is stale', () => {
  const h = tmpHome();
  const review = require('../lib/project-review');
  try {
    write(path.join(h, 'README.md'), 'hello\n');
    write(path.join(h, 'src.js'), 'var a = 1;\n');
    review.done(h);
    write(path.join(h, 'README.md'), 'hello changed\n');
    assert.strictEqual(review.status(h).state, 'stale');
    review.done(h);
    fs.unlinkSync(path.join(h, 'src.js'));
    const quiet = review.status(h, { removedFraction: 1 });
    assert.strictEqual(quiet.state, 'current');
    assert.strictEqual(quiet.refreshed, true);
  } finally { rm(h); }
});

test('init prints changes only, and habits are not open to-dos', () => {
  const h = tmpHome();
  try {
    const ctx = makeCtx(h, {}, { tools: {} });
    write(ctx.paths.settings, '{}');
    const lines = [];
    require('../lib/project').init(h, { yes: true, offline: true, references: [] }, ctx, l => lines.push(l));
    lines.length = 0;
    require('../lib/project').init(h, { yes: true, offline: true, references: [] }, ctx, l => lines.push(l));
    assert.doesNotMatch(lines.join('\n'), /keep\s+/);
    const todo = require('../lib/todo');
    const list = todo.items(ctx, h);
    assert.ok(list.some(i => i.id === 'claude-signin' && i.habit));
    assert.ok(!todo.open(list).some(i => i.habit));
  } finally { rm(h); }
});

test('statusline on a terminal explains itself', async () => {
  const prevArgv = process.argv;
  const inTty = process.stdin.isTTY;
  const lines = [];
  const log = console.log;
  process.stdin.isTTY = true;
  process.argv = ['node', 'askai.js', 'statusline'];
  console.log = s => lines.push(String(s));
  try { await askai.main(); }
  finally { process.argv = prevArgv; process.stdin.isTTY = inTty; console.log = log; }
  assert.match(lines.join('\n'), /Reads Claude Code status JSON on stdin\. Try: askai statusline --demo\./);
});
