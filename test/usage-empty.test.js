'use strict';
const test = require('node:test');
const assert = require('node:assert');
const usage = require('../lib/usage');

const zeroReport = 'askai / caveman / subagent report -- last 168h  (0 transcript files, 0 responses, 0 main sessions)\nTOKEN SAVINGS LEDGER\n    total 0 0 0';

test('usage with no transcripts is two lines and has no zero table', () => {
  const text = usage.summarizeUsage({
    days: 7,
    claudeText: zeroReport,
    claudeError: '',
    codex: { files: 0, total: { sessions: 0, input: 0, output: 0, cached: 0 }, byDay: [] },
    claudeInstalled: false,
    codexInstalled: false,
  });
  assert.match(text, /No Claude Code or Codex sessions in 7 days \(Claude Code not installed; Codex not installed\)\./);
  assert.match(text, /Cursor: open Dashboard → Usage\./);
  assert.ok(!/TOKEN SAVINGS|0 responses|total\s+0/.test(text));
  assert.ok(text.split(/\n/).length <= 5);
});

test('usage still prints a Codex table when sessions exist', () => {
  const text = usage.summarizeUsage({
    days: 7,
    claudeText: zeroReport,
    codex: { files: 1, total: { sessions: 1, input: 10, output: 2, cached: 0 }, byDay: [['2026-10-20', { sessions: 1, input: 10, output: 2, cached: 0 }]] },
    claudeInstalled: true,
    codexInstalled: true,
  });
  assert.match(text, /=== Codex, last 7 day/);
  assert.match(text, /10/);
  assert.ok(!/TOKEN SAVINGS/.test(text));
  assert.ok(!/No Claude Code or Codex sessions/.test(text));
});
