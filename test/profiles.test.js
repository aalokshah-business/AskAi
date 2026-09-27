'use strict';
const test = require('node:test');
const assert = require('node:assert');
const profiles = require('../lib/profiles');
const comps = require('../lib/components');
const rules = require('../lib/rules');
const { select } = require('../askai');
const { tmpHome, rm, readJson, cli, fs } = require('./helpers');

const ids = (o, mode = 'install', rec, hosts) => select(o, mode, rec, hosts).map(c => c.id);

test('profiles: default is coding, unknown name throws and lists the valid ones', () => {
  assert.strictEqual(profiles.DEFAULT, 'coding');
  assert.strictEqual(profiles.get().name, 'coding');
  assert.strictEqual(profiles.get('docs').name, 'docs');
  assert.throws(() => profiles.get('nope'), /unknown profile "nope" \(known: minimal, coding, docs, full\)/);
  assert.throws(() => profiles.get('constructor'), /unknown profile/, 'prototype keys are not profiles');
});

test('profiles: every profile lists real components and rule kinds, and rules is in all of them', () => {
  const known = comps.ALL.map(c => c.id);
  for (const name of profiles.names()) {
    const p = profiles.get(name);
    assert.ok(p.summary.length > 10, `${name} has a summary`);
    for (const id of p.components) assert.ok(known.includes(id), `${name}: ${id} is a component`);
    for (const k of p.rules) assert.ok(rules.kinds().includes(k), `${name}: ${k} is a rule kind`);
    assert.ok(p.components.includes('rules'), `${name} carries the rules component so a narrower profile can remove wider rule files`);
    assert.ok(p.components.includes('rtk') && p.components.includes('caveman'), `${name} keeps the measured basics`);
  }
});

test('profiles: work kinds differ the way the README says', () => {
  assert.ok(!profiles.get('minimal').components.includes('serena') && !profiles.get('minimal').components.includes('context-mode'));
  assert.ok(profiles.get('coding').components.includes('serena') && !profiles.get('coding').components.includes('markitdown'));
  assert.ok(profiles.get('docs').components.includes('markitdown') && !profiles.get('docs').components.includes('serena'));
  const full = profiles.get('full').components;
  for (const id of ['serena', 'markitdown', 'ccusage', 'context-mode']) assert.ok(full.includes(id), `full has ${id}`);
  assert.deepStrictEqual(profiles.get('full').rules, ['coding', 'docs']);
  assert.deepStrictEqual(profiles.get('minimal').rules, []);
});

test('select: a profile picks its components for install, opt-in flags add to it, --skip removes', () => {
  assert.deepStrictEqual(ids({ profile: 'minimal' }), ['claude', 'baseline', 'rtk', 'caveman', 'rules', 'statusline']);
  assert.ok(ids({ profile: 'docs' }).includes('markitdown') && !ids({ profile: 'docs' }).includes('serena'));
  assert.ok(ids({}).includes('serena'), 'no profile means the default one (coding)');
  assert.ok(ids({ profile: 'minimal', markitdown: true, ccusage: true }).includes('markitdown'), 'flag adds markitdown');
  assert.ok(ids({ profile: 'minimal', ccusage: true }).includes('ccusage'));
  assert.ok(!ids({ profile: 'minimal', cavemanPlugin: false }).includes('caveman-plugin'));
  assert.ok(ids({ profile: 'minimal', cavemanPlugin: true }).includes('caveman-plugin'));
  assert.ok(!ids({ profile: 'full', skip: 'ccusage,markitdown' }).some(i => i === 'ccusage' || i === 'markitdown'));
  assert.ok(!ids({ profile: 'full', noStatusline: true }).includes('statusline'));
});

test('select: the recorded profile is used when none is asked for, and --profile wins over it', () => {
  assert.ok(!ids({}, 'install', 'minimal').includes('serena'));
  assert.ok(ids({ profile: 'coding' }, 'install', 'minimal').includes('serena'));
  assert.ok(ids({}, 'install', 'docs').includes('markitdown'));
  assert.throws(() => select({ profile: 'bogus' }, 'install'), /unknown profile "bogus"/);
});

test('select: --only replaces the profile and ignores --no-statusline; unknown ids throw', () => {
  assert.deepStrictEqual(ids({ only: 'serena,rtk' }), ['rtk', 'serena'], 'components keep their install order');
  assert.deepStrictEqual(ids({ only: 'statusline', noStatusline: true }), ['statusline']);
  assert.throws(() => select({ only: 'nope' }, 'install'), /unknown component "nope" \(known: /);
  assert.throws(() => select({ skip: 'nope' }, 'install'), /unknown component "nope"/);
});

test('select: update and uninstall take every component; uninstall is in reverse order', () => {
  const all = comps.ALL.map(c => c.id);
  assert.deepStrictEqual(ids({}, 'update'), all);
  assert.deepStrictEqual(ids({}, 'uninstall'), [...all].reverse());
  assert.deepStrictEqual(ids({ skip: 'serena' }, 'uninstall').includes('serena'), false);
});

test('select: Cursor twins follow the tool they mirror and only when Cursor is a target', () => {
  const claudeOnly = { claude: true, cursor: false };
  const both = { claude: true, cursor: true };
  const cursorOnly = { claude: false, cursor: true };
  assert.ok(!ids({ profile: 'coding' }, 'install', undefined, claudeOnly).some(i => i.startsWith('cursor-')));
  const b = ids({ profile: 'coding' }, 'install', undefined, both);
  for (const i of ['cursor-rtk', 'cursor-context-mode', 'cursor-serena', 'serena', 'rtk']) assert.ok(b.includes(i), `both: ${i}`);
  const m = ids({ profile: 'minimal' }, 'install', undefined, both);
  assert.ok(m.includes('cursor-rtk') && !m.includes('cursor-serena') && !m.includes('cursor-context-mode'), 'minimal mirrors only rtk');
  const c = ids({ profile: 'coding' }, 'install', undefined, cursorOnly);
  assert.deepStrictEqual(c.filter(i => !i.startsWith('cursor-')), [], 'Claude-only components are left out when the target is cursor');
  assert.ok(c.includes('cursor-serena'));
  const d = ids({ profile: 'docs', markitdown: true }, 'install', undefined, cursorOnly);
  assert.ok(d.includes('markitdown'), 'markitdown is host-neutral (uv tool) and installs for a Cursor-only target too');
});

test('profiles command: lists every profile, marks the one in use and where it came from', () => {
  const home = tmpHome();
  try {
    const r = cli(['profiles', '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err);
    for (const n of profiles.names()) assert.match(r.out, new RegExp(n));
    assert.match(r.out, /default/i);
    const j = JSON.parse(cli(['profiles', '--json', '--claude-home', home, '--profile', 'docs']).out);
    assert.strictEqual(j.current, 'docs');
    assert.match(j.source, /--profile/);
    assert.ok(Array.isArray(j.profiles) ? j.profiles.length === 4 : Object.keys(j.profiles).length === 4);
  } finally { rm(home); }
});

test('profiles command: rejects an unknown profile with exit 1 and touches nothing', () => {
  const home = tmpHome();
  try {
    const r = cli(['profiles', '--claude-home', home, '--profile', 'nope']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err + r.out, /unknown profile "nope"/);
    assert.deepStrictEqual(fs.readdirSync(home), []);
  } finally { rm(home); }
});

// --skip claude,rtk keeps the run to file edits inside the temp home: nothing is installed and no external tool is called.
const SAFE_PROFILE = ['install', '--profile', 'minimal', '--skip', 'claude,rtk', '--no-path', '--yes'];

test('install --profile records the profile in the manifest; dry-run and --only do not', () => {
  const home = tmpHome();
  try {
    const dry = cli([...SAFE_PROFILE, '--dry-run', '--claude-home', home]);
    assert.strictEqual(dry.code, 0, dry.err + dry.out);
    assert.ok(!fs.existsSync(`${home}/askai/manifest.json`), 'dry-run wrote no manifest');

    const only = cli(['install', '--only', 'baseline', '--profile', 'minimal', '--no-path', '--yes', '--claude-home', home]);
    assert.strictEqual(only.code, 0, only.err + only.out);
    assert.strictEqual(readJson(`${home}/askai/manifest.json`).profile, undefined, '--only is a partial run and records no profile');

    const r = cli([...SAFE_PROFILE, '--claude-home', home]);
    assert.strictEqual(r.code, 0, r.err + r.out);
    assert.strictEqual(readJson(`${home}/askai/manifest.json`).profile, 'minimal');
    assert.ok(!fs.existsSync(`${home}/rules`), 'minimal profile writes no rule files');
  } finally { rm(home); }
});
