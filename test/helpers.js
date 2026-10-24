'use strict';
// Shared test helpers. Every test runs against a throwaway claude home under the OS temp dir and fake process runners:
// nothing here installs software or touches the real ~/.claude.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { buildCtx } = require('../askai');

const ASKAI = path.join(__dirname, '..', 'askai.js');
const WIN = process.platform === 'win32';

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-test-'));
  if (!dir.startsWith(os.tmpdir())) throw new Error('refusing to use a non-temp dir');
  return fs.realpathSync.native(dir);
}
const rm = dir => fs.rmSync(dir, { recursive: true, force: true });
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

// A real ctx (real settings/manifest/backup handling against `home`) with fake process execution.
//   fakes.tools  { name: path }   what which() finds; mutable so an "install" can add to it
//   fakes.claude path|null        claudeBin()
//   fakes.probe(cmd,args,ctx)     read-only commands; default: fails
//   fakes.act(cmd,args,ctx)       mutating commands; default: succeeds
function makeCtx(home, opts = {}, fakes = {}) {
  const ctx = buildCtx({ claudeHome: home, yes: true, ...opts }, true);
  const tools = fakes.tools || {};
  const fail = { ok: false, status: 1, stdout: '', stderr: '', error: null };
  const good = { ok: true, status: 0, stdout: '', stderr: '', error: null };
  ctx.calls = [];
  ctx.nodeVersion = fakes.nodeVersion || ctx.nodeVersion;
  ctx.which = n => tools[n] || null;
  ctx.claudeBin = () => (fakes.claude === undefined ? '/fake/claude' : fakes.claude);
  ctx.refreshPath = () => {};
  ctx.probe = (cmd, args) => { ctx.calls.push(['probe', cmd, ...args].join(' ')); return fakes.probe ? fakes.probe(cmd, args, ctx) : fail; };
  ctx.act = (label, cmd, args) => {
    ctx.calls.push(['act', cmd, ...args].join(' '));
    if (ctx.dry) return good;
    return fakes.act ? fakes.act(cmd, args, ctx) : good;
  };
  ctx.hostSel = require('../lib/cursor').hosts(ctx);
  return ctx;
}

function cli(args, o = {}) {
  const env = { ...process.env, ...(o.env || {}) };
  if (!o.env || !('ANTHROPIC_API_KEY' in o.env)) delete env.ANTHROPIC_API_KEY;
  if (!o.env || !('ANTHROPIC_BASE_URL' in o.env)) delete env.ANTHROPIC_BASE_URL;
  if (!o.env || !('OPENAI_API_KEY' in o.env)) delete env.OPENAI_API_KEY;
  if (!o.env || !('CODEX_HOME' in o.env)) delete env.CODEX_HOME;
  const r = cp.spawnSync(process.execPath, [o.script || ASKAI, ...args], { encoding: 'utf8', env, input: '' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

module.exports = { ASKAI, WIN, tmpHome, rm, readJson, write, makeCtx, cli, fs, path };
