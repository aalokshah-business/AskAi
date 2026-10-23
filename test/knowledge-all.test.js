'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const kb = require('../lib/kb');
const answers = require('./kb-answers.json');

test('every ask topic is rendered from knowledge/*.yaml and the answer is unchanged', () => {
  assert.strictEqual(kb.KB.length, answers.length);
  assert.deepStrictEqual(kb.KB.map(e => e.id), answers.map(a => a.id));
  for (let i = 0; i < answers.length; i++) {
    assert.strictEqual(kb.render(kb.KB[i]), answers[i].render, answers[i].id);
  }
  const dir = path.join(__dirname, '..', 'knowledge');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => f.slice(0, -5)).sort();
  assert.deepStrictEqual(files, [...answers.map(a => a.id)].sort());
});
