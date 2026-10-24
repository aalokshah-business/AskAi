'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const prepare = require('../lib/cli-prepare');
const review = require('../lib/project-review');
const registry = require('../lib/project-registry');
const { tmpHome, rm, cli } = require('./helpers');

function withHome(fn) {
  const root = tmpHome();
  const prev = process.env.ASKAI_HOME;
  process.env.ASKAI_HOME = path.join(root, 'reg');
  try { return fn(root); } finally {
    if (prev === undefined) delete process.env.ASKAI_HOME; else process.env.ASKAI_HOME = prev;
    rm(root);
  }
}

test('prepare selects the chat folder, one registered project, or asks', () => withHome(root => {
  const shop = path.join(root, 'shop');
  fs.mkdirSync(shop);
  fs.writeFileSync(path.join(shop, 'package.json'), '{"name":"shop"}\n');
  fs.mkdirSync(path.join(shop, 'lib'));
  const picked = prepare.select({}, path.join(shop, 'lib'));
  assert.strictEqual(picked.how, 'working-directory');
  assert.strictEqual(picked.path, fs.realpathSync(shop));

  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'go.mod'), 'module other\n');
  registry.register(process.env.ASKAI_HOME, 'other', other);
  registry.register(process.env.ASKAI_HOME, 'shop', shop);
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  const ask = prepare.select({}, empty);
  assert.strictEqual(ask.need, 'project');
  assert.strictEqual(ask.candidates.length, 2);

  const named = prepare.select({ path: shop }, empty);
  assert.strictEqual(named.how, 'named');
  assert.strictEqual(named.project, 'shop');
}));

test('prepare asks for a type it cannot detect and not for commands it found', () => {
  const q = prepare.questions({ about: 'A shop', type: 'other', commands: { test: 'npm test', build: 'npm run build' } });
  assert.deepStrictEqual(q.map(x => x.id), ['type']);
});

test('default prepare launches without analysis, initialization, or review-marker changes', () => withHome(root => {
  const proj = path.join(root, 'fast');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"fast"}');
  const args = ['cli', '--prepare', '--json', '--path', proj];
  const env = { ASKAI_HOME: process.env.ASKAI_HOME };
  const fresh = cli(args, { env });
  assert.strictEqual(fresh.code, 0, fresh.err);
  const body = JSON.parse(fresh.out);
  assert.strictEqual(body.action, 'launch');
  assert.strictEqual(body.setup, 'not-initialized');
  assert.strictEqual(body.review.skipped, true);
  assert.strictEqual(body.install.skipped, true);
  assert.deepStrictEqual(fs.readdirSync(proj), ['package.json']);
  assert.ok(!fs.existsSync(process.env.ASKAI_HOME), 'no registration or install writes');

  const work = path.join(proj, '.ai-work');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'askai-init.json'), '{}');
  const marker = path.join(work, 'ai-review.json');
  fs.writeFileSync(marker, 'intentionally unreadable review marker');
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), 'Keep this text.');
  const stale = cli([...args, '--refresh', '--yes'], { env });
  assert.strictEqual(stale.code, 0, stale.err);
  const next = JSON.parse(stale.out);
  assert.strictEqual(next.action, 'launch');
  assert.strictEqual(next.review.state, 'not-checked');
  assert.strictEqual(next.init, 'skipped');
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'intentionally unreadable review marker');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), 'Keep this text.');
  assert.ok(!fs.existsSync(path.join(proj, 'docs')));
}));

test('explicit --review initializes a named folder offline and launches only after review done', () => withHome(root => {
  const proj = path.join(root, 'shop');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'shop', description: 'A shop', scripts: { test: 'node --test', build: 'node build.js' } }));
  fs.writeFileSync(path.join(proj, 'index.js'), 'console.log(1)\n');
  const env = { ASKAI_HOME: process.env.ASKAI_HOME, ASKAI_CLI_INSTALL: '0' };
  const args = ['cli', '--prepare', '--review', '--json', '--offline', '--about', 'A shop for members', '--path', proj];
  const first = cli(args, { env });
  assert.strictEqual(first.code, 0, first.err + first.out);
  const body = JSON.parse(first.out);
  assert.strictEqual(body.action, 'review');
  assert.strictEqual(body.init, 'ran');
  assert.strictEqual(body.project, 'shop');
  assert.ok(fs.existsSync(path.join(proj, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(proj, 'docs', 'ai', 'SOURCE_INDEX.md')));
  const again = cli(args, { env });
  assert.strictEqual(JSON.parse(again.out).init, 'ran');
  assert.strictEqual(cli(['review', 'done', '--path', proj, '--json'], { env }).code, 0);
  const third = cli(args, { env });
  assert.strictEqual(JSON.parse(third.out).action, 'launch');
  fs.rmSync(path.join(proj, 'docs', 'ai', 'SOURCE_INDEX.md'));
  const missing = cli(args, { env });
  const repair = JSON.parse(missing.out);
  assert.strictEqual(repair.action, 'review');
  assert.strictEqual(repair.init, 'ran');
  assert.deepStrictEqual(repair.review.missing, ['docs/ai/SOURCE_INDEX.md']);
  assert.ok(fs.existsSync(path.join(proj, 'docs', 'ai', 'SOURCE_INDEX.md')));
  fs.rmSync(path.join(proj, '.claude', 'agents', 'builder.md'));
  const missingAgent = JSON.parse(cli(args, { env }).out);
  assert.deepStrictEqual(missingAgent.review.missing, ['.claude/agents/builder.md']);
  assert.ok(fs.existsSync(path.join(proj, '.claude', 'agents', 'builder.md')));
  fs.writeFileSync(path.join(proj, 'index.js'), 'console.log(2)\n');
  const changed = JSON.parse(cli(args, { env }).out);
  assert.deepStrictEqual(changed.review.changed, ['index.js']);
}));

test('review becomes stale when README or manifest changes and exposes every path on request', () => withHome(root => {
  const proj = path.join(root, 'shop');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"shop"}\n');
  fs.writeFileSync(path.join(proj, 'README.md'), '# Shop\n');
  review.done(proj);
  fs.writeFileSync(path.join(proj, 'README.md'), '# Updated shop\n');
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"shop","scripts":{"test":"node --test"}}\n');
  assert.deepStrictEqual(review.status(proj).changed, ['README.md', 'package.json']);
  for (let i = 0; i < 45; i++) fs.writeFileSync(path.join(proj, `file-${i}.js`), 'export const value = 1;\n');
  const brief = review.status(proj);
  assert.strictEqual(brief.changedCount, 47);
  assert.strictEqual(brief.changed.length, 40);
  assert.strictEqual(brief.pathsTruncated, true);
  const full = cli(['review', 'status', '--path', proj, '--all', '--json'], { env: { ASKAI_HOME: process.env.ASKAI_HOME } });
  assert.strictEqual(full.code, 0, full.err + full.out);
  assert.strictEqual(JSON.parse(full.out).changed.length, 47);
  fs.rmSync(path.join(proj, 'README.md'));
  assert.deepStrictEqual(review.status(proj).removed, ['README.md']);
}));

test('cli --prepare requires a description before a review', () => withHome(root => {
  const proj = path.join(root, 'shop');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'shop', description: 'A shop' }));
  const env = { ASKAI_HOME: process.env.ASKAI_HOME, ASKAI_CLI_INSTALL: '0' };
  const blocked = cli(['cli', '--prepare', '--review', '--json', '--offline', '--path', proj], { env });
  assert.strictEqual(blocked.code, 2);
  const body = JSON.parse(blocked.out);
  assert.strictEqual(body.need, 'about');
  assert.strictEqual(body.default, 'A shop');
  assert.ok(!fs.existsSync(path.join(proj, 'AGENTS.md')));
  const bypass = cli(['cli', '--prepare', '--review', '--json', '--offline', '--yes', '--path', proj], { env });
  assert.strictEqual(bypass.code, 2, '--yes must not skip the project description');
  assert.strictEqual(JSON.parse(bypass.out).need, 'about');
  const ok = cli(['cli', '--prepare', '--review', '--json', '--offline', '--path', proj, '--about', 'A shop for members'], { env });
  assert.strictEqual(ok.code, 0, ok.err + ok.out);
  assert.match(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), /A shop for members/);
}));

test('askai help lists command names in alphabetical order', () => {
  const names = cli(['help', '--list']).out.trim().split(/\r?\n/).filter(Boolean);
  assert.deepStrictEqual(names, [...names].sort());
  assert.ok(names.includes('init') && names.includes('update'));
  assert.match(cli(['help']).out, /help by category/);
  assert.match(cli(['help', 'init']).out, /Usage: askai init/);
});
