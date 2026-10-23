'use strict';
// askai go <tool> [--tier lead|build|chore] ["task"]: start a session the cache-friendly way. AskAI picks the tier's model and effort
// once, shows the active MCP servers and peak hours, turns the task into a structured prompt, records the ledger entry, then hands
// the terminal to the agent. Inside the session AskAI works through the rules, subagents, slash commands and reminder hooks it
// installed; it does not sit between you and a running agent.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const models = require('./models');
const prompt = require('./prompt');
const tips = require('./tips');
const mcp = require('./mcp');
const session = require('./session');

const ALIAS = { claude: 'claude', cc: 'claude', codex: 'codex', cursor: 'cursor', agy: 'agy', antigravity: 'agy' };
function plan(ctx, toolArg, o = {}) {
  let ask = (o.ask || '').trim();
  let tool = ALIAS[String(toolArg || '').toLowerCase()];
  if (!tool && (ask || /\s/.test(String(toolArg || '')))) {
    ask = [String(toolArg || '').trim(), ask].filter(Boolean).join(' ');
    tool = 'claude';
  }
  if (!tool) throw new Error('which tool? askai go claude | codex | cursor | agy [--tier lead|build|chore] "task"');
  const tier = o.tier || (ask ? models.guessTier(ask) : 'build');
  if (!models.TIERS.includes(tier)) throw new Error('tier must be lead, build or chore');
  const p = models.pick(models.load(ctx), tool, tier);
  if (tool === 'claude' && models.failureCount(o.repo || process.cwd()) >= 2 && (tier === 'lead' || tier === 'build')) p.model = 'claude-opus-5-5';
  const text = ask ? prompt.task({ ask, tier, tool, files: o.files, done: o.done, mode: o.mode, resume: o.resume }).text : (o.resume ? prompt.resume(o.repo || process.cwd()) : '');
  const out = { tool, tier, agent: p.agent, model: p.model, effort: p.effort, cmd: tool, args: [], env: {}, notes: [], text };
  if (tool === 'claude') { out.args = ['--model', p.model]; out.env.CLAUDE_CODE_EFFORT_LEVEL = p.effort; }
  if (tool === 'codex') out.args = ['-m', p.model, '-c', `model_reasoning_effort="${p.effort}"`];
  if (tool === 'cursor') { out.cmd = ctx.which && ctx.which('cursor-agent') && !ctx.which('agent') ? 'cursor-agent' : 'agent'; out.args = ['--model', p.model]; out.notes.push(`Cursor puts effort in the model ID: for ${p.effort}, pick the matching variant from \`agent models\` and save it with askai models set cursor.${tier} <id>`); }
  if (tool === 'agy') { out.cmd = 'agy'; out.notes.push(`First, inside Antigravity: /model (choose ${p.model === 'flash' ? 'Gemini Flash' : p.model}) and /effort ${p.effort}`); }
  // Multi-line prompts as an argument are unsafe through the Windows shell, and Antigravity's flags are not documented: paste instead.
  if (text) { if (tool === 'agy' || process.platform === 'win32') out.notes.push('Paste this as your first message:\n' + text); else out.args.push(text); }
  return out;
}
function run(ctx, toolArg, o, print = console.log) {
  const pl = plan(ctx, toolArg, o);
  const lines = [`askai go ${pl.tool}: ${pl.tier} tier -> ${pl.model}, effort ${pl.effort}, kept for the whole session${pl.tool === 'claude' ? '. Switching model forces a full re-read with no cache hits.' : ''}`];
  if (pl.tool === 'claude' && tips.isPeak()) lines.push('  note: Claude peak hours now; big jobs drain the window faster');
  try { const on = mcp.list(ctx).filter(r => r.tool === pl.tool && r.state === 'on').map(r => r.name); lines.push(`  MCP on: ${on.join(', ') || 'none'} (change it before you start: askai mcp)`); } catch (_) { /* unreadable config */ }
  const repo = o.repo || process.cwd();
  if (!fs.existsSync(path.join(repo, 'AGENTS.md'))) lines.push('  no AGENTS.md here: run askai init so the project files, not the chat, carry the context');
  const paste = [];
  for (const n of pl.notes) { if (n.startsWith('Paste this') || n.length > 160) paste.push(n); else lines.push(`  ${n}`); }
  const shown = [pl.cmd, ...pl.args.map(a => (/[\s"]/.test(a) ? JSON.stringify(a.length > 80 ? a.slice(0, 80) + '...' : a) : a))].join(' ');
  const runLine = `  run: ${Object.entries(pl.env).map(([k, v]) => `${k}=${v} `).join('')}${shown}`;
  for (const line of [...lines.slice(0, 5), runLine].slice(0, 6)) print(line);
  for (const n of paste) print(`  ${n}`);
  if (pl.text && process.platform === 'win32' && o.copy !== false) { try { cp.spawnSync('clip', [], { input: pl.text }); print('  (prompt copied to the clipboard)'); } catch (_) { /* no clip */ } }
  if (o.dry || o.print) return 0;
  if (ctx.which && !ctx.which(pl.cmd)) { print(`  ${pl.cmd} is not installed: askai install --target ${pl.tool}`); return 1; }
  // A container, CI job, or agent shell has no keyboard. The CLIs wait for one and never return.
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    print('  No terminal here (a container or a pipe has no keyboard). The agent was not started.');
    print('  In the Cursor terminal, run the command above.');
    if (pl.text && !pl.notes.some(n => n.includes(pl.text))) print(pl.text);
    return 0;
  }
  session.run('start', { repo, tool: pl.tool, task: (o.ask || `${pl.tier} session`).slice(0, 120) }, () => {});
  const r = require('./platform').spawnHost(pl.cmd, pl.args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...pl.env } });
  const code = typeof r.status === 'number' ? r.status : 1;
  try {
    const daily = require('./daily');
    daily.snapshot(repo, {});
    daily.writeHandoff(repo, {});
    session.run('finish', { repo, result: `exit ${code}` }, () => {});
    const diff = cp.spawnSync('git', ['-C', repo, 'diff', '--stat', 'HEAD'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const stat = String(diff.stdout || '').split(/\r?\n/).find(Boolean) || 'clean';
    print(`session end: exit ${code} · ${stat}`);
  } catch (_) { /* the agent exit code still stands */ }
  if (pl.tool === 'claude') models.recordOutcome(repo, pl.model, code);
  return code;
}
module.exports = { plan, run };
