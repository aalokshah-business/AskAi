'use strict';
const test = require('node:test');
const assert = require('node:assert');
const status = require('../lib/status');
const { tmpHome, rm, makeCtx } = require('./helpers');

test('status includes configured MCP hosts beyond the recorded install target', () => {
  const {write,path} = require('./helpers');
  const home = tmpHome();
  try {
    const ctx = makeCtx(home,{agyHome:path.join(home,'gemini'),codexHome:path.join(home,'codex')});
    ctx.hostSel = {codex:true};
    ctx.manifest.components.headroom = {};
    write(ctx.agyPaths.mcp,JSON.stringify({mcpServers:{headroom:{command:'headroom',args:['mcp','serve']}}}));
    const row = status.collect(ctx).find(r=>r.id === 'headroom');
    assert.strictEqual(row.hosts.agy,'ok');
  } finally { rm(home); }
});

test('status renders four columns in requested environment order', () => {
  const home = tmpHome();
  try {
    const text = status.renderStatus(makeCtx(home), null, {width:120}).lines.join('\n');
    assert.match(text, /Codex\s+Antigravity\s+Cursor\s+Claude Code/);
    assert.match(text, /not installed/);
    assert.match(text, /configured/);
  } finally { rm(home); }
});

test('status filters one environment and projects shared registrations without cross-host claims', () => {
  const rows = [
    {id:'baseline', host:'claude'}, {id:'codex-baseline', host:'codex'},
    {id:'headroom', host:'any', state:'partial', detail:'all hosts', hosts:{claude:'missing',codex:'ok'}},
    {id:'base-tools', host:'any', state:'ok'},
  ];
  const filtered = status.statusRows(rows, status.statusHost('codex'));
  assert.deepStrictEqual(filtered.map(r => r.id), ['codex-baseline','headroom','base-tools']);
  assert.strictEqual(filtered[1].state, 'ok');
  assert.strictEqual(filtered[1].detail, 'Codex: ok');
  assert.deepStrictEqual(filtered[1].hosts, {codex:'ok'});
  assert.strictEqual(status.statusHost('antigravity'), 'agy');
  assert.throws(() => status.statusHost('unknown'), /status environment/);
});

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
