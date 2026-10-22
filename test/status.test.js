'use strict';
const test = require('node:test');
const assert = require('node:assert');
const status = require('../lib/status');
const { tmpHome, rm, write, readJson, makeCtx, fs, path } = require('./helpers');

// opts.cursor: true wires a Cursor home (a temp dir next to the claude home) into the ctx.
function withCtx(fn, { cursor, ...opts } = {}, fakes = {}) {
  const home = tmpHome(), cursorHome = `${home}-cursor`;
  try { return fn(makeCtx(home, cursor ? { ...opts, cursorHome } : opts, fakes), home, cursorHome); } finally { rm(home); rm(cursorHome); }
}
const sessionFile = (home, id) => path.join(home, 'askai', 'sessions', `${id}.json`);
const stdin = o => JSON.stringify(o);
const ago = ms => new Date(Date.now() - ms);
const RTK_GAIN = JSON.stringify({ summary: { total_commands: 5, total_input: 1000, total_output: 200, total_saved: 800, avg_savings_pct: 80 } });

test('fmt: plain, thousands, millions', () => {
  assert.strictEqual(status.fmt(0), '0');
  assert.strictEqual(status.fmt(999), '999');
  assert.strictEqual(status.fmt(1500), '1.5K');
  assert.strictEqual(status.fmt(2000), '2K');
  assert.strictEqual(status.fmt(2_340_000), '2.34M');
  assert.strictEqual(status.fmt('junk'), '0');
});

// ---- rtk numbers ----------------------------------------------------------------------------------------------------------
test('rtkSavings: reads rtk gain json; a missing rtk or unexpected output is reported, never guessed', () => {
  withCtx(ctx => {
    assert.deepStrictEqual(status.rtkSavings(ctx, false), { ok: false, reason: 'rtk not installed' });
  });
  withCtx(ctx => {
    assert.deepStrictEqual(status.rtkSavings(ctx, false), { ok: true, commands: 5, input: 1000, output: 200, saved: 800, pct: 80 });
  }, {}, { tools: { rtk: '/x/rtk' }, probe: () => ({ ok: true, status: 0, stdout: RTK_GAIN, stderr: '', error: null }) });
  withCtx(ctx => {
    assert.strictEqual(status.rtkSavings(ctx, false).reason, 'unexpected rtk gain output');
  }, {}, { tools: { rtk: '/x/rtk' }, probe: () => ({ ok: true, status: 0, stdout: '{"nope":1}', stderr: '', error: null }) });
  withCtx(ctx => {
    assert.strictEqual(status.rtkSavings(ctx, false).reason, 'rtk gain failed');
  }, {}, { tools: { rtk: '/x/rtk' } });
});

test('rtkSavings: the cache is used within the TTL and is only written where askai is installed', () => {
  let n = 0;
  const fakes = { tools: { rtk: '/x/rtk' }, probe: () => { n++; return { ok: true, status: 0, stdout: RTK_GAIN, stderr: '', error: null }; } };
  withCtx((ctx, home) => {
    status.rtkSavings(ctx, true);
    assert.ok(!fs.existsSync(path.join(home, 'askai')), 'a read-only command creates no askai directory');
    status.rtkSavings(ctx, true);
    assert.strictEqual(n, 2, 'no directory, so no cache: both calls ask rtk');
  }, {}, fakes);
  n = 0;
  withCtx((ctx, home) => {
    fs.mkdirSync(path.join(home, 'askai'));
    status.rtkSavings(ctx, true);
    status.rtkSavings(ctx, true);
    assert.strictEqual(n, 1, 'second call is served from the cache');
    status.rtkSavings(ctx, false);
    assert.strictEqual(n, 2, 'useCache=false always asks rtk');
  }, {}, fakes);
});

// ---- status line ----------------------------------------------------------------------------------------------------------
test('statusline: context and cache figures from Claude Code, rtk total, first line of context-mode', () => {
  withCtx(ctx => {
    const line = status.renderStatusline(ctx, stdin({ context_window: { used_percentage: 41.6 }, prompt_cache: { hit_ratio: 0.873 } }));
    assert.strictEqual(line, 'ctx 42% | cache 87% | rtk saved 800 (80%) | cm 12K saved');
  }, {}, {
    tools: { rtk: '/x/rtk', 'context-mode': '/x/cm' },
    probe: cmd => (cmd === 'rtk'
      ? { ok: true, status: 0, stdout: RTK_GAIN, stderr: '', error: null }
      : { ok: true, status: 0, stdout: 'cm 12K saved\nsecond line\n', stderr: '', error: null }),
  });
});

test('statusline: a failing context-mode or rtk drops only its own segment; nothing to show falls back to "askai"', () => {
  withCtx(ctx => {
    assert.strictEqual(status.renderStatusline(ctx, stdin({ context_window: { used_percentage: 10 } })), 'ctx 10%');
    assert.strictEqual(status.renderStatusline(ctx, ''), 'askai');
  });
  withCtx(ctx => {
    assert.strictEqual(status.renderStatusline(ctx, ''), 'askai', 'context-mode present but failing');
  }, {}, { tools: { 'context-mode': '/x/cm' } });
});

test('statusline: garbage, arrays, wrong types and missing fields never throw', () => {
  withCtx(ctx => {
    for (const bad of ['{ not json', '[]', '"text"', '5', 'null', stdin({ context_window: 'x', prompt_cache: 5, rate_limits: [] }), stdin({ context_window: { used_percentage: 'high' } })]) {
      assert.strictEqual(status.renderStatusline(ctx, bad), 'askai', bad);
    }
    assert.strictEqual(status.renderStatusline(ctx, undefined), 'askai');
  });
});

test('statusline: no snapshot is written where askai is not installed', () => withCtx((ctx, home) => {
  status.renderStatusline(ctx, stdin({ session_id: 'abc', context_window: { used_percentage: 5 } }));
  assert.ok(!fs.existsSync(path.join(home, 'askai')));
}));

test('statusline: a snapshot keeps the compact fields; the throttle keeps it for 30 s and then refreshes it', () => withCtx((ctx, home) => {
  fs.mkdirSync(path.join(home, 'askai'));
  const at = pctUsed => stdin({
    session_id: 'sess-1',
    context_window: { used_percentage: pctUsed },
    prompt_cache: { hit_ratio: 0.9, requests: 10, misses: 1, expected_rebuilds: 0, cache_write_tokens: 500, miss_recache_tokens: 42000, last_miss_cause: 'ttl', extra: 'dropped' },
    rate_limits: { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 12.5 }, other: 1 },
    transcript_path: '/secret/path',
  });
  status.renderStatusline(ctx, at(20));
  const f = sessionFile(home, 'sess-1');
  const snap = readJson(f);
  assert.deepStrictEqual(Object.keys(snap).sort(), ['at', 'cache', 'ctxPct', 'id', 'rate']);
  assert.strictEqual(snap.id, 'sess-1');
  assert.strictEqual(snap.ctxPct, 20);
  assert.deepStrictEqual(snap.cache, { hitRatio: 0.9, requests: 10, misses: 1, expectedRebuilds: 0, cacheWriteTokens: 500, missRecacheTokens: 42000, lastMissCause: 'ttl' });
  assert.deepStrictEqual(snap.rate, { fiveHour: 30, sevenDay: 12.5 });
  assert.ok(!fs.readFileSync(f, 'utf8').includes('/secret/path'), 'transcript paths are not stored');

  status.renderStatusline(ctx, at(55));
  assert.strictEqual(readJson(f).ctxPct, 20, 'within 30 s: not rewritten');
  fs.utimesSync(f, ago(60_000), ago(60_000));
  status.renderStatusline(ctx, at(55));
  assert.strictEqual(readJson(f).ctxPct, 55, 'after 30 s: refreshed');
}));

test('statusline: only safe session ids become file names', () => withCtx((ctx, home) => {
  fs.mkdirSync(path.join(home, 'askai'));
  for (const id of ['../evil', 'a/b', 'a b', '', 'x'.repeat(81), 7, null, { a: 1 }]) {
    status.renderStatusline(ctx, stdin({ session_id: id, context_window: { used_percentage: 5 } }));
  }
  assert.ok(!fs.existsSync(path.join(home, 'askai', 'sessions')), 'nothing was written');
  assert.ok(!fs.existsSync(path.join(home, 'askai', 'evil.json')));
  status.renderStatusline(ctx, stdin({ session_id: 'ok_ID-1', context_window: { used_percentage: 5 } }));
  assert.deepStrictEqual(fs.readdirSync(path.join(home, 'askai', 'sessions')), ['ok_ID-1.json']);
}));

test('statusline: snapshots older than 14 days are dropped on the next write, newer ones stay', () => withCtx((ctx, home) => {
  fs.mkdirSync(path.join(home, 'askai'));
  write(sessionFile(home, 'old'), '{}');
  write(sessionFile(home, 'recent'), '{}');
  fs.utimesSync(sessionFile(home, 'old'), ago(15 * 86400_000), ago(15 * 86400_000));
  fs.utimesSync(sessionFile(home, 'recent'), ago(13 * 86400_000), ago(13 * 86400_000));
  status.renderStatusline(ctx, stdin({ session_id: 'now', context_window: { used_percentage: 1 } }));
  assert.deepStrictEqual(fs.readdirSync(path.join(home, 'askai', 'sessions')).sort(), ['now.json', 'recent.json']);
}));

// ---- cache report ---------------------------------------------------------------------------------------------------------
function snap(home, id, ageMs, extra = {}) {
  write(sessionFile(home, id), JSON.stringify({ id, at: Date.now() - ageMs, ctxPct: 50, cache: {}, rate: { fiveHour: null, sevenDay: null }, ...extra }));
}

test('sessionSnapshots: newest first, limited to the window, damaged and foreign files skipped', () => withCtx((ctx, home) => {
  assert.deepStrictEqual(status.sessionSnapshots(ctx, 6), [], 'no directory');
  snap(home, 'b-older', 3600_000);
  snap(home, 'a-newer', 60_000);
  snap(home, 'c-outside', 10 * 3600_000);
  write(sessionFile(home, 'broken'), '{ nope');
  write(sessionFile(home, 'noid'), JSON.stringify({ at: Date.now() }));
  write(sessionFile(home, 'noat'), JSON.stringify({ id: 'noat' }));
  write(path.join(home, 'askai', 'sessions', 'readme.txt'), 'x');
  assert.deepStrictEqual(status.sessionSnapshots(ctx, 6).map(s => s.id), ['a-newer', 'b-older']);
  assert.deepStrictEqual(status.sessionSnapshots(ctx, 24).map(s => s.id), ['a-newer', 'b-older', 'c-outside']);
}));

test('renderCache: null when nothing was recorded', () => withCtx(ctx => {
  assert.strictEqual(status.renderCache(ctx, 6), null);
}));

test('renderCache: a table with the recorded figures, "-" where a field was absent, no invented numbers', () => withCtx((ctx, home) => {
  snap(home, 'sess1234567', 60_000, { ctxPct: 41.6, cache: { hitRatio: 0.873, requests: 12, misses: 2, missRecacheTokens: 48000, lastMissCause: 'ttl' } });
  snap(home, 'other-sess', 120_000, { ctxPct: null, cache: { hitRatio: null, requests: null, missRecacheTokens: null, lastMissCause: null } });
  const r = status.renderCache(ctx, 6);
  const text = r.lines.join('\n');
  assert.strictEqual(r.rows.length, 2);
  assert.match(r.lines[0], /^session\s+last seen \(UTC\)\s+context\s+cache hit\s+misses\/requests\s+re-cache tokens\s+last miss cause$/);
  assert.match(r.lines[1], /^sess1234\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+42%\s+87%\s+2\/12\s+48K\s+ttl$/);
  assert.match(r.lines[2], /^other-se\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+-\s+-\s+-\s+-\s+-$/);
  assert.ok(!/plan limits/.test(text), 'no rate data, no plan-limits line');
  assert.match(text, /what Claude Code last reported/);
  assert.match(text, /main conversation only, not subagents/);
}));

test('renderCache: adds the plan-limits line from the newest report that has rate data', () => withCtx((ctx, home) => {
  snap(home, 'new', 60_000, { rate: { fiveHour: null, sevenDay: null } });
  snap(home, 'mid', 120_000, { rate: { fiveHour: 30.4, sevenDay: 12 } });
  snap(home, 'old', 180_000, { rate: { fiveHour: 99, sevenDay: 99 } });
  const text = status.renderCache(ctx, 6).lines.join('\n');
  assert.match(text, /plan limits \(latest report\): 5-hour window 30% used, 7-day window 12% used/);
}));

// ---- profile, rows, doctor ------------------------------------------------------------------------------------------------
test('profileInfo: --profile, then the recorded profile, then the default; a bad recorded name falls back', () => {
  withCtx(ctx => {
    assert.deepStrictEqual([status.profileInfo(ctx).name, status.profileInfo(ctx).source], ['coding', 'default, none recorded yet']);
  });
  withCtx(ctx => {
    ctx.manifest.profile = 'docs';
    assert.deepStrictEqual([status.profileInfo(ctx).name, status.profileInfo(ctx).source], ['docs', 'recorded by askai install']);
  });
  withCtx(ctx => {
    ctx.manifest.profile = 'docs';
    assert.deepStrictEqual([status.profileInfo(ctx).name, status.profileInfo(ctx).source], ['minimal', '--profile']);
  }, { profile: 'minimal' });
  withCtx(ctx => {
    ctx.manifest.profile = 'gone';
    assert.deepStrictEqual([status.profileInfo(ctx).name, status.profileInfo(ctx).source], ['coding', 'default (recorded profile unknown)']);
  });
});

test('collect: a tool outside the profile is "not wanted"; opt-in tools appear only when added; no Cursor rows in a plain sandbox', () => {
  withCtx(ctx => {
    ctx.manifest.profile = 'docs';
    const rows = status.collect(ctx);
    const by = id => rows.find(r => r.id === id);
    assert.strictEqual(by('serena').wanted, false);
    assert.ok(!by('context-mode'), 'Context Mode is opt-in since 3.1: not listed while absent');
    assert.ok(!by('cursor-rtk') && !by('cursor-serena') && !by('cursor-context-mode') && !by('cursor-rules'));
    assert.ok(!by('markitdown') && !by('ccusage') && !by('caveman-plugin') && !by('rules'), 'opt-in and absent: not listed');
    ctx.manifest.components.rules = { files: [] };
    assert.strictEqual(status.collect(ctx).find(r => r.id === 'rules').wanted, true, 'listed once recorded, and part of every profile');
  });
  withCtx(ctx => {
    ctx.manifest.components.markitdown = { installedByAskai: true };
    const m = status.collect(ctx).find(r => r.id === 'markitdown');
    assert.ok(m && m.wanted, 'added on purpose, so listed and wanted even outside the profile');
  }, { profile: 'minimal' });
});

test('collect: a component whose check throws becomes "partial" instead of breaking the report', () => withCtx(ctx => {
  ctx.claudeBin = () => { throw new Error('boom'); };
  const rows = status.collect(ctx);
  assert.ok(rows.length > 5, 'the other rows are still there');
  const failed = rows.filter(r => /check failed: boom/.test(r.detail));
  assert.ok(failed.some(r => r.id === 'claude') && failed.every(r => r.state === 'partial'), 'components that call claudeBin report partial');
  assert.ok(rows.some(r => r.id === 'baseline' && !/check failed/.test(r.detail)), 'unrelated rows are unaffected');
}));

test('collect: Cursor rows appear when Cursor is in play, with what each one is wired to', () => withCtx((ctx, home, cursorHome) => {
  const rows = status.collect(ctx);
  const ids = rows.filter(r => r.id.startsWith('cursor-')).map(r => r.id);
  assert.deepStrictEqual(ids, ['cursor-rtk', 'cursor-context-mode', 'cursor-serena', 'cursor-rules']);
  assert.match(rows.find(r => r.id === 'cursor-rtk').wiring, /hooks\.json/);
  const r = status.renderStatus(ctx);
  assert.match(r.lines[0], new RegExp(`cursor home: ${cursorHome.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
  assert.match(r.lines.join('\n'), /Cursor: the status line, cache figures, ccusage and the spend report read Claude Code only/);
}, { profile: 'coding', cursor: true }));

test('renderStatus: profile line, per-tool wiring, and the honesty footer', () => withCtx(ctx => {
  const r = status.renderStatus(ctx);
  assert.match(r.lines[1], /^profile: machine coding \(default, none recorded yet\)/);
  assert.strictEqual(r.profile, 'coding');
  assert.match(r.lines.join('\n'), /Only tool-measured numbers are shown/);
  assert.ok(!/Cursor: the status line/.test(r.lines.join('\n')), 'no Cursor note when Cursor is not in play');
}));

test('doctor: a tool outside the profile is omitted, one inside it is a warning', () => {
  withCtx(ctx => {
    ctx.manifest.profile = 'docs';
    const d = status.doctor(ctx);
    assert.strictEqual(d.find(r => r.id === 'serena'), undefined, 'a tool outside the profile is left out');
    assert.strictEqual(d.find(r => r.id === 'caveman').level, 'warn', 'in the docs profile and missing');
  });
  withCtx(ctx => {
    const d = status.doctor(ctx);
    assert.strictEqual(d.find(r => r.id === 'serena').level, 'warn', 'coding profile wants serena');
  });
});

test('doctor: unparseable settings.json is a failure and stops the per-tool rows', () => withCtx((ctx, home) => {
  write(path.join(home, 'settings.json'), '{ nope');
  const d = status.doctor(ctx);
  assert.strictEqual(d.find(r => r.id === 'settings').level, 'fail');
  assert.ok(!d.some(r => r.id === 'rtk'));
}));

test('doctor: Cursor config files are checked only when Cursor is in play and only if they exist', () => withCtx((ctx, home, cursorHome) => {
  assert.ok(!status.doctor(ctx).some(r => /^cursor-(mcp|hooks)$/.test(r.id)), 'no files yet');
  write(path.join(cursorHome, 'mcp.json'), '{"mcpServers":{}}');
  write(path.join(cursorHome, 'hooks.json'), '{ nope');
  const d = status.doctor(ctx);
  assert.strictEqual(d.find(r => r.id === 'cursor-mcp').level, 'ok');
  assert.strictEqual(d.find(r => r.id === 'cursor-hooks').level, 'fail');
}, { cursor: true }));

test('doctor: warns about a missing manifest and about two terse directives in CLAUDE.md', () => withCtx((ctx, home) => {
  assert.ok(status.doctor(ctx).some(r => r.id === 'manifest' && r.level === 'warn'));
  write(path.join(home, 'CLAUDE.md'), '# Terse output (caveman, full)\nx\n# Terse output (caveman, ultra)\ny\n');
  assert.ok(status.doctor(ctx).some(r => r.id === 'caveman' && /2 times/.test(r.msg)));
}));
