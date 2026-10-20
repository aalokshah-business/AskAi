'use strict';
// askai savings [days] [--repo DIR]: the reports each installed plugin gives about itself, run for you, plus where to look for
// the ones that only report inside the agent. Tool-reported numbers are their own estimates: compare with askai usage <days>.
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
function run(ctx, bin, args, lines = 20) {
  const exe = ctx.which(bin); if (!exe) return null;
  const r = cp.spawnSync(exe, args, { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe) });
  const text = String(r.stdout || r.stderr || '').trim().split('\n').slice(0, lines).join('\n');
  return { ok: r.status === 0, text: text || `(no output, exit ${r.status})` };
}
function report(ctx, days = 7, dir = process.cwd()) {
  const out = [`Savings each tool reports about itself (their own estimates). Compare with: askai usage ${days} and askai audit`];
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const sec = (title, res, missing) => { out.push('', `[${title}]`); out.push(res ? res.text.split('\n').map(l => `  ${l}`).join('\n') : `  ${missing}`); };
  sec('RTK: rtk gain', run(ctx, 'rtk', ['gain']), 'not installed (askai install --rtk)');
  sec(`ccusage: ccusage daily --since ${since}`, run(ctx, 'ccusage', ['daily', '--since', since], 25), 'not installed (askai install --ccusage)');
  sec('Headroom: headroom stats', run(ctx, 'headroom', ['stats']), 'not installed (askai install --headroom); inside a session the agent can call headroom_stats');
  sec('codebase-memory-mcp: indexed projects', run(ctx, 'codebase-memory-mcp', ['cli', 'list_projects', '{}']), 'not installed (askai install --codebase-memory)');
  const g = path.join(dir, 'graphify-out', 'GRAPH_REPORT.md');
  out.push('', '[Graphify: this repository]', fs.existsSync(g) ? `  graph built (${Math.round(fs.statSync(g).size / 1024)} KB report): graphify query "<question>"` : ctx.which('graphify') ? '  not built yet: open the agent here and run /graphify .' : '  not installed (askai install --graphify)');
  out.push('', '[Only inside the agent]', '  Context Mode: /context-mode:ctx-stats   Caveman plugin: /caveman-stats   Headroom: headroom_stats', '  Claude Code: /usage and /context   Codex: /status   Antigravity: /usage   Cursor: Dashboard, Usage');
  return out.join('\n');
}
module.exports = { report };
