'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const todo = require('../lib/todo');
const { tmpHome, rm, makeCtx } = require('./helpers');

test('todo reuses one item list until the done-list changes', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home, { codexHome: path.join(home, 'codex') });
    fs.mkdirSync(ctx.codexPaths.home, { recursive: true });
    const first = todo.items(ctx, home);
    assert.strictEqual(todo.items(ctx, home), first);
    todo.mark(ctx, 'codex-trust', true);
    const again = todo.items(ctx, home);
    assert.notStrictEqual(again, first);
    assert.strictEqual(again.find(i => i.id === 'codex-trust').done, true);
    assert.ok(!todo.open(again).some(i => i.id === 'codex-trust'));
  } finally { rm(home); }
});
