'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const kb = require('../lib/kb');
const knowledge = require('../lib/knowledge');
const { cli, tmpHome, rm } = require('./helpers');

const expected = [
  'Compacting is not free',
  '  Rule: Compact only a chat you must keep, at a natural boundary, with instructions; prefer a handoff plus a fresh chat. Trigger it yourself around 50-60% context used (three creators converge on this range); do not wait for the built-in auto-compact at 95%.',
  '  Why:  /compact reads the whole conversation to write its summary: a large request itself (Anthropic cost guide). Waiting for the 95% auto-trigger leaves little room for the summary itself: it can run out of context mid-summary and leave you with an incomplete compact or an error, instead of the large request you were trying to avoid.',
  '  Claude Code  /compact keep: goal, files, failing test',
  '  Codex        /compact',
  '  Antigravity  fresh chat + handoff',
  '  Cursor       /summarize',
  '  askai:       askai break, then a fresh chat',
].join('\n');

test('ask compact is rendered from knowledge/compact.yaml', () => {
  const fromFile = knowledge.load(path.join(__dirname, '..', 'knowledge'), 'compact');
  const hits = kb.KB.filter(e => e.id === 'compact');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].rule, fromFile.rule);
  assert.strictEqual(hits[0].why, fromFile.why);
  assert.strictEqual(kb.render(hits[0]), expected);
  assert.strictEqual(kb.search('compact')[0].id, 'compact');
  assert.ok(kb.KB.some(e => e.id === 'billing' && e.title === 'Billing traps'));
});

test('askai ask compact prints the same answer', () => {
  const home = tmpHome();
  try {
    const r = cli(['ask', 'compact', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.out.trim(), `${expected}\n\nRelated: cache-breakers`);
  } finally { rm(home); }
});
