'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpHome, rm, makeCtx } = require('./helpers');
const todo = require('../lib/todo');

test('a confirmed to-do stays hidden until reopened; detected items cannot be dismissed', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home, { codexHome: path.join(home, 'codex') });
    fs.mkdirSync(ctx.codexPaths.home, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'AGENTS.md'), '# Project\n(one or two sentences)\n');
    assert.ok(todo.open(todo.items(ctx, home)).some(i => i.id === 'codex-signin'));
    todo.mark(ctx, 'codex-signin', true);
    assert.ok(!todo.open(todo.items(ctx, home)).some(i => i.id === 'codex-signin'));
    todo.mark(ctx, 'codex-signin', false);
    assert.ok(todo.open(todo.items(ctx, home)).some(i => i.id === 'codex-signin'));
    todo.mark(ctx, 'agents-about', true);
    assert.ok(todo.open(todo.items(ctx, home)).some(i => i.id === 'agents-about'));
  } finally { rm(home); }
});
