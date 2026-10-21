'use strict';
// askai tips [host] and askai peak: the handy reference, offline. Commands come from each vendor's documentation as of
// October 2026 (sources in docs/ASKAI_GUIDE.md); run /help in the tool after an upgrade.
const TIPS = {
  claude: [
    'Claude Code',
    '  /usage              plan bars + attribution by skill, subagent, plugin, MCP server; d/w = 24 h / 7 days',
    '  /context            what fills the window      /clear: new task, free     /compact keep: goal, files, failing test (costly on big contexts)',
    '  /rename then /clear before a new task; /resume to come back later instead of keeping one long chat alive',
    '  /model sonnet       default; haiku for search and small edits (subagents: model: haiku); opus only after Sonnet fails twice',
    '  /effort low|medium  thinking is billed as output; max effort can cost several times default',
    '  Esc / Esc Esc       stop early; /rewind instead of arguing      Shift+Tab or /plan before multi-file work',
    '  /btw                side question            /mcp: disable servers you will not use today (prefer gh, rg, jq CLIs)',
    '  /loop, /goal and agent teams keep spending while you are away (teams ~7x); stop them before a break',
    '  /askai-cli          AskAI terminal       /doctor weekly       /insights now and then (it costs tokens itself)',
    '  /plugin install typescript-lsp@claude-plugins-official   symbol navigation instead of grep + reads (askai install --lsp ts,py)',
    '  On usage credits the prompt cache lives 5 min, not 1 h: avoid long pauses mid-task, or set CLAUDE_CODE_PROMPT_CACHE_TTL=1h',
  ],
  codex: [
    'OpenAI Codex CLI',
    '  /status             model, context left, limits      /usage daily|weekly: usage, and where offered a banked reset',
    '  /model              a Luna-class model for routine work, Sol for hard tasks; inputs past 272K tokens bill 2x',
    '  Alt+, / Alt+.       lower / raise reasoning effort; put it back after the hard step      /personality none',
    '  /new between tasks  /compact only for a session you must keep      /recap: summary without compacting',
    '  /side (/btw)        side question           /fork: try an idea on a branch      /plan before edits',
    '  Run small jobs locally: OpenAI says cloud tasks can use more of the allowance; ask for several cloud attempts only to compare them',
    '  Fast and Ultrafast modes spend allowance faster (about 2.5x and 8x): leave them off unless speed matters more',
    '  Nest AGENTS.md by folder so a service\'s rules load only there; keep the root file short (32 KiB cap)',
    '  $askai-cli          AskAI terminal; ask the agent to write .ai-work/HANDOFF.md before a break',
  ],
  agy: [
    'Google Antigravity CLI (agy)',
    '  /usage (/quota)     quota per model: when one model runs out, Flash has its own pool that refreshes more often',
    '  /credits            paid G1 credits; keep useG1Credits false (AI Credit Overages: Never) unless you mean to buy',
    '  /model              Flash for routine work; Pro or Claude for hard tasks      /effort low|medium',
    '  /plan, /planning    plan first           /fast: skip reasoning plans for quick actions',
    '  /clear (/new)       fresh chat           /rewind (/undo), /fork (/branch): undo or branch',
    '  /context            what fills the window      /mcp: disabledTools trims a server\'s tool list',
    '  Rules: AGENTS.md / GEMINI.md always load (12k chars per IDE rule, 20k-token budget); .agents/rules/*.md with',
    '         trigger: glob or model_decision load only when needed (askai writes its code/docs rules that way)',
    '  /askai-cli          AskAI terminal      /resume (/switch): continue',
  ],
  cursor: [
    'Cursor (agent CLI and editor)',
    '  Auto mode for routine work: community reports it does not draw on the monthly pool on individual plans (check your plan)',
    '  Max mode and frontier models bill much more per request: use them for the hard task, then switch back',
    '  /context            what fills the context      Dashboard -> Usage: spend per request',
    '  Close tabs you are not using; @-mention 2-3 files instead of the folder; .cursorignore build output, lockfiles, .env',
    '  .cursor/rules with globs (askai writes ~/.cursor/rules) instead of one big always-on rules file',
    '  /summarize (/compress) or /clear (/new); /plan and /ask before edits; /rewind, /fork',
    '  Tab completions are the cheapest help: use them for small edits instead of an agent run',
    '  /askai-cli          AskAI terminal; ask the agent to write .ai-work/HANDOFF.md before a break',
  ],
  session: [
    'Sessions (askai session, any agent)',
    '  askai session start --tool claude --task "Fix mobile nav"     ledger entry with branch and commit',
    '  Ask the agent to write .ai-work/HANDOFF.md, then:',
    '  askai session pause --summary "menu closes, tests green" --next "check 320px"',
    '  askai session resume      prints HANDOFF.md, the last ledger lines and the prompt to paste into any tool',
    '  askai session measure --tool codex --task "..." --minutes 25 --input-tokens 9000 --output-tokens 2200 --success 1',
    '  askai session report      accepted tasks and tokens per tool and difficulty',
  ],
  habits: [
    'Habits that save the most (evidence in the AskAI Guide, research round 3)',
    '  1. Keep each turn small: every turn re-reads the whole context; calls past 150K tokens were 75% of one heavy week\'s cost.',
    '  2. One complete prompt beats several follow-ups: fewer turns. Batch independent reads in one message.',
    '  3. Cheapest model that can do it; escalate after a failure. A model switch is the only repeated cost drop in the benchmarks.',
    '  4. Reads, not shell output, are most tool tokens (~90% in one workload): search first, read line ranges, use LSP/Serena.',
    '  5. Ask for the smallest change that works: no speculative code (the Ponytail idea, -10% cost in one controlled test).',
    '  6. /clear between tasks; /compact is itself a large request. Handoff + fresh chat after a break over ~1 hour.',
    '  7. Few subagents: each fresh one writes ~14K tokens to the cache before its first tool call.',
    '  8. Disable unused MCP servers; keep CLAUDE.md / AGENTS.md under 200 lines; move workflows into skills.',
    '  9. Distrust tools\' own savings counters: RTK reported 96M tokens saved in runs that cost 7.6% more.',
    ' 10. Claude peak hours (weekdays 08:00-14:00 US Eastern) drain the 5-hour window faster: run big jobs outside them (askai peak).',
  ],
};
const ORDER = ['habits', 'claude', 'codex', 'agy', 'cursor', 'session'];
const ALIASES = { antigravity: 'agy', gemini: 'agy', sessions: 'session', all: null };

function render(topic) {
  const t = topic ? (Object.prototype.hasOwnProperty.call(ALIASES, topic) ? ALIASES[topic] : topic) : null;
  if (t && !TIPS[t]) throw new Error(`unknown tips topic "${topic}" (known: ${ORDER.join(', ')}, all)`);
  return (t ? [t] : ORDER).map(k => TIPS[k].join('\n')).join('\n\n');
}

// Claude's peak window as announced in March 2026: weekdays 08:00-14:00 America/New_York. The policy may change; this only
// tells you where you are against it.
function etParts(date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute) };
}
function isPeak(date = new Date()) {
  const { weekday, hour } = etParts(date);
  return !['Sat', 'Sun'].includes(weekday) && hour >= 8 && hour < 14;
}
function localWindow(date = new Date()) {
  // Find today's 08:00 and 14:00 ET as instants by scanning the day in 30-minute steps (DST-safe, no tz database needed).
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  let from = null, to = null;
  for (let m = -12 * 60; m <= 36 * 60; m += 30) {
    const d = new Date(start.getTime() + m * 60000);
    const { hour, minute } = etParts(d);
    if (minute === 0 && hour === 8 && !from) from = d;
    if (minute === 0 && hour === 14 && from && !to) to = d;
  }
  const hm = d => (d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '?');
  return `${hm(from)}-${hm(to)}`;
}
function peak(date = new Date()) {
  return [
    isPeak(date) ? 'PEAK for Claude: the 5-hour window drains faster now. Do light work; defer big refactors and agent teams.' : 'Off-peak for Claude.',
    `Peak window in your local time: ${localWindow(date)} on US weekdays (announced March 2026; check for changes).`,
    'Codex, Antigravity and Cursor publish no time-of-day pricing.',
  ];
}

module.exports = { TIPS, ORDER, render, isPeak, peak, localWindow };
