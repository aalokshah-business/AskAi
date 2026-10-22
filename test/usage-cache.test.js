'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cli, tmpHome, rm, fs, path } = require('./helpers');

test('usage --cache with no snapshots is one line', () => {
  const home = tmpHome();
  try {
    const r = cli(['usage', '--cache', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /No status-line snapshots in 7 days\./);
    assert.strictEqual(r.out.trim().split(/\r?\n/).length, 1);
    assert.ok(!/session\s+last seen|TOKEN SAVINGS|0 responses|total\s+0/.test(r.out));
  } finally { rm(home); }
});

test('usage --cache prints cache hit for a snapshot in the window', () => {
  const home = tmpHome();
  try {
    const dir = path.join(home, 'askai', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sess1234.json'), JSON.stringify({
      id: 'sess1234567', at: Date.now() - 60_000, ctxPct: 41.6,
      cache: { hitRatio: 0.873, requests: 12, misses: 2, missRecacheTokens: 48000, lastMissCause: 'ttl' },
    }));
    const r = cli(['usage', '1', '--cache', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /cache hit/);
    assert.match(r.out, /87%/);
    assert.ok(!/No status-line snapshots/.test(r.out));
  } finally { rm(home); }
});

test('usage --cache ignores a snapshot outside the window', () => {
  const home = tmpHome();
  try {
    const dir = path.join(home, 'askai', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({
      id: 'oldsession', at: Date.now() - 48 * 3600_000, ctxPct: 10,
      cache: { hitRatio: 0.5, requests: 4, misses: 1 },
    }));
    const r = cli(['usage', '1', '--cache', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /No status-line snapshots in 1 days\./);
    assert.ok(!/50%/.test(r.out));
  } finally { rm(home); }
});
