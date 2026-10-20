'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../lib/claude-config');
const { tmpHome, rm, write, path } = require('./helpers');

test('applyBaseline adds only missing keys and never overrides', () => {
  const s = { autoCompactWindow: 200000, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus', OTHER: '1' } };
  const added = cfg.applyBaseline(s, { mainModel: 'keep' });
  assert.strictEqual(s.autoCompactWindow, 200000);
  assert.strictEqual(s.env.CLAUDE_CODE_SUBAGENT_MODEL, 'opus');
  assert.strictEqual(s.env.OTHER, '1');
  assert.ok(added.every(a => a.key.startsWith('skillOverrides.') || a.key === 'effortLevel'), 'only skillOverrides entries and effortLevel were added');
  assert.deepStrictEqual(cfg.applyBaseline(s, { mainModel: 'keep' }), [], 'second run adds nothing');
});

test('applyBaseline: the main model is haiku by default, never overrides one already set, and --main-model keep skips it', () => {
  const fresh = {};
  assert.ok(cfg.applyBaseline(fresh).some(a => a.key === 'model' && a.value === 'haiku'));
  assert.strictEqual(fresh.effortLevel, 'medium');
  const mine = { model: 'opus[1m]' };
  cfg.applyBaseline(mine, { mainModel: 'haiku' });
  assert.strictEqual(mine.model, 'opus[1m]', 'an existing model is the user\'s choice');
  const kept = {};
  cfg.applyBaseline(kept, { mainModel: 'keep', subagentModel: 'haiku' });
  assert.ok(!('model' in kept));
  assert.strictEqual(kept.env.CLAUDE_CODE_SUBAGENT_MODEL, 'haiku');
  const other = {}; cfg.applyBaseline(other, { subagentModel: 'sonnet' });
  assert.strictEqual(other.env.CLAUDE_CODE_SUBAGENT_MODEL, 'sonnet');
  assert.strictEqual(cfg.BASELINE.env.CLAUDE_CODE_SUBAGENT_MODEL, 'haiku', 'BASELINE itself is never mutated');
});

test('removeKey removes nested keys only while they still hold the value askai set', () => {
  const s = { env: { A: '1', B: '2' } };
  assert.strictEqual(cfg.removeKey(s, 'env.A', '9'), false);
  assert.strictEqual(cfg.removeKey(s, 'env.A', '1'), true);
  assert.strictEqual(cfg.removeKey(s, 'env.B', '2'), true);
  assert.ok(!('env' in s), 'empty parent object is dropped');
});

test('removeLegacyHooks drops askai hook entries and keeps everything else', () => {
  const s = { hooks: { UserPromptSubmit: [
    { hooks: [{ type: 'command', command: 'powershell -File C:/x/askai-hook.ps1' }] },
    { hooks: [{ type: 'command', command: 'node other.js' }] },
  ] } };
  assert.strictEqual(cfg.removeLegacyHooks(s), 1);
  assert.strictEqual(s.hooks.UserPromptSubmit.length, 1);
  assert.strictEqual(s.hooks.UserPromptSubmit[0].hooks[0].command, 'node other.js');
});

test('readJson: missing file is {}, unparseable file throws instead of being overwritten', () => {
  const dir = tmpHome();
  try {
    assert.deepStrictEqual(cfg.readJson(path.join(dir, 'none.json')), {});
    write(path.join(dir, 'bad.json'), '{ not json');
    assert.throws(() => cfg.readJson(path.join(dir, 'bad.json')), /askai will not overwrite/);
  } finally { rm(dir); }
});

test('setStatusLine takes a free slot, updates its own, keeps someone elses', () => {
  const s = {};
  assert.strictEqual(cfg.setStatusLine(s, 'node "C:/a/askai/app/askai.js" statusline'), 'set');
  assert.strictEqual(cfg.setStatusLine(s, 'node "C:/a/askai/app/askai.js" statusline'), 'unchanged');
  assert.strictEqual(cfg.setStatusLine(s, 'node "D:/b/askai/app/askai.js" statusline'), 'updated');
  const other = { statusLine: { type: 'command', command: 'my-line.sh' } };
  assert.strictEqual(cfg.setStatusLine(other, 'x'), 'kept-other');
  assert.strictEqual(other.statusLine.command, 'my-line.sh');
});

test('managed block: upsert is idempotent, remove restores the original text', () => {
  const original = '# My rules\nBe nice.\n';
  const body = cfg.buildBlockBody(original, 'full');
  const a = cfg.upsertBlock(original, body);
  assert.ok(a.changed && a.text.startsWith(original));
  assert.strictEqual(cfg.upsertBlock(a.text, body).changed, false);
  assert.strictEqual(cfg.removeBlock(a.text).text, original);
  assert.strictEqual(cfg.removeBlock(original).changed, false);
  assert.strictEqual(cfg.removeBlock(cfg.upsertBlock('', body).text).text, '');
});

test('terse directive is not duplicated when one already exists outside the block', () => {
  const mine = '# Terse output (caveman, full)\nReply terse.\n';
  assert.ok(cfg.hasTerseOutside(mine));
  const body = cfg.buildBlockBody(mine, 'full');
  assert.ok(!/Terse output \(caveman/.test(body));
  const fresh = cfg.buildBlockBody('# other\n', 'ultra');
  assert.ok(/Terse output \(caveman, ultra\)/.test(fresh));
  assert.ok(!/Terse output \(caveman/.test(cfg.buildBlockBody('', 'off')));
  // the block's own terse heading does not count as "outside"
  assert.ok(!cfg.hasTerseOutside(cfg.upsertBlock('', fresh).text));
});

test('CRLF files keep CRLF line endings when the block is added', () => {
  const text = 'line one\r\nline two\r\n';
  const { text: next } = cfg.upsertBlock(text, cfg.buildBlockBody(text, 'off'));
  assert.ok(!/[^\r]\n/.test(next), 'no bare LF introduced');
});

test('backup copies a file once per run and skips missing files', () => {
  const dir = tmpHome();
  try {
    const paths = cfg.claudePaths(dir, true);
    write(paths.settings, '{"a":1}');
    const backup = cfg.makeBackup(paths, 'stamp');
    const dest = backup(paths.settings);
    assert.ok(dest && dest.includes('stamp'));
    write(paths.settings, '{"a":2}');
    assert.strictEqual(backup(paths.settings), null, 'second call in the same run is a no-op');
    assert.strictEqual(backup(path.join(dir, 'missing')), null);
    assert.strictEqual(cfg.readJson(dest).a, 1);
  } finally { rm(dir); }
});
