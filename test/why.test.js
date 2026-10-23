'use strict';
const test = require('node:test');
const assert = require('node:assert');
const findings = require('../lib/findings');
const { cli, tmpHome, rm, fs, path } = require('./helpers');

test('why prints the message and fix, and one line for an unknown id', () => {
  const known = findings.why([
    { id: 'repo.agents-missing', message: 'AGENTS.md is missing', fix: 'askai scaffold' },
  ], 'repo.agents-missing');
  assert.match(known, /AGENTS.md is missing/);
  assert.match(known, /askai scaffold/);
  const missing = findings.why([], 'not-a-finding');
  assert.strictEqual(missing, 'No finding not-a-finding.');
  assert.strictEqual(missing.split(/\n/).length, 1);
});

test('askai why reads a real finding and rejects an unknown id', () => {
  const home = tmpHome();
  const repo = path.join(home, 'app');
  fs.mkdirSync(repo);
  try {
    const ok = cli(['why', 'repo.agents-missing', '--repo', repo, '--claude-home', home]);
    assert.strictEqual(ok.code, 0, ok.err + ok.out);
    assert.match(ok.out, /askai scaffold/);
    const bad = cli(['why', 'not-a-finding', '--repo', repo, '--claude-home', home]);
    assert.strictEqual(bad.code, 1, bad.out);
    assert.strictEqual(bad.out.trim(), 'No finding not-a-finding.');
  } finally { rm(home); }
});
