'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cli } = require('./helpers');
const help = require('../lib/help');

test('help lists seven categories with current command counts', () => {
  const r = cli(['help']);
  assert.equal(r.code, 0);
  for (const [name, cat] of Object.entries(help.CATEGORIES)) {
    assert.match(r.out, new RegExp(`${name}\\s+${cat.commands.length} commands`));
  }
});

test('category help has one short description per command and supports aliases', () => {
  const r = cli(['help', 'work']);
  assert.equal(r.code, 0);
  for (const [name, desc] of help.CATEGORIES.work.commands) assert.ok(r.out.includes(desc), name);
  assert.equal(cli(['help', 'category', 'daily']).out, r.out);
  assert.doesNotMatch(r.out, /Usage:/);
});

test('command help includes detailed options and disambiguates category names', () => {
  assert.match(cli(['help', 'check']).out, /Usage: askai check \[dir\]/);
  assert.match(cli(['help', 'command', 'setup']).out, /Usage: askai setup/);
  assert.doesNotMatch(cli(['help', 'category', 'setup']).out, /Usage:/);
  assert.doesNotMatch(cli(['help', 'category', 'check']).out, /Usage:/);
  assert.equal(cli(['help', 'category', 'unknown']).code, 1);
  assert.equal(cli(['help', 'command', 'unknown']).code, 1);
});
