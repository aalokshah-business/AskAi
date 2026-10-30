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

test('every explicit category name and alias resolves, including system', () => {
  for (const [name, cat] of Object.entries(help.CATEGORIES)) {
    assert.equal(cli(['help', 'category', name]).code, 0, name);
    for (const alias of cat.aliases) assert.equal(help.findCategory(alias)[0], name, alias);
  }
});

test('howto walks a category in run order with each command usage', () => {
  const setup = cli(['howto', 'setup']);
  assert.equal(setup.code, 0);
  help.CATEGORIES.setup.commands.forEach(([name], index) => assert.ok(setup.out.includes(`${index + 1}. askai ${name}`), name));
  assert.match(setup.out, /askai install/);
  assert.equal(cli(['howto', 'category', 'spend']).out, cli(['howto', 'cost']).out);
  assert.match(cli(['howto', 'learn']).out, /1\. askai ask/);
  assert.match(cli(['howto', 'project']).out, /1\. askai project/);
  assert.match(cli(['howto', 'work']).out, /1\. askai next/);
  assert.equal(cli(['howto', 'nope']).code, 1);
  assert.match(cli(['howto']).out, /askai howto setup/);
  assert.equal(help.groupOf('howto').group, 'system');
});

test('command help includes detailed options and disambiguates category names', () => {
  assert.match(cli(['help', 'check']).out, /Usage: askai check \[dir\]/);
  assert.match(cli(['help', 'command', 'setup']).out, /Usage: askai setup/);
  assert.doesNotMatch(cli(['help', 'category', 'setup']).out, /Usage:/);
  assert.doesNotMatch(cli(['help', 'category', 'check']).out, /Usage:/);
  assert.equal(cli(['help', 'category', 'unknown']).code, 1);
  assert.equal(cli(['help', 'command', 'unknown']).code, 1);
});
