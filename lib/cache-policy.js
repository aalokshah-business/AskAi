'use strict';
// Claude Code prompt-cache facts from the v2.1.242+ docs (code.claude.com whats-new 2026-w35) and the status-line
// prompt_cache object (v2.1.251+). Wording stays inside what those sources say.

function awayLabel(min) {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

function claudeLines(min, snap) {
  const lines = [`Away ${awayLabel(min)}: ${min >= 60 ? 'start a fresh chat' : 'continue in the same chat if the task is the same'}.`];
  const cache = snap && snap.cache;
  if (cache && (cache.expiresAt || cache.recacheTokensIfCold != null)) {
    lines.push(`Status line: expires_at ${cache.expiresAt || 'absent'}, recache_tokens_if_cold ${cache.recacheTokensIfCold == null ? 'absent' : cache.recacheTokensIfCold}.`);
  }
  lines.push('Subscription, within plan usage: the main conversation cache is 1 h. Past the plan limit, an API key, or a cloud provider: 5 min by default. Settings promptCacheTtl (1h) and env CLAUDE_CODE_PROMPT_CACHE_TTL keep a one-hour main-conversation cache for API-key and cloud-provider users, from Claude Code v2.1.242. subagentPromptCacheTtl sets the TTL outside the main conversation.');
  lines.push('Subagents, workflows, compaction, and session-title generation are documented as 5 min. A docs report says some subagent transcripts showed 1 h, so 5 min is the documented value, not a guarantee.');
  lines.push('Switching model forces a full re-read with no cache hits.');
  return lines.join(' ');
}

function otherHostLines(min) {
  const advice = min >= 60 ? 'start a fresh chat' : 'continue if the task is the same';
  return `Away ${awayLabel(min)}: ${advice}.`;
}

function advice(min, host, snap) {
  if (host === 'claude') return claudeLines(min, snap);
  return otherHostLines(min);
}

module.exports = { advice, awayLabel };
