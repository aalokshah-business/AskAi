'use strict';
const test = require('node:test');
const assert = require('node:assert');
const status = require('../lib/status');
const { tmpHome, rm, makeCtx } = require('./helpers');

test('status reuses one component scan until the profile record changes', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home);
    const rows = status.collect(ctx);
    assert.strictEqual(status.collect(ctx), rows);
    const rendered = status.renderStatus(ctx);
    assert.strictEqual(rendered.rows, rows);
    status.doctor(ctx);
    assert.strictEqual(status.collect(ctx), rows);
    ctx.manifest.components.rules = { files: [] };
    const again = status.collect(ctx);
    assert.notStrictEqual(again, rows);
    assert.strictEqual(again.find(r => r.id === 'rules').wanted, true);
    assert.match(status.renderStatus(ctx).lines.join('\n'), /\brules\b/);
  } finally { rm(home); }
});
