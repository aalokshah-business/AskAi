'use strict';
// askai hook prompt | session: Claude Code hooks that show you a one-line reminder. They answer only with "systemMessage",
// which Claude Code shows to you and does not add to the model's context, so they cost no tokens. They never block a prompt:
// any error means silence.
//   SessionStart: model and effort, MCP servers on, a stale handoff after a break.
//   UserPromptSubmit: context at 60% and 80% (from AskAI's status-line snapshot), every 20 prompts, Claude peak hours once.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const tips = require('./tips');

const okId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
function prompt(ctx, j) {
  if (!j || !okId(j.session_id)) return null;
  const sf = path.join(ctx.paths.sessions, `${j.session_id}.hook.json`);
  const st = readJ(sf) || { n: 0 }; st.n++;
  const snap = readJ(path.join(ctx.paths.sessions, `${j.session_id}.json`)) || {};
  const pct = typeof snap.ctxPct === 'number' ? Math.round(snap.ctxPct) : null;
  let msg = null;
  if (pct !== null && pct >= 80 && !st.w80) { st.w80 = st.w60 = true; msg = `AskAI: context ${pct}%. Run /askai-handoff, then /clear; compacting this much is itself expensive.`; }
  else if (pct !== null && pct >= 60 && !st.w60) { st.w60 = true; msg = `AskAI: context ${pct}%. Finish this step, then /askai-handoff and /clear (compact only to stay on this same feature).`; }
  else if (st.n % 20 === 0) msg = `AskAI: ${st.n} prompts in this session. A fresh session from the handoff is usually cheaper now.`;
  else if (!st.peak && tips.isPeak()) { st.peak = true; msg = 'AskAI: Claude peak hours now; big jobs drain the 5-hour window faster.'; }
  if (snap.cache && snap.cache.lastMissCause && !st.miss) { st.miss = snap.cache.lastMissCause; msg = msg || `AskAI: last cache miss: ${snap.cache.lastMissCause}. Keep the model and MCP servers fixed for the session.`; }
  try { fs.mkdirSync(ctx.paths.sessions, { recursive: true }); fs.writeFileSync(sf, JSON.stringify(st)); } catch (_) { /* silence */ }
  return msg;
}
function session(ctx, j) {
  const parts = [];
  let s = {}; try { s = cfg.readJson(ctx.paths.settings); } catch (_) { /* ignore */ }
  parts.push(`model ${s.model || 'default'}${process.env.CLAUDE_CODE_EFFORT_LEVEL || s.effortLevel ? `/${process.env.CLAUDE_CODE_EFFORT_LEVEL || s.effortLevel}` : ''}`);
  try { const on = require('./mcp').list(ctx).filter(r => r.tool === 'claude' && r.state === 'on').map(r => r.name); parts.push(on.length ? `MCP on: ${on.join(', ')}` : 'no user MCP servers'); } catch (_) { /* ignore */ }
  const cwd = j && typeof j.cwd === 'string' ? j.cwd : null;
  if (cwd) {
    const ho = path.join(cwd, '.ai-work', 'HANDOFF.md');
    try { const h = (Date.now() - fs.statSync(ho).mtimeMs) / 3600000; if (h >= 1) parts.push(`handoff ${Math.round(h)} h old: start from it (askai prompt --resume)`); } catch (_) { if (!fs.existsSync(path.join(cwd, 'AGENTS.md'))) parts.push('no AGENTS.md here: askai init'); }
  }
  if (tips.isPeak()) parts.push('Claude peak hours');
  try { const t = require('./todo'); const n = t.open(t.items(ctx, cwd)).length; if (n) parts.push(`${n} to-do(s): askai todo`); } catch (_) { /* ignore */ }
  return `AskAI: ${parts.join(' · ')}`;
}
function run(ctx, kind, stdinText) {
  let j = null; try { j = JSON.parse(stdinText || '{}'); } catch (_) { return null; }
  try { const msg = kind === 'session' ? session(ctx, j) : prompt(ctx, j); return msg ? JSON.stringify({ systemMessage: msg }) : null; } catch (_) { return null; }
}
module.exports = { run, prompt, session };
