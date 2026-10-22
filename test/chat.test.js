'use strict';
const test = require('node:test');
const assert = require('node:assert');
const chat = require('../lib/chat');
const { cli } = require('./helpers');

test('askai chat names each app and the same short instruction', () => {
  const all = chat.render();
  assert.match(all, /Instructions for Claude/);
  assert.match(all, /Custom instructions/);
  assert.match(all, /Instructions for Gemini/);
  assert.match(all, /askai install/);
  assert.ok(all.includes(chat.INSTRUCTION));
  assert.ok(all.includes(chat.PROJECT));
  assert.match(all, /current chapter/);
  assert.doesNotMatch(all, /AGENTS\.md/);
  assert.match(chat.render('chatgpt'), /not Codex/);
  assert.match(chat.render('gemini'), /Antigravity/);
  assert.doesNotMatch(chat.render('code'), /Instruction to paste/);
  assert.throws(() => chat.render('desktop'), /unknown surface/);
  const r = cli(['chat', 'claude']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /Instructions for Claude/);
  assert.strictEqual(cli(['chat', 'nope']).code, 1);
});
