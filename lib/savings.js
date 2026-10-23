'use strict';
// askai savings [days] [--repo DIR]: the reports each installed plugin gives about itself, run for you, plus where to look for
// the ones that only report inside the agent. Tool-reported numbers are their own estimates: compare with askai usage <days>.
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
function logFailure(dir, line) {
  try {
    const log = path.join(dir, '.ai-work', 'askai.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, line.endsWith('\n') ? line : line + '\n');
  } catch (_) { /* the one-line report still stands */ }
}
function run(ctx, bin, args, dir, lines = 20) {
  const exe = ctx.which(bin); if (!exe) return null;
  const win = process.platform === 'win32';
  let r = cp.spawnSync(exe, args, { encoding: 'utf8', timeout: 30000, shell: win && /\.(cmd|bat)$/i.test(exe) });
  if (win && r.error && r.error.code === 'ENOENT') r = cp.spawnSync('sh', [exe, ...args], { encoding: 'utf8', timeout: 30000 });
  const raw = `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`;
  if (r.error || r.status !== 0) {
    logFailure(dir, `${new Date().toISOString()} ${bin} ${args.join(' ')} exit ${r.status}\n${raw}`);
    return { fail: true, bin };
  }
  const text = raw.trim().split('\n').slice(0, lines).join('\n');
  return { ok: true, text: text || `(no output, exit ${r.status})` };
}
function report(ctx, days = 7, dir = process.cwd()) {
  const out = [`Savings each tool reports about itself (their own estimates). Compare with: askai usage ${days} and askai audit`];
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const sec = (title, res, missing) => {
    out.push('', `[${title}]`);
    if (!res) out.push(`  ${missing}`);
    else if (res.fail) out.push(`  ${res.bin}: report unavailable (see .ai-work/askai.log)`);
    else out.push(res.text.split('\n').map(l => `  ${l}`).join('\n'));
  };
  sec('RTK: rtk gain', run(ctx, 'rtk', ['gain'], dir), 'not installed (askai install --rtk)');
  sec(`ccusage: ccusage daily --since ${since}`, run(ctx, 'ccusage', ['daily', '--since', since], dir, 25), 'not installed (askai install --ccusage)');
  sec('Headroom: headroom perf', run(ctx, 'headroom', ['perf'], dir), 'not installed (askai install --headroom); inside a session the agent can call headroom_stats');
  sec('codebase-memory-mcp: indexed projects', run(ctx, 'codebase-memory-mcp', ['cli', 'list_projects', '{}'], dir), 'not installed (askai install --codebase-memory)');
  const g = path.join(dir, 'graphify-out', 'GRAPH_REPORT.md');
  out.push('', '[Graphify: this repository]', fs.existsSync(g) ? `  graph built (${Math.round(fs.statSync(g).size / 1024)} KB report): graphify query "<question>"` : ctx.which('graphify') ? '  not built yet: open the agent here and run /graphify .' : '  not installed (askai install --graphify)');
  out.push('', '[Only inside the agent]', '  Context Mode: /context-mode:ctx-stats   Caveman plugin: /caveman-stats   Headroom: headroom_stats', '  Claude Code: /usage and /context   Codex: /status   Antigravity: /usage   Cursor: Dashboard, Usage');
  return out.join('\n');
}
function firstLine(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
}
function pluginLines(ctx, dir = process.cwd()) {
  const rows = [];
  const add = (name, args) => {
    const res = run(ctx, name, args, dir, 5);
    if (!res) return;
    rows.push(res.fail ? `${name}: report unavailable` : `${name}: ${firstLine(res.text) || 'no output'}`);
  };
  add('rtk', ['gain']);
  add('ccusage', ['daily']);
  add('headroom', ['perf']);
  add('codebase-memory-mcp', ['cli', 'list_projects', '{}']);
  if (ctx.which('graphify')) {
    const g = path.join(dir, 'graphify-out', 'GRAPH_REPORT.md');
    rows.push(fs.existsSync(g) ? `graphify: graph built (${Math.round(fs.statSync(g).size / 1024)} KB)` : 'graphify: not built yet');
  }
  return rows.length ? rows.join('\n') : 'No plugin savings reports installed.';
}
module.exports = { report, pluginLines };
