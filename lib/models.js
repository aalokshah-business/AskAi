'use strict';
// Model and effort per task tier, per tool. Three tiers: lead (architecture, design, hard bugs, security), build (features and
// fixes within the design), chore (cleanup, scripts, git, test runs, search). The defaults are the user's own preferences;
// ~/.claude/askai/models.json overrides any of them: askai models set codex.chore gpt-6-luna:high
// Pick the tier when a session starts and keep it: a model switch rebuilds the prompt cache.
const fs = require('fs');
const path = require('path');

const TIERS = ['lead', 'build', 'chore'];
const TIER_INFO = {
  lead: { agent: 'architect', what: 'Architecture and design, ambiguous debugging, security, cross-module integration' },
  build: { agent: 'builder', what: 'Features, enhancements and bug fixes within the existing design' },
  chore: { agent: 'runner', what: 'Cleanup, running scripts and tests, git, search, small docs edits' },
};
const TOOLS = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', agy: 'Antigravity' };
const DEFAULTS = {
  claude: { lead: { model: 'sonnet', effort: 'max' }, build: { model: 'sonnet', effort: 'high' }, chore: { model: 'haiku', effort: 'high' } },
  codex: { lead: { model: 'gpt-6.1-sol', effort: 'high' }, build: { model: 'gpt-6.1-sol', effort: 'medium' }, chore: { model: 'gpt-6-luna', effort: 'high' } },
  // Cursor Free and Plus include only Cursor's own models (Grok 4.7, Composer); Sonnet needs Premium or above. useSonnet switches tiers.
  cursor: { useSonnet: false, lead: { model: 'grok-4.7', effort: 'xhigh' }, build: { model: 'grok-4.7', effort: 'high' }, chore: { model: 'grok-4.7', effort: 'medium' } },
  cursorSonnet: { lead: { model: 'claude-sonnet-5', effort: 'max' }, build: { model: 'claude-sonnet-5', effort: 'high' }, chore: { model: 'claude-sonnet-5', effort: 'medium' } },
  // Antigravity agent files accept only a model tier (inherit, flash_lite, flash, pro); any other value is skipped silently.
  agy: { lead: { model: 'flash', effort: 'high' }, build: { model: 'flash', effort: 'high' }, chore: { model: 'flash', effort: 'high' } },
};
const AGY_TIERS = ['inherit', 'flash_lite', 'flash', 'pro'];
// OpenAI model IDs as of October 2026 (there is no gpt-6.1-luna: Luna is GPT-6 Luna). An ID Codex does not accept fails the agent with
// a 400 error, so set() warns on anything outside this list; check your account with /model in Codex.
const CODEX_KNOWN = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5'];
const prefsFile = ctx => path.join(ctx.paths.askaiDir, 'models.json');
const clone = o => JSON.parse(JSON.stringify(o));

function load(ctx) {
  const out = clone(DEFAULTS);
  let mine = {};
  try { mine = JSON.parse(fs.readFileSync(prefsFile(ctx), 'utf8')); } catch (_) { /* defaults */ }
  for (const [tool, v] of Object.entries(mine)) {
    if (!out[tool] || typeof v !== 'object') continue;
    for (const [k, w] of Object.entries(v)) out[tool][k] = typeof w === 'object' && w ? { ...out[tool][k], ...w } : w;
  }
  return out;
}
// Tiers actually used for a tool (Cursor: Grok or Sonnet set).
function tiers(prefs, tool) { return tool === 'cursor' && prefs.cursor.useSonnet ? prefs.cursorSonnet : prefs[tool]; }
function pick(prefs, tool, tier) { const t = tiers(prefs, tool)[tier]; return { tier, agent: TIER_INFO[tier].agent, model: t.model, effort: t.effort }; }

// "codex.chore" "gpt-6-luna:high" | "cursor.useSonnet" "true"
function set(ctx, key, value) {
  const [tool, tier] = String(key || '').split('.');
  if (!TOOLS[tool]) throw new Error(`unknown tool "${tool}": claude, codex, cursor, agy`);
  let mine = {};
  try { mine = JSON.parse(fs.readFileSync(prefsFile(ctx), 'utf8')); } catch (_) { /* new */ }
  mine[tool] = mine[tool] || {};
  if (tool === 'cursor' && tier === 'useSonnet') mine.cursor.useSonnet = /^(1|true|yes|on)$/i.test(String(value));
  else {
    if (!TIERS.includes(tier)) throw new Error(`unknown tier "${tier}": lead, build, chore`);
    const [model, effort] = String(value || '').split(':');
    if (!model) throw new Error('give a model, optionally with :effort (for example sonnet:high)');
    if (tool === 'agy' && !AGY_TIERS.includes(model)) throw new Error(`Antigravity agent files accept only ${AGY_TIERS.join(', ')}; any other value makes it skip the agent silently`);
    if (tool === 'codex' && !CODEX_KNOWN.includes(model)) mine.__warning = `"${model}" is not a known Codex model ID (${CODEX_KNOWN.slice(0, 4).join(', ')}, ...); check /model in Codex before relying on it`;
    const target = tool === 'cursor' && load(ctx).cursor.useSonnet ? 'cursorSonnet' : tool;
    mine[target] = mine[target] || {};
    mine[target][tier] = { model, ...(effort ? { effort } : {}) };
  }
  const warning = mine.__warning; delete mine.__warning;
  fs.mkdirSync(path.dirname(prefsFile(ctx)), { recursive: true });
  fs.writeFileSync(prefsFile(ctx), JSON.stringify(mine, null, 2) + '\n');
  return { prefs: mine, warning };
}

function table(prefs) {
  const rows = [];
  for (const tool of Object.keys(TOOLS)) for (const tier of TIERS) {
    const p = pick(prefs, tool, tier);
    rows.push({ tool, tier, agent: p.agent, model: p.model, effort: p.effort });
  }
  return rows;
}
function render(prefs) {
  const out = ['tool         tier   agent      model              effort'];
  for (const r of table(prefs)) out.push(`${TOOLS[r.tool].padEnd(12)} ${r.tier.padEnd(6)} ${r.agent.padEnd(10)} ${r.model.padEnd(18)} ${r.effort}`);
  out.push('', `Cursor uses ${prefs.cursor.useSonnet ? 'Sonnet' : 'Grok 4.7'} tiers (askai models set cursor.useSonnet ${prefs.cursor.useSonnet ? 'false' : 'true'} to switch).`,
    'Change one: askai models set <tool>.<tier> <model>[:<effort>]   Check IDs your account offers: askai models verify');
  return out.join('\n');
}
// docs/ai/MODELS.md for a repository.
function markdown(prefs) {
  const L = ['# Model and effort per task', '', 'Tiers only. The current task stays in docs/ai/WORK_ORDER.md.', '', 'Choose the tier when the session starts (`askai go <tool> --tier <tier>`) and keep it for the session: a model switch rebuilds the prompt cache and re-reads the conversation at full price. Raise effort for one hard step if needed, then lower it again.', '',
    '| Tier | Use for | Claude Code | Codex | Cursor | Antigravity |', '| --- | --- | --- | --- | --- | --- |'];
  for (const tier of TIERS) {
    const c = t => { const p = pick(prefs, t, tier); return `${p.model}, ${p.effort}`; };
    L.push(`| ${tier} (\`${TIER_INFO[tier].agent}\`) | ${TIER_INFO[tier].what} | ${c('claude')} | ${c('codex')} | ${c('cursor')} | ${c('agy')} |`);
  }
  L.push('', '- Routine work runs in the main session with no subagents. Delegate a bounded task to the tier\'s agent by name.',
    '- Claude Code: subagent files set `model` and `effort`; for `max` in the main session AskAI sets `CLAUDE_CODE_EFFORT_LEVEL=max` (the settings key downgrades it).',
    '- Codex: custom agents are never spawned automatically; ask for them by name. Check a worker\'s real model in its session log (`askai infra`): a known bug can make it inherit the parent model.',
    `- Cursor: ${prefs.cursor.useSonnet ? 'Sonnet tiers (Premium plan or above)' : 'Grok 4.7 tiers (Sonnet needs Premium or above)'}; effort is part of the model ID, so pick the matching variant from \`agent models\`.`,
    '- Antigravity: agent files take only a tier (`flash`, `pro`, `flash_lite`, `inherit`); set `/effort high` at the start of the session.',
    '', 'Change a preference: `askai models set <tool>.<tier> <model>[:<effort>]`, then `askai init --refresh` to rewrite the agent files.');
  return L.join('\n') + '\n';
}
// Which tier a request needs, from its words. Explicit --tier always wins.
const LEAD = /\b(architect\w*|design|redesign|security|oauth|permissions model|migrat\w*|race condition|deadlock|scalab\w*|performance|cross-module|integrat\w*|data model|schema)\b/i;
const CHORE = /\b(clean ?up|tidy|rename|format\w*|lint\w*|git|commit|push|rebase|merge|script|run (the )?tests?|bump|typo|readme|docs?|comment|search|find|list|delete unused|install)\b/i;
// File names are not intent: "src/auth.ts" says nothing about the tier.
function guessTier(text) {
  const t = String(text || '').replace(/(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[a-z]{1,6}\b/gi, ' ');
  return LEAD.test(t) ? 'lead' : CHORE.test(t) ? 'chore' : 'build';
}

module.exports = { TIERS, TIER_INFO, TOOLS, DEFAULTS, AGY_TIERS, CODEX_KNOWN, load, set, pick, tiers, table, render, markdown, guessTier, prefsFile };
