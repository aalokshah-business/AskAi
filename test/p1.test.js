'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, makeCtx, fs, path } = require('./helpers');
const check = require('../lib/check');
const findings = require('../lib/findings');
const status = require('../lib/status');
const audit = require('../lib/audit');

const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };
const KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY'];
test('check always names four hosts, including passing and unchecked hosts', () => withHome(home => {
  const ctx = makeCtx(home);
  ctx.manifest.target = 'all';
  const previous = findings.collectFindings;
  findings.collectFindings = () => [{host:'codex', group:'codex', severity:'ok', message:'config checked'}];
  try {
    const output = [];
    assert.equal(check.run(ctx, null, {}, line => output.push(line)), 0);
    const text = output.join('\n');
    assert.match(text, /Codex: 1 ok, 0 to improve, 0 failing/);
    for (const label of ['Claude Code', 'Antigravity', 'Cursor']) assert.ok(text.includes(`${label}: not checked`));
    assert.doesNotMatch(text, /config checked/);
    assert.match(text, /check --all/);
    ctx.manifest.target = 'cursor';
    const subset = [];
    check.run(ctx, null, {}, line => subset.push(line));
    assert.ok(subset.includes('  Claude Code: not selected for installation'));
  } finally { findings.collectFindings = previous; }
}));
test('callout is reverse-video on a colour terminal and ruled lines otherwise; the Claude desktop sandbox is recognised on Windows only', () => {
  const { callout, inClaudeDesktopSandbox: sandboxed } = require('../lib/platform');
  assert.match(callout(['RESTART'], {}, true), /^\x1b\[1;30;43m RESTART \x1b\[0m$/);
  assert.match(callout(['RESTART'], { NO_COLOR: '1' }, true), /^=+\n  RESTART\n=+$/);
  assert.match(callout(['RESTART', 'now'], {}, false), /^=+\n  RESTART\n  now\n=+$/);
  assert.strictEqual(sandboxed({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }, 'win32'), true);
  assert.strictEqual(sandboxed({ APPDATA: 'C:\\Users\\a\\AppData\\Local\\Packages\\Claude_pzs8\\LocalCache\\Roaming' }, 'win32'), true);
  assert.strictEqual(sandboxed({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }, 'linux'), false);
  assert.strictEqual(sandboxed({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32'), false);
});
test('ANTHROPIC_BASE_URL set to Anthropic\'s own endpoint is not reported as a proxy; any other host is', () => {
  const { customAnthropicBaseUrl: custom } = require('../lib/platform');
  assert.strictEqual(custom({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }), '');
  assert.strictEqual(custom({ ANTHROPIC_BASE_URL: 'https://API.Anthropic.com/' }), '');
  assert.strictEqual(custom({}), '');
  assert.strictEqual(custom({ ANTHROPIC_BASE_URL: 'https://proxy.corp:8080' }), 'https://proxy.corp:8080');
  assert.strictEqual(custom({ ANTHROPIC_BASE_URL: 'not a url' }), 'not a url');
});
test('check reports real findings for a host even when the recorded target does not include it', () => withHome(home => {
  // A tool can be genuinely configured on a machine (or inside the very host askai is running in) without
  // being part of this machine's recorded install target; live evidence must win over that stale target.
  const ctx = makeCtx(home);
  ctx.manifest.target = 'cursor';
  const previous = findings.collectFindings;
  findings.collectFindings = () => [{host:'claude', group:'claude', severity:'ok', message:'config checked'}];
  try {
    const output = [];
    check.run(ctx, null, {}, line => output.push(line));
    const text = output.join('\n');
    assert.match(text, /Claude Code: 1 ok, 0 to improve, 0 failing/);
    assert.doesNotMatch(text, /Claude Code: not selected for installation/);
  } finally { findings.collectFindings = previous; }
}));
function withoutBilling(fn) {
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('check collects findings once and renders that list', () => withoutBilling(() => withHome(home => {
  const ctx = makeCtx(home, { agyHome: path.join(home, 'gemini'), cursorHome: path.join(home, 'cursor') });
  ctx.which = name => name === 'claude' ? 'claude' : null;
  write(ctx.paths.settings, JSON.stringify({ model: 'opus', promptSuggestionEnabled: true }));
  write(ctx.agyPaths.cliSettings, JSON.stringify({ useG1Credits: true }));
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  const machine = check.machine;
  let calls = 0;
  check.machine = (...args) => { calls += 1; return machine(...args); };
  try {
    const first = findings.collectFindings(ctx, repo);
    const second = findings.collectFindings(ctx, repo);
    assert.strictEqual(first, second);
    assert.strictEqual(calls, 1);
    const empty = first.find(f => f.id === 'handoff.missing' || f.id === 'handoff.empty');
    assert.ok(empty, 'handoff finding present');
    assert.strictEqual(empty.area, 'repo');
    assert.strictEqual(empty.severity, 'later');
    const gap = first.find(f => f.id === 'repo.agents-missing');
    assert.ok(gap);
    assert.strictEqual(gap.autoFix, true);
    assert.strictEqual(gap.fix, 'askai scaffold');
    const model = first.find(f => f.id === 'model.default-expensive');
    assert.ok(model);
    assert.strictEqual(model.host, 'claude');
    assert.strictEqual(model.area, 'config');
    assert.strictEqual(model.severity, 'later');
    const credits = first.find(f => f.id === 'billing.g1-credits');
    assert.strictEqual(credits.severity, 'now');
    const lines = [];
    assert.strictEqual(check.run(ctx, repo, {}, m => lines.push(m)), 1);
    assert.strictEqual(calls, 1, 'check.run uses the collected list');
    const text = lines.join('\n');
    assert.match(text, /HANDOFF\.md is the empty template|no \.ai-work\/HANDOFF\.md/);
    assert.match(text, /1 failing/);
    assert.match(text, /\[antigravity\]/);
  } finally {
    check.machine = machine;
    findings.forget(ctx);
  }
})));

test('a fresh folder is scanned again after forget, and warns alone exit 0', () => withoutBilling(() => withHome(home => {
  const ctx = makeCtx(home);
  write(ctx.paths.settings, JSON.stringify({ model: 'claude-haiku-5-5', effortLevel: 'low', promptSuggestionEnabled: false, awaySummaryEnabled: false, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-5-5' } }));
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  const before = findings.collectFindings(ctx, repo);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Project\n');
  assert.strictEqual(findings.collectFindings(ctx, repo), before);
  findings.forget(ctx, repo);
  const after = findings.collectFindings(ctx, repo);
  assert.notStrictEqual(after, before);
  assert.ok(!after.some(f => f.id === 'repo.agents-missing'));
  const lines = [];
  assert.strictEqual(check.run(ctx, repo, { json: true }, m => lines.push(m)), 0);
  const parsed = JSON.parse(lines.join('\n'));
  assert.ok(parsed.every(f => f.id && f.severity && typeof f.autoFix === 'boolean'));
  assert.ok(!parsed.some(f => f.severity === 'now'));
})));

test('doctor renders the memoized findings view and rereads when settings change', () => withoutBilling(() => withHome(home => {
  const ctx = makeCtx(home);
  const orig = status.healthRows;
  let calls = 0;
  status.healthRows = (...args) => { calls += 1; return orig(...args); };
  try {
    const first = findings.view(ctx, 'doctor');
    const rendered = status.doctor(ctx);
    const again = findings.view(ctx, 'doctor');
    assert.strictEqual(first, again);
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(rendered.map(r => r.id), first.map(f => f.id));
    assert.deepStrictEqual(rendered.map(r => r.msg), first.map(f => f.message));
    assert.ok(rendered.some(r => r.id === 'settings' && r.level === 'ok'));
    write(ctx.paths.settings, '{ broken');
    const after = status.doctor(ctx);
    assert.strictEqual(calls, 2);
    assert.ok(after.some(r => r.id === 'settings' && r.level === 'fail'));
    assert.ok(!after.some(r => r.id === 'rtk'));
  } finally {
    status.healthRows = orig;
    findings.forget(ctx);
  }
})));

test('audit cost rows are the cost findings, collected once', () => withHome(home => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const ctx = makeCtx(home);
    write(ctx.paths.settings, JSON.stringify({ model: 'claude-haiku-5-5', effortLevel: 'low', promptSuggestionEnabled: false, awaySummaryEnabled: false, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }));
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    const machine = check.machine;
    let calls = 0;
    check.machine = (...args) => { calls += 1; return machine(...args); };
    try {
      const cost = findings.view(ctx, 'cost', repo);
      assert.strictEqual(findings.view(ctx, 'cost', repo), cost);
      const bill = cost.find(f => f.id === 'billing.anthropic-key');
      assert.ok(bill);
      assert.strictEqual(bill.area, 'cost');
      assert.ok(cost.every(f => f.area === 'cost'));
      const lines = [];
      audit.run(ctx, repo, {json:true}, m => lines.push(m));
      assert.strictEqual(calls, 1);
      assert.ok(JSON.parse(lines.join('')).some(r => r.finding === bill.message && r.severity === 'high'));
    } finally {
      check.machine = machine;
      findings.forget(ctx);
    }
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
}));
