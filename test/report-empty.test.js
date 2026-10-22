'use strict';
const test = require('node:test');
const assert = require('node:assert');
const usage = require('../lib/usage');

const zeroReport = 'askai / caveman / subagent report -- last 6h  (0 transcript files, 0 responses, 0 main sessions)\nTOKEN SAVINGS LEDGER\n1. WHERE TOKENS WENT\n    total 0 0 0';

test('report with no transcripts uses the usage two-line message', () => {
  const text = usage.spendWhenEmpty(zeroReport, { hours: 24, claudeInstalled: false, codexInstalled: false });
  assert.match(text, /No Claude Code or Codex sessions in 1 days \(Claude Code not installed; Codex not installed\)\./);
  assert.match(text, /Cursor: open Dashboard → Usage\./);
  assert.ok(!/TOKEN SAVINGS|0 responses|WHERE TOKENS WENT|total\s+0/.test(text));
  assert.ok(text.split(/\n/).length <= 5);
});

test('report keeps a transcript ledger when sessions exist', () => {
  const real = 'askai / caveman / subagent report -- last 6h  (2 transcript files, 4 responses, 1 main sessions)\nTOKEN SAVINGS LEDGER\n    saved 10';
  assert.strictEqual(usage.spendWhenEmpty(real, { hours: 6, claudeInstalled: true, codexInstalled: false }), real);
});
