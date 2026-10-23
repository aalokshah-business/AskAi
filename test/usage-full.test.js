'use strict';
const test = require('node:test');
const assert = require('node:assert');
const usage = require('../lib/usage');
const { cli, tmpHome, rm, path } = require('./helpers');

const zeroReport = 'askai / caveman / subagent report -- last 168h  (0 transcript files, 0 responses, 0 main sessions)\nTOKEN SAVINGS LEDGER\n    total 0 0 0';

test('usage --full stacks the short lines and skips zero tables', () => {
  const text = usage.fullText({
    summary: usage.summarizeUsage({
      days: 7,
      claudeText: zeroReport,
      claudeError: '',
      codex: { files: 0 },
      claudeInstalled: false,
      codexInstalled: false,
    }),
    cache: usage.cacheText(null, 7),
    plugins: 'No plugin savings reports installed.',
  });
  const summaryAt = text.indexOf('No Claude Code or Codex sessions in 7 days');
  const cacheAt = text.indexOf('No status-line snapshots in 7 days.');
  const pluginsAt = text.indexOf('No plugin savings reports installed.');
  assert.ok(summaryAt >= 0 && cacheAt > summaryAt && pluginsAt > cacheAt);
  assert.match(text, /Cursor: open Dashboard → Usage\./);
  assert.ok(!/TOKEN SAVINGS|0 responses|session\s+last seen|Usage:|total\s+0/.test(text));
});

test('askai usage --full includes the cache and plugin lines', () => {
  const home = tmpHome();
  try {
    const sys = process.env.SystemRoot || 'C:\\Windows';
    const PATH = process.platform === 'win32' ? [path.join(sys, 'System32'), home].join(';') : home;
    const r = cli(['usage', '1', '--full', '--claude-home', home, '--repo', home], {
      env: { PATH, USERPROFILE: home, HOME: home, LOCALAPPDATA: home, PATHEXT: '.CMD;.EXE;.BAT;.COM' },
    });
    assert.strictEqual(r.code, 0, r.err);
    const summaryAt = r.out.indexOf('No Claude Code or Codex sessions in 1 days');
    const cacheAt = r.out.indexOf('No status-line snapshots in 1 days.');
    const pluginsAt = r.out.indexOf('No plugin savings reports installed.');
    assert.ok(summaryAt >= 0 && cacheAt > summaryAt && pluginsAt > cacheAt, r.out.slice(0, 500));
    assert.ok(!/TOKEN SAVINGS|0 responses|session\s+last seen|Usage:/.test(r.out));
  } finally { rm(home); }
});
