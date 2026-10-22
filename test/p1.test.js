'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, makeCtx, fs, path } = require('./helpers');
const check = require('../lib/check');
const findings = require('../lib/findings');

const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };
const KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY'];
function withoutBilling(fn) {
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('check collects findings once and renders that list', () => withoutBilling(() => withHome(home => {
  const ctx = makeCtx(home, { agyHome: path.join(home, 'gemini'), cursorHome: path.join(home, 'cursor') });
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
