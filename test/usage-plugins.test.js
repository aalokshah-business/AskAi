'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeCtx, tmpHome, rm, write, cli, fs, path } = require('./helpers');
const savings = require('../lib/savings');

function withHome(fn) {
  const home = tmpHome();
  try { return fn(home); } finally { rm(home); }
}
const binName = n => n + (process.platform === 'win32' ? '.cmd' : '');
function script(line, fail) {
  if (process.platform === 'win32') return fail ? `@echo Usage: rtk gain [options]>&2\r\n@exit /b 1\r\n` : `@echo ${line}\r\n@echo Usage: rtk gain\r\n`;
  return fail ? `#!/bin/sh\necho "Usage: rtk gain [options]" >&2\nexit 1\n` : `#!/bin/sh\necho "${line}"\necho "Usage: rtk gain"\n`;
}
function isolated(home) {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const PATH = process.platform === 'win32' ? [path.join(sys, 'System32'), home].join(';') : home;
  return { PATH, USERPROFILE: home, HOME: home, LOCALAPPDATA: home, PATHEXT: '.CMD;.EXE;.BAT;.COM' };
}

test('usage --plugins with nothing installed is one line', () => withHome(h => {
  const text = savings.pluginLines(makeCtx(h), h);
  assert.strictEqual(text, 'No plugin savings reports installed.');
  assert.ok(!/Usage:|not installed|TOKEN SAVINGS/.test(text));
}));

test('usage --plugins prints one savings line and omits a missing plugin', () => withHome(h => {
  const bin = path.join(h, binName('rtk'));
  write(bin, script('Tokens saved: 1234 over 9 commands'));
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  write(path.join(h, 'graphify-out', 'GRAPH_REPORT.md'), '# g');
  const text = savings.pluginLines(makeCtx(h, {}, { tools: { rtk: bin } }), h);
  assert.strictEqual(text, 'rtk: Tokens saved: 1234 over 9 commands');
  assert.ok(!/Usage:|ccusage|not installed|graph built/.test(text));
}));

test('a failing plugin does not print its usage text', () => withHome(h => {
  const bin = path.join(h, binName('rtk'));
  write(bin, script('', true));
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  const text = savings.pluginLines(makeCtx(h, {}, { tools: { rtk: bin } }), h);
  assert.strictEqual(text, 'rtk: report unavailable');
  assert.ok(!/Usage:/.test(text));
}));

test('askai savings is one line when no plugin is on PATH', () => withHome(h => {
  const r = cli(['savings', '--claude-home', h, '--repo', h], { env: isolated(h) });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /No plugin savings reports installed\./);
  assert.strictEqual(r.out.trim().split(/\r?\n/).length, 1);
  assert.ok(!/Usage:/.test(r.out));
}));
