'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, makeCtx, fs, path } = require('./helpers');
const setup = require('../lib/setup');

test('setup is a short wizard and does not reprint the other commands', () => {
  const home = tmpHome();
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const ctx = makeCtx(home, { agyHome: path.join(home, 'gemini'), cursorHome: path.join(home, 'cursor'), codexHome: path.join(home, 'codex') });
    write(ctx.paths.settings, JSON.stringify({ model: 'opus' }));
    write(ctx.agyPaths.cliSettings, JSON.stringify({ useG1Credits: true }));
    fs.mkdirSync(ctx.cursorPaths.home);
    fs.mkdirSync(ctx.codexPaths.home);
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    const result = setup.report(ctx, repo, { files: () => ({ code: 1, lines: ['FAIL  askai  AskAI is not installed on this machine'] }) });
    assert.ok(!/## Status|## Infra|## Plugins|## To do/.test(result.text));
    assert.match(result.text, /1 Detect\s+Cursor ok · Claude Code ok · Codex ok · Antigravity ok/);
    assert.match(result.text, /2 Check\s+ok \d+ ok · FIX \d+ now · warn \d+ later/);
    assert.match(result.text, /FIX billing\.g1-credits/);
    assert.match(result.text, /3 Files\s+FIX/);
    assert.match(result.text, /AskAI is not installed/);
    assert.match(result.text, /Next: askai check/);
    assert.ok(result.text.split(/\n/).length <= 40);
    assert.strictEqual(result.code, 1);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
    rm(home);
  }
});

test('setup with nothing to fix now points at the to-do list', () => {
  const home = tmpHome();
  const prev = process.env.NO_COLOR;
  const saved = {};
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY']) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.NO_COLOR = '1';
  try {
    const ctx = makeCtx(home);
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    const result = setup.report(ctx, repo, { files: () => ({ code: 0, lines: [] }) });
    assert.match(result.text, /Claude Code n-a · Codex n-a · Antigravity n-a/);
    assert.match(result.text, /3 Files\s+ok/);
    assert.match(result.text, /Next: askai todo/);
    assert.strictEqual(result.code, 0);
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rm(home);
  }
});
