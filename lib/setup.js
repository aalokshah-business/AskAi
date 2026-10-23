'use strict';
// askai setup: a short wizard. Hosts, check counts, file-validator result. Status, infra, plugins, and the to-do list stay on their own commands.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function marks() {
  const platform = require('./platform');
  if (!platform.supportsUnicode() || !process.stdout.isTTY) return { ok: 'ok', now: 'FIX', later: 'warn', na: 'n-a' };
  return { ok: platform.mark('ok'), now: platform.mark('bad'), later: '!', na: '–' };
}

function cli(ctx, bin) { return !!(ctx.which && ctx.which(bin)); }
function present(ctx) {
  const selected = host => require('./cursor').targetIncludes(ctx.manifest && ctx.manifest.target, host);
  return {
    'Claude Code': selected('claude') && (!!(ctx.claudeBin && ctx.claudeBin()) || cli(ctx, 'claude') || fs.existsSync(ctx.paths.settings)),
    Cursor: selected('cursor') && (cli(ctx, 'cursor') || cli(ctx, 'agent') || cli(ctx, 'cursor-agent') || !!(ctx.cursorPaths && fs.existsSync(ctx.cursorPaths.home))),
    Codex: selected('codex') && (cli(ctx, 'codex') || !!(ctx.codexPaths && fs.existsSync(ctx.codexPaths.home))),
    Antigravity: selected('agy') && (cli(ctx, 'agy') || !!(ctx.agyPaths && fs.existsSync(ctx.agyPaths.home))),
  };
}

function placeNotes() {
  const notes = [];
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) notes.push('devcontainer');
  if (process.env.TMUX) notes.push('tmux');
  return notes.length ? ` (${notes.join(', ')})` : '';
}

function defaultFiles(dir) {
  const validator = path.join(__dirname, '..', 'scripts', 'validate-install.js');
  if (!fs.existsSync(validator)) return { code: 0, lines: [] };
  const r = cp.spawnSync(process.execPath, [validator, dir, '--files'], { encoding: 'utf8', timeout: 180000 });
  const lines = String(r.stdout || r.stderr || '').split(/\r?\n/).map(s => s.trim()).filter(s => /\bFAIL\b/.test(s)).slice(0, 5);
  return { code: r.status || 0, lines };
}

function nodeLine(ctx) {
  const recorded = (ctx.manifest && ctx.manifest.profile) || 'lean';
  const experimental = recorded === 'max' || recorded === 'experimental';
  const tty = !!(process.stdin.isTTY && process.stdout.isTTY);
  const profile = experimental && !tty ? 'lean (recorded max waits for a terminal, or askai install --add ID)' : recorded;
  const nodeOk = require('./components').nodeOk(ctx.nodeVersion);
  const node = nodeOk ? `Node ${ctx.nodeVersion || ''} can run Context Mode` : `Node ${ctx.nodeVersion || '?'} < 22.5: Context Mode stays off unless you add it`;
  return `profile ${profile} · ${node} · optional tools install only with --add`;
}
function report(ctx, dir, opts = {}) {
  const m = marks();
  const hosts = present(ctx);
  const order = ['Cursor', 'Claude Code', 'Codex', 'Antigravity'];
  const detected = order.map(name => `${name} ${hosts[name] ? m.ok : m.na}`).join(' · ');
  const rows = require('./findings').collectFindings(ctx, dir);
  const n = sev => rows.filter(r => r.severity === sev).length;
  const files = (opts.files || defaultFiles)(dir);
  const lines = [
    `AskAI setup — ${dir}`,
    ` 1 Detect   ${detected}${placeNotes()}`,
    ` 2 Preflight  ${nodeLine(ctx)}`,
    ` 3 Check    ${m.ok} ${n('ok')} ok · ${m.now} ${n('now')} now · ${m.later} ${n('later')} later`,
  ];
  for (const row of rows.filter(r => r.severity === 'now').slice(0, 3)) lines.push(`    ${m.now} ${row.id}  ${row.message}`);
  lines.push(` 4 Files    ${files.code ? m.now : m.ok}`);
  for (const line of files.lines) lines.push(`    ${line}`);
  const failed = n('now') > 0 || !!files.code;
  lines.push('Wizard: askai setup --yes runs install, then init.');
  lines.push(`Next: ${n('now') ? 'askai check' : 'askai next'}`);
  return { text: lines.join('\n'), code: failed ? 1 : 0 };
}

module.exports = { report, present };
