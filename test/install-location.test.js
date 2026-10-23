'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const { fs, path, tmpHome, rm, write } = require('./helpers');
const { syncLegacyApp } = require('../askai');
const cfg = require('../lib/claude-config');

test('a registry-only modern folder does not replace legacy installation state', () => {
  const root = tmpHome(), prev = process.env.ASKAI_HOME;
  try {
    const home = path.join(root, '.claude'), modern = path.join(root, '.askai');
    process.env.ASKAI_HOME = modern;
    write(path.join(home, 'askai', 'manifest.json'), '{}');
    write(path.join(modern, 'projects.json'), '{}');
    assert.equal(cfg.askaiDataDir(home, false), path.join(home, 'askai'));
    write(path.join(modern, 'manifest.json'), '{}');
    assert.equal(cfg.askaiDataDir(home, false), modern);
  } finally {
    if (prev === undefined) delete process.env.ASKAI_HOME; else process.env.ASKAI_HOME = prev;
    rm(root);
  }
});

test('updating modern AskAI refreshes the app reached through an old PATH shim', () => {
  const root = tmpHome();
  try {
    const home = path.join(root, '.claude'), legacy = path.join(home, 'askai', 'app');
    write(path.join(legacy, 'package.json'), '{"name":"askai","version":"0.0.0"}');
    write(path.join(legacy, 'askai.js'), 'console.log("stale help")');
    const ctx = { paths: { home, app: path.join(root, '.askai', 'app') }, log: { info() {}, plan() {} } };
    syncLegacyApp({ ...ctx, dry: true });
    assert.match(fs.readFileSync(path.join(legacy, 'askai.js'), 'utf8'), /stale help/);
    syncLegacyApp(ctx);
    const r = cp.spawnSync(process.execPath, [path.join(legacy, 'askai.js'), 'help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /help by category/);
    assert.doesNotMatch(r.stdout, /stale help/);
    const state = path.join(home, 'askai', 'todo-done.json');
    write(state, '{"done":["codex-trust"]}');
    syncLegacyApp(ctx);
    assert.equal(fs.readFileSync(state, 'utf8'), '{"done":["codex-trust"]}');
  } finally { rm(root); }
});

test('legacy compatibility sync skips sandboxes and unrelated applications', () => {
  const root = tmpHome();
  try {
    const home = path.join(root, '.claude'), legacy = path.join(home, 'askai', 'app');
    const ctx = { paths: { home, app: path.join(root, '.askai', 'app') }, log: { info() {}, plan() {} } };
    write(path.join(legacy, 'package.json'), '{"name":"another-app"}');
    write(path.join(legacy, 'askai.js'), 'custom');
    syncLegacyApp(ctx);
    assert.equal(fs.readFileSync(path.join(legacy, 'askai.js'), 'utf8'), 'custom');
    write(path.join(legacy, 'package.json'), '{"name":"askai"}');
    syncLegacyApp({ ...ctx, sandbox: true });
    assert.equal(fs.readFileSync(path.join(legacy, 'askai.js'), 'utf8'), 'custom');
  } finally { rm(root); }
});
