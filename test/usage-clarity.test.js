'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const usage = require('../lib/usage');
const { cliInstallPlan } = require('../askai');

test('Codex report separates uncached input without double-counting cached input', () => {
  const r = { files: 1, byDay: [], total: { sessions: 1, input: 10000, cached: 9000, output: 500 } };
  const text = usage.summarizeUsage({ days: 7, codex: r });
  assert.match(text, /tokens \(raw; not plan usage\)/);
  assert.match(text, /Codex\s+1\s+10500/);
  assert.match(text, /Uncached input: 1,000/);
  assert.match(text, /input cache share: 90\.0%/);
  assert.match(text, /Cached input is included in input/);
  assert.match(text, /not weekly plan usage, dollars, or measured savings/);
});

test('zero input has a finite cache share', () => {
  const text = usage.renderCodex({ files: 1, byDay: [], total: { sessions: 1, input: 0, cached: 0, output: 0 } });
  assert.match(text, /input cache share: 0\.0%/);
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test('prepare keeps existing installations and installs only for first setup or explicit refresh', () => {
  assert.equal(cliInstallPlan({ configured: true }), 'skip');
  assert.equal(cliInstallPlan({ configured: false }), 'max');
  assert.equal(cliInstallPlan({ configured: true, refresh: true }), 'max');
  assert.equal(cliInstallPlan({ configured: true, refresh: true, dry: true }), 'skip');
  assert.equal(cliInstallPlan({ configured: true, refresh: true, sandbox: true }), 'skip');
});
