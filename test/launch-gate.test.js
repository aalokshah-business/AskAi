'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const registry = require('../lib/project-registry');
const { claudePaths } = require('../lib/claude-config');
const { launchTarget } = require('../askai');
const { ASKAI, tmpHome, rm, write } = require('./helpers');

// Run from the temp root so the repository's own .ai-work marker cannot select a project.
function cli(args, o) {
  const r = cp.spawnSync(process.execPath, [ASKAI, ...args], { encoding: 'utf8', input: '', cwd: o.cwd, env: { ...process.env, ...o.env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function fixture(fn) {
  const root = tmpHome();
  try { return fn(root, path.join(root, 'reg'), path.join(root, '.claude')); } finally { rm(root); }
}
const envOf = reg => ({ ASKAI_HOME: reg, ASKAI_PROJECT: '' });

test('gui and cli --launch open nothing when no project is selected', () => fixture((root, reg, claude) => {
  for (const args of [['gui'], ['desktop', 'open'], ['cli', '--launch']]) {
    const r = cli([...args, '--claude-home', claude], { env: envOf(reg), cwd: root });
    assert.strictEqual(r.code, 1, args.join(' '));
    assert.match(r.err, /No project selected[\s\S]*Nothing was opened/);
  }
}));

test('gui --dry reports the setup an unready project needs, then proceeds, without writing', () => fixture((root, reg, claude) => {
  const proj = path.join(root, 'shop');
  write(path.join(proj, 'package.json'), '{"name":"shop"}');
  registry.register(reg, 'shop', proj);
  const r = cli(['gui', '--project', 'shop', '--dry-run', '--claude-home', claude], { env: envOf(reg), cwd: root });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /would run: askai install --profile max --yes/);
  assert.match(r.out, /would run: askai init --path/);
  assert.match(r.out, /Open Ask AI desktop for/);
  assert.ok(!fs.existsSync(path.join(proj, '.ai-work')), 'dry run wrote nothing');
}));

test('launchTarget runs askai init for an uninitialized project before it opens', async () => {
  const root = tmpHome(); const reg = path.join(root, 'reg'); const claude = path.join(root, '.claude');
  const proj = path.join(root, 'shop');
  write(path.join(proj, 'package.json'), '{"name":"shop","scripts":{"test":"node t.js"}}');
  registry.register(reg, 'shop', proj);
  const prev = process.env.ASKAI_HOME; process.env.ASKAI_HOME = reg;
  const lines = []; const quiet = [console.log, console.error]; console.log = m => lines.push(m); console.error = m => lines.push(m);
  try {
    const found = await launchTarget({ project: 'shop', claudeHome: claude, offline: true, yes: true, _: ['gui'] });
    assert.ok(found, 'launch target returned: ' + lines.join(' | '));
    assert.strictEqual(found.name, 'shop');
    assert.ok(fs.existsSync(path.join(proj, '.ai-work', 'askai-init.json')), 'init ran');
  } finally {
    [console.log, console.error] = quiet;
    if (prev === undefined) delete process.env.ASKAI_HOME; else process.env.ASKAI_HOME = prev;
    rm(root);
  }
});

test('a ready project needs no setup', () => fixture((root, reg, claude) => {
  const proj = path.join(root, 'ready');
  write(path.join(proj, '.ai-work', 'askai-init.json'), '{}');
  registry.register(reg, 'ready', proj);
  write(claudePaths(claude, true).manifest, JSON.stringify({ profile: 'max' }));
  const ok = cli(['gui', '--project', 'ready', '--dry-run', '--claude-home', claude], { env: envOf(reg), cwd: root });
  assert.strictEqual(ok.code, 0, ok.err);
  assert.ok(!/would run/.test(ok.out));
  assert.match(ok.out, /Open Ask AI desktop for/);
}));

test('project show honours --repo', () => fixture((root, reg, claude) => {
  const proj = path.join(root, 'elsewhere');
  write(path.join(proj, 'package.json'), '{}');
  const r = cli(['project', 'show', '--repo', proj, '--claude-home', claude], { env: envOf(reg), cwd: root });
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(r.out.includes('elsewhere'));
}));
