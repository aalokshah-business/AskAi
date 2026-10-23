'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { parseArgs } = require('../askai');
const surface = require('../lib/surface');
const session = require('../lib/session');
const daily = require('../lib/daily');
const plugins = require('../lib/plugins');
const help = require('../lib/help');

const ASKAI = path.join(__dirname, '..', 'askai.js');
const run = (args, extra = {}) => cp.spawnSync(process.execPath, [ASKAI, ...args], { encoding: 'utf8', timeout: 20000, ...extra });

test('run -- ends options and the child exit code is kept', () => {
  const o = parseArgs(['run', '--', 'node', '-e', 'process.exit(3)']);
  assert.deepStrictEqual(o._, ['run', 'node', '-e', 'process.exit(3)']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-run-'));
  const r = run(['run', '--', 'node', '-e', 'process.exit(3)'], { cwd: dir });
  assert.strictEqual(r.status, 3);
  assert.match(r.stdout, /exit 3/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hosts and help stay inside the flag budget', () => {
  const home = surface.home('0');
  assert.doesNotMatch(home, /--[a-z]/);
  assert.match(home, /next/);
  assert.match(home, /install/);
  for (const [name] of surface.TIER1) {
    const text = help.render(name, { advanced: false });
    const flags = text.match(/--[A-Za-z0-9][\w-]*/g) || [];
    assert.ok(flags.length <= 4, `${name} shows ${flags.join(' ')}`);
  }
});

test('handoff sentence completes the note and clear is safe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-ho-'));
  cp.spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  daily.writeHandoff(dir, {});
  const draft = session.handoffState(dir);
  assert.strictEqual(draft.state, 'draft');
  assert.strictEqual(require('../lib/guide').clearGate(dir).fresh, false);
  daily.writeHandoff(dir, { sentence: 'ship the parser' });
  const done = session.handoffState(dir);
  assert.strictEqual(done.state, 'complete');
  assert.strictEqual(done.hasNext, true);
  assert.strictEqual(require('../lib/guide').clearGate(dir).fresh, true);
  const lines = [];
  session.run('break', { repo: dir }, l => lines.push(l));
  const text = lines.join('\n');
  assert.match(text, /snapshot/);
  assert.match(text, /handoff/);
  assert.ok(text.split(/\n/).length <= 8);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session init writes exclude and does not create .gitignore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-ex-'));
  cp.spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  session.run('init', { repo: dir }, () => {});
  assert.match(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8'), /\.ai-work/);
  assert.ok(!fs.existsSync(path.join(dir, '.gitignore')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plugin verdicts follow the evidence and RTK is not add', () => {
  const rtk = plugins.P.find(p => p.id === 'rtk');
  assert.notStrictEqual(plugins.judge(rtk, false).rec, 'add');
  assert.strictEqual(plugins.judge(rtk, false).verdict, 'costs more');
  const caveman = plugins.P.find(p => p.id === 'caveman');
  assert.strictEqual(plugins.judge(caveman, false).verdict, 'helps');
});

test('cheat sheet is the working loop and matches the registry', () => {
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CHEAT_SHEET.md'), 'utf8');
  for (const phase of ['Once per machine', 'Once per project', 'Each task', 'Taking a break', 'Weekly']) assert.match(sheet, new RegExp(phase));
  assert.strictEqual(sheet.replace(/\r\n/g, '\n'), surface.markdown());
  const listed = [...sheet.matchAll(/^\| `askai ([a-z]+)` \|/gm)].map(m => m[1]);
  assert.deepStrictEqual(listed.slice().sort(), help.names().slice().sort(), 'every help command appears once in the command index');
  assert.doesNotMatch(sheet, /ask the agent to write HANDOFF\.md/);
  assert.strictEqual(surface.markdown().includes('Once per machine'), true);
  const cheat = run(['cheat']);
  assert.strictEqual(cheat.status, 0);
  assert.ok(cheat.stdout.split(/\n/).length <= 40);
});

test('a prompt inside askai cli consumes one input line', () => {
  const r = run(['cli'], { input: 'setup\nYY\nexit\n' });
  assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /Unknown command "?Y"?/);
});
