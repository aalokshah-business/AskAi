'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, cli, fs, path } = require('./helpers');
const selftest = require('../lib/selftest');

test('askai test runs only commands that do not install or launch an agent', () => {
  const names = selftest.PLAN.map(s => s.args[0]);
  for (const banned of ['install', 'uninstall', 'update', 'upgrade', 'setup', 'init', 'convert', 'hook', 'graph', 'set', 'cli', 'test']) {
    assert.ok(!names.includes(banned), banned);
  }
  assert.ok(selftest.PLAN.some(s => s.args[0] === 'go' && s.args.includes('--dry-run')));
  assert.ok(names.includes('status') && !names.includes('doctor') && names.includes('check'));
});

test('askai test writes one capture and a short status', () => {
  const dir = tmpHome();
  try {
    const scripted = {
      version: { code: 0, stdout: '1.2.5\n' },
      status: { code: 1, stdout: 'FAIL  settings   broken json\n\n0 ok, 0 warning(s), 1 failure(s)\n' },
      check: { code: 0, stdout: '\n2 ok, 3 to improve, 0 failing.\n' },
      context: { code: 1, stdout: 'Give the level: askai context 62\n' },
      savings: { timedOut: true, stdout: '' },
    };
    const result = selftest.run({
      cwd: dir,
      out: path.join(dir, 'askai-test.txt'),
      version: '1.2.5',
      runner(args) {
        const hit = scripted[args[0]] || { code: 0, stdout: 'ok\n' };
        return { code: hit.code == null ? null : hit.code, timedOut: !!hit.timedOut, error: '', stdout: hit.stdout || '', stderr: '' };
      },
    });
    const text = fs.readFileSync(result.file, 'utf8');
    assert.ok(text.includes('## askai status'));
    assert.ok(text.includes('## askai check'));
    assert.ok(text.includes('FAIL  settings'));
    assert.ok(text.includes('skipped:'));
    assert.match(text, /mode: sandbox/);
    assert.match(text, /safe\.directory/);
    assert.match(result.summary, /did not finish/);
    assert.match(result.summary, /savings 7\s+timed out/);
    assert.match(result.summary, /need a look/);
    assert.match(result.summary, /3 to improve/);
    assert.match(result.summary, /1 failure/);
    assert.ok(!/context/.test(result.summary.split('need a look')[1] || ''), 'context usage is not an action item');
    assert.strictEqual(result.failedToRun, true);
    assert.ok(result.summary.includes(result.file));
  } finally { rm(dir); }
});

test('a clean run says every command finished fine', () => {
  const dir = tmpHome();
  try {
    const result = selftest.run({
      cwd: dir,
      out: path.join(dir, 'out.txt'),
      runner: () => ({ code: 0, stdout: 'ok\n', stderr: '' }),
    });
    assert.match(result.summary, /commands ran, all finished fine/);
    assert.strictEqual(result.failedToRun, false);
    assert.strictEqual(result.results.length, selftest.PLAN.length);
  } finally { rm(dir); }
});

test('askai help test describes the capture', () => {
  const r = cli(['help', 'test', '--advanced']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /Usage: askai test/);
  assert.match(r.out, /--out FILE/);
});
