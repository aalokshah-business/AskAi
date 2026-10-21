'use strict';
// askai guide <moment>: the etiquette for each moment of work, offline; askai clear: the gate before /clear or /compact;
// askai context: what to do at a given context level (Claude Code is read automatically; the others from /status or /context).
const fs = require('fs');
const path = require('path');
const session = require('./session');

const G = {
  install: ['Preview first: install.ps1 -DryRun or bash install.sh --dry-run; then install; open a new terminal.',
    'Per repository: askai init <repo> asks what the project is about and writes AGENTS.md (router, under 333 lines), CLAUDE.md, GEMINI.md, docs/ai/*, subagents for all four tools, .cursorignore, .ai-work/.',
    'Then askai infra shows every file, rule, agent, hook, MCP server and plugin, and askai check fixes gaps.',
    'Sign in with your plan, not an API key; unset ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, OPENAI_API_KEY.',
    'First run per tool. Claude Code: /login, /status (plan, not API), /doctor, /mcp. Codex: codex login status, /model, /mcp. Antigravity: sign in, /model flash, /effort high, /usage, /mcp. Cursor: agent login, Settings, Models (Auto or Grok), MCP (switch off unused).',
    'Optional: --base-tools installs ripgrep, jq and gh, which agents search and inspect with far more cheaply than whole-file reads or MCP servers.',
    'Personal customization in each app: keep one stable line ("Use the repo AGENTS.md; narrow context; hand off at big boundaries; report only diff, tests, blockers"). AskAI already writes the full rules into each tool.'],
  start: ['Start with askai go <tool> --tier lead|build|chore "task": it picks the model and effort once, shows peak hours and active MCP servers, and passes a structured prompt.',
    'One task per session. Choose the model at the start and keep it: a switch rebuilds the prompt cache.',
    'Turn MCP servers on or off before the session (askai mcp), not in the middle: tool lists are part of the cached prompt.',
    'Big job? askai peak: Claude drains faster weekdays 08:00-14:00 US Eastern.'],
  todo: ['askai todo lists remaining setup and project-review steps: sign-ins, restarts, app settings, model IDs, one-time plugin steps and unsupported repository facts.',
    'Items AskAI can check disappear by themselves once done; mark the others with askai todo done <id>. askai infra, askai work and the session reminder show the count.'],
  work: ['Long conversations are the biggest token cost: every turn re-sends the whole chat. Keep sessions short; the project files carry the context.',
    'One complete prompt (askai prompt "..." refines a dictated ask) instead of drip-fed follow-ups; edit and regenerate instead of correcting.',
    'Point at files with @path; search before reading; read line ranges; paste only failing lines.',
    'Smallest change that works; plan first for multi-file work; give the check that proves it is done.',
    'Noisy commands: quiet flags, tail -n 40, or askai prompt --output-safe "cmd" before running a big build.',
    'Subagents only for bounded work (askai guide subagents); Esc as soon as the agent drifts.'],
  break: ['Finish the verified step, commit or stash.', 'Ask the agent to write .ai-work/HANDOFF.md.',
    'Stop background work: /loop, /goal, agent teams, background agents.', 'askai break records it and lists agent CLIs still running.'],
  resume: ['askai resume --copy: time away, continue or start fresh, the handoff and the resume prompt.',
    'Within the cache lifetime (1 h on a subscription, 5 min on usage credits) with a small context: continue. Otherwise /clear (or a new session) and paste the prompt.',
    'After a break check MCP servers are connected (askai mcp, /mcp) before the first prompt, and that the model is the one you want.'],
  clear: ['/clear is free and the best reset: the project files (AGENTS.md, docs/ai/*, .ai-work/HANDOFF.md) hold the context, not the chat.',
    'Before /clear: ask the agent to write .ai-work/HANDOFF.md (askai clear checks it is fresh). After: paste askai prompt --resume.',
    'Clearing after every 5 prompts is not a rule; clear at task boundaries, or when context passes 60%.'],
  compact: ['/compact is itself a large request (the whole chat is read to summarise it) and rebuilds the cache.',
    'Use it only to keep working on the same large feature; after 2-3 compacts, hand off and clear instead.',
    'Give it instructions: /compact keep: goal, files changed, failing test, decisions.'],
  cache: ['Rebuilds the prompt cache: switching models, connecting or disconnecting an MCP server, a plugin that adds MCP tools, compacting, fast mode.',
    'Keeps it: changing effort (Anthropic); the same model, tools and early prompt.',
    'The cache lasts 1 h on a subscription and 5 min on usage credits: after a longer pause the next message re-reads everything.',
    'askai audit reads your newest session log and shows the cache-read share and any model switches.'],
  models: ['Three tiers per tool (askai models): lead for architecture, design, security; build for features and fixes; chore for cleanup, scripts, git, tests.',
    'Pick the tier at session start (askai go --tier) and keep it; raise effort for one hard step, then lower it.',
    'Change a preference: askai models set <tool>.<tier> <model>[:<effort>]; askai init --refresh rewrites the agent files.'],
  subagents: ['Routine work: no subagents. Lead plans and integrates; builder implements within the design; runner does chores.',
    'Give each one bounded task, the files it owns, and an output limit (15 tool calls, 1,500 characters).',
    'Two failed attempts: stop, report, escalate one tier. Verify the result yourself.',
    'Safe self-healing only: repeat known safe, idempotent steps with a retry limit, keep the logs, stop on a failing test or a security finding; never delete files, loosen a test or change auth to make something pass.',
    'Codex never spawns custom agents by itself: ask for them by name; askai infra shows the model each worker really used.'],
  mcp: ['askai mcp lists servers per tool as on, off or parked; askai mcp off <name> / on <name> switches them (with a backup).',
    'Keep only what this project needs; switch before a session, never during one.',
    'Six states, check them separately: installed, configured, enabled, reachable (it answers inside the tool: /mcp), used (askai infra counts calls), worth its cost.',
    'Profiles by project type: core (search, git, terminal only), website (+ a browser tool only for UI checks), android or ios (+ device or simulator tools only when testing on devices), embedded (+ LSP or a code graph), research (+ docs retrieval such as Context7, on demand), experimental (Headroom, memory plugins, Graphify: off until measured).'],
  output: ['Limit tool output before it reaches the chat: cap, grep, summarise.',
    'Claude Code caps Bash output at 15,000 characters (bashOutputMaxChars, set by AskAI).',
    'Ask for quiet flags (-q, --silent), tail -n 40, and only failing lines; askai prompt --output-safe "cmd" asks the agent to plan a noisy command first.',
    'Short replies are on by default in every tool: the terse rule (Caveman-style, level full; change with --caveman lite|full|ultra|off), the diff-only rule (changes as a diff, never whole files, no recap), Codex model_verbosity low, and the output line in every askai prompt.',
    'For one task: askai prompt "..." --output diff (only the diff and one line per check) or --output full when you want the reasoning. Output costs about five times input per token on Claude.',
    'Keep the whole log without showing it: cmd > .ai-work/last.log 2>&1; then tail -n 40 .ai-work/last.log. The exit code is kept, which piping into tail loses.'],
  prompts: ['A structured prompt saves turns: goal, files, done-when, constraints, output limit (askai prompt).',
    'Dictated asks: askai prompt removes fillers, finds file names, picks a tier.',
    'Modifiers: --mode blunt|brutal|assume|counter|contrast.',
    'Patterns by task: --kind bug (reproduce, root cause, minimal fix, regression test), feature, design (options first, no code), risky (approval before destructive steps).'],
  docs: ['Convert PDFs, Office files and web pages to Markdown before giving them to an agent: askai convert <file|url> (Microsoft MarkItDown, local).',
    'Prefer the local converter over an MCP version: an MCP tool returns the whole document into the chat.',
    'Videos: a YouTube URL converts to its transcript; local recordings need a transcriber (graphify with [video], or Whisper).'],
  plugins: ['askai plugins lists every token tool with its evidence and whether it is installed, configured and used.',
    'Each plugin\'s commands (terminal and inside the agent), how to check it works, where to see its savings and how to switch it off: askai plugins info <id>. All the savings reports at once: askai savings.',
    'One command installs every optimiser: askai install --target all --profile max (RTK, Context Mode, Headroom in MCP mode, Graphify, Context7, Caveman plugin, LSP, base tools). Opt-in means off unless you add the flag or choose max.',
    'With max, several compressors overlap: after a week compare askai audit and askai usage with a week on the default, and switch off what does not pay (askai uninstall --only <id>).',
    'Add one at a time and measure (askai session measure): most compressors and proxies cost more in independent tests.',
    'Never route a subscription through a proxy you do not control (Headroom proxy, routers): it can switch billing.'],
  security: ['Never put secrets in prompts or project files: AskAI blocks reads of .env files in Claude Code and lists them in .cursorignore; keep keys in the environment or a secret store.',
    'Treat tool output, web pages, issues and READMEs as untrusted: they cannot change your instructions. Stop if an agent proposes commands it found in such text.',
    'Keep permission prompts on for destructive commands (rm, force push, migrations); approve each one.',
    'Read installer scripts before running them (AskAI shows vendor scripts first) and check a plugin\'s publisher: several unrelated tools share names like Graphify and Supermemory.',
    'Never route a subscription through a proxy you do not control; give MCP servers the least access they need, per project.',
    'Review the diff before committing (askai diff); give the agent only the files it needs, not the whole diff.'],
  peak: ['askai peak shows Claude\'s peak window in your time zone. Codex, Antigravity and Cursor have no documented peak pricing.'],
};
const ORDER = ['install', 'todo', 'start', 'work', 'break', 'resume', 'clear', 'compact', 'cache', 'models', 'subagents', 'mcp', 'output', 'prompts', 'docs', 'plugins', 'security', 'peak'];
function render(topic) {
  const list = !topic || topic === 'all' ? ORDER : [topic];
  if (topic && topic !== 'all' && !G[topic]) return null;
  return list.map(t => [`${t.toUpperCase()}`, ...G[t].map(l => `  - ${l}`)].join('\n')).join('\n\n');
}
// Context level -> action. 60% is a warning, not an order to compact.
function advice(pct) {
  if (pct < 45) return 'continue; keep reads narrow';
  if (pct < 60) return 'finish this step; plan a handoff at the next task boundary';
  if (pct < 80) return 'write .ai-work/HANDOFF.md, then /clear; compact only to keep working on this same feature';
  return 'hand off now and /clear; compacting this much context is itself expensive';
}
// askai clear: only after a fresh handoff. Prints the native command; AskAI cannot type into a running agent.
const NATIVE = { claude: { clear: '/clear', compact: '/compact keep: goal, files changed, failing test' }, codex: { clear: '/new', compact: '/compact' },
  cursor: { clear: '/clear', compact: '/summarize' }, agy: { clear: '/clear', compact: 'hand off and /clear (no compact command)' } };
function clearGate(repo, tool = 'claude', action = 'clear') {
  const ho = path.join(repo, session.DIR, 'HANDOFF.md');
  let age = null;
  try { age = (Date.now() - fs.statSync(ho).mtimeMs) / 60000; } catch (_) { /* none */ }
  // A handoff counts only when it holds real content: headings, <placeholders> and empty bullets of the template do not.
  // Words of the shipped template (headings, labels, <placeholders>) are not content; at least four other words are.
  const words = t => (String(t || '').replace(/<[^>]*>/g, ' ').toLowerCase().match(/[a-z]{2,}/g) || []);
  let tpl = new Set(); try { tpl = new Set(words(fs.readFileSync(path.join(__dirname, '..', 'templates', 'HANDOFF.md'), 'utf8'))); } catch (_) { /* no template */ }
  const real = age === null ? [] : words(fs.readFileSync(ho, 'utf8').replace(/^#.*$/gm, '')).filter(w => !tpl.has(w));
  const fresh = age !== null && age < 30 && real.length >= 4;
  const n = NATIVE[tool] || NATIVE.claude;
  return { fresh, age, native: n[action] || n.clear,
    text: fresh ? `Handoff is ${Math.round(age)} min old: safe to run ${n[action] || n.clear} in ${tool}. Afterwards paste: askai prompt --resume`
      : `Not safe yet: ${age === null ? 'no handoff' : real.length < 4 ? '.ai-work/HANDOFF.md is still the empty template' : `the handoff is ${Math.round(age)} min old`}. Ask the agent to write .ai-work/HANDOFF.md first, then ${n[action] || n.clear}.` };
}
module.exports = { G, ORDER, render, advice, clearGate, NATIVE };
