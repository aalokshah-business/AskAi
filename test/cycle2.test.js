'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cache = require('../lib/cache-policy');
const check = require('../lib/check');
const daily = require('../lib/daily');
const plugins = require('../lib/plugins');
const status = require('../lib/status');
const { cli, tmpHome, rm, write, makeCtx, fs, path } = require('./helpers');

test('claude resume quotes the documented cache rules and the model-switch penalty', () => {
  const text = cache.advice(95, 'claude', { cache: { expiresAt: '2026-10-23T12:00:00Z', recacheTokensIfCold: 38000 } });
  assert.match(text, /expires_at 2026-10-23T12:00:00Z/);
  assert.match(text, /recache_tokens_if_cold 38000/);
  assert.match(text, /documented as 5 min/);
  assert.match(text, /Switching model forces a full re-read/);
  assert.match(text, /promptCacheTtl/);
  assert.match(text, /start a fresh chat/);
});

test('a non-claude resume makes no cache claim', () => {
  const text = cache.advice(95, 'cursor', {});
  assert.match(text, /Away 1 h 35 min: start a fresh chat/);
  assert.ok(!/promptCacheTtl|documented as 5 min|prompt cache/.test(text));
});

test('status hides token-kit, handoff and prompt-hooks on a fresh install', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home);
    const text = status.renderStatus(ctx).lines.join('\n');
    assert.ok(!/^token-kit /m.test(text));
    assert.ok(!/^handoff /m.test(text));
    assert.ok(!/^prompt-hooks /m.test(text));
  } finally { rm(home); }
});

test('a missing Claude Code install is one hint and not a question', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home, {}, { tools: {} });
    ctx.which = () => null;
    const rows = check.machine(ctx);
    const hit = rows.filter(r => /Claude Code not installed/.test(r.msg));
    assert.strictEqual(hit.length, 1);
    assert.strictEqual(hit[0].msg, 'Claude Code not installed: askai install --target claude --seed-only');
  } finally { rm(home); }
});

test('plugins info serena states the C/C++ compile_commands rules', () => {
  const lines = [];
  assert.strictEqual(plugins.info('serena', l => lines.push(l)), 0);
  const text = lines.join('\n');
  assert.match(text, /compile_commands\.json at the repo root/);
  assert.match(text, /Serena downloads and manages clangd/);
  assert.match(text, /\.serena\/compile_commands\.json/);
});

test('convert scan --ignore-originals writes .cursorignore and a plain scan does not', () => {
  const home = tmpHome();
  write(path.join(home, 'spec.docx'), 'x');
  try {
    daily.scanOffice(home, {});
    assert.ok(!fs.existsSync(path.join(home, '.cursorignore')));
    const text = daily.scanOffice(home, { ignoreOriginals: true });
    assert.match(text, /cursorignore: 1/);
    assert.match(fs.readFileSync(path.join(home, '.cursorignore'), 'utf8'), /spec\.docx/);
  } finally { rm(home); }
});

test('bootstrap prints the optional askai home mount', () => {
  const home = tmpHome();
  try {
    assert.match(daily.bootstrap(home, 'lean'), /target": "\/root\/.claude\/askai"/);
  } finally { rm(home); }
});

test('model and effort findings carry an estimate and evidence', () => {
  const home = tmpHome();
  try {
    write(path.join(home, 'settings.json'), JSON.stringify({ model: 'claude-opus-5-5', effortLevel: 'max' }));
    const ctx = makeCtx(home);
    ctx.paths.settings = path.join(home, 'settings.json');
    const rows = require('../lib/findings').collectFindings(ctx);
    const model = rows.find(r => r.id === 'model.default-expensive');
    const effort = rows.find(r => r.id === 'effort.max');
    assert.ok(model && model.estTokens === 'estimate' && /Opus/.test(model.evidence));
    assert.ok(effort && effort.estTokens === 'estimate' && /effort max/.test(effort.evidence));
    const text = require('../lib/findings').why(rows, 'model.default-expensive');
    assert.match(text, /most expensive/);
  } finally { rm(home); }
});

test('guide with no topic is one moment and at most 8 lines', () => {
  const r = cli(['guide']);
  const n = r.out.split(/\n/).filter(l => l.length).length;
  assert.strictEqual(r.code, 0);
  assert.ok(n <= 8, `guide is ${n} lines`);
  assert.match(r.out, /^(start|work|resume)\n/);
});

test('usage --import-cursor sums tokens and rejects an unknown layout', () => {
  const home = tmpHome();
  try {
    const csv = path.join(home, 'usage.csv');
    write(csv, 'Date,Model,Input Tokens,Output Tokens,Cost\n2026-10-01,grok,100,20,0\n');
    const ok = cli(['usage', '--import-cursor', csv]);
    assert.strictEqual(ok.code, 0, ok.err);
    assert.match(ok.out, /input 100, output 20/);
    assert.match(ok.out, /0 USD/);
    const bad = path.join(home, 'bad.csv');
    write(bad, 'Name,City\nA,B\n');
    const fail = cli(['usage', '--import-cursor', bad]);
    assert.strictEqual(fail.code, 1);
    assert.match(fail.err, /Unrecognized Cursor usage CSV/);
  } finally { rm(home); }
});

test('go names the model-switch penalty for Claude Code', () => {
  const home = tmpHome();
  try {
    const lines = [];
    const ctx = makeCtx(home);
    require('../lib/launch').run(ctx, 'claude', { dry: true, ask: 'rename the helper' }, line => lines.push(line));
    assert.match(lines[0], /Switching model forces a full re-read with no cache hits/);
  } finally { rm(home); }
});

test('the default help banner stays within 30 lines', () => {
  const home = tmpHome();
  try {
    const r = cli([]);
    const n = r.out.split(/\n/).filter(l => l.length).length;
    assert.ok(n <= 30, `help is ${n} lines`);
  } finally { rm(home); }
});
