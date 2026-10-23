'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cli, tmpHome, rm, write, makeCtx, fs, path } = require('./helpers');
const check = require('../lib/check');
const models = require('../lib/models');
const { select } = require('../askai');

test('the model ladder is data and starts at Haiku', () => {
  const ladder = models.ladder();
  assert.strictEqual(ladder.claude[0], 'claude-haiku-5-5');
  assert.ok(ladder.claude.includes('claude-sonnet-5-5'));
});

test('install --add puts a component on the lean default', () => {
  const ids = select({ add: 'serena' }, 'install').map(c => c.id);
  assert.ok(ids.includes('serena'));
  assert.ok(ids.includes('rules'));
});

test('a container home is the ephemeral-home finding', () => {
  const prev = process.env.ASKAI_EPHEMERAL_HOME;
  process.env.ASKAI_EPHEMERAL_HOME = '1';
  const home = tmpHome();
  try {
    const ctx = makeCtx(home);
    const rows = check.machine(ctx);
    assert.ok(rows.some(r => /lost on rebuild/.test(r.msg)));
  } finally {
    if (prev === undefined) delete process.env.ASKAI_EPHEMERAL_HOME;
    else process.env.ASKAI_EPHEMERAL_HOME = prev;
    rm(home);
  }
});

test('askai install --list prints component ids and writes nothing', () => {
  const home = tmpHome();
  try {
    const r = cli(['install', '--list', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /\btoken-kit\b/);
    assert.ok(!fs.existsSync(path.join(home, 'askai', 'manifest.json')));
  } finally { rm(home); }
});

test('hide-local offers ignores for a markdown and docx pair', () => {
  const home = tmpHome();
  const dir = path.join(home, 'repo');
  fs.mkdirSync(dir);
  write(path.join(dir, 'spec.md'), '# spec\n');
  write(path.join(dir, 'spec.docx'), 'x');
  const cp = require('child_process');
  cp.spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  try {
    const text = require('../lib/daily').hideLocal(dir, {}).text;
    assert.match(text, /spec/);
  } finally { rm(home); }
});
