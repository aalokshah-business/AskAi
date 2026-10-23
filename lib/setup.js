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

function present(ctx) {
  return {
    'Claude Code': !!(ctx.which && ctx.which('claude')) || !!(ctx.paths && fs.existsSync(ctx.paths.settings)),
    Cursor: !!(ctx.which && (ctx.which('cursor') || ctx.which('agent'))) || !!(ctx.cursorPaths && fs.existsSync(ctx.cursorPaths.home)),
    Codex: !!(ctx.which && ctx.which('codex')) || !!(ctx.codexPaths && fs.existsSync(ctx.codexPaths.home)),
    Antigravity: !!(ctx.which && ctx.which('agy')) || !!(ctx.agyPaths && fs.existsSync(ctx.agyPaths.home)),
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
  const nodeOk = require('./components').nodeOk(ctx.nodeVersion);
  return nodeOk ? 'Node can run Context Mode' : `will skip context-mode (Node ${ctx.nodeVersion || '?'} < 22.5)`;
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
