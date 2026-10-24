#!/usr/bin/env node
'use strict';
// Builds docs/ARCHITECTURE.md from the code (components, profiles, settings, command help, knowledge base) plus the narrative
// below, so the document cannot drift from what AskAI actually does.
//   node scripts/gen-docs.js           write docs/ARCHITECTURE.md
//   node scripts/gen-docs.js --check   exit 1 when the file is out of date (the test suite runs this)
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const comps = require('../lib/components');
const profiles = require('../lib/profiles');
const cfg = require('../lib/claude-config');
const help = require('../lib/help');
const kb = require('../lib/kb');
const pkg = require('../package.json');
const models = require('../lib/models');
const project = require('../lib/project');

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const code = s => `\`${s}\``;
const HOST = { claude: 'Claude Code', cursor: 'Cursor', codex: 'Codex', agy: 'Antigravity', any: 'all hosts' };

// Plans are written with Windows' winget ids; askai prints the macOS and Linux route at run time (planText in askai.js).
// The document shows all three, using pkg.describeOther so the text is the same regardless of which OS builds the docs.
const pkg2 = require('../lib/pkg');
function osPlan(plan) {
  return String(plan || '').replace(/winget install ([A-Za-z0-9.-]+)/g, (m, id) => {
    try {
      const mac = pkg2.describeOther({ which: n => (n === 'brew' ? '/opt/homebrew/bin/brew' : null) }, id);
      const linux = pkg2.describeOther({ which: () => null }, id);
      return `${m} on Windows, ${mac} on macOS, ${linux} on Linux`;
    } catch (_) { return m; }
  });
}
const flagOf = c => (c.optIn ? `opt-in${c.optInFlag ? ` (--${c.optInFlag.replace(/[A-Z]/g, m => '-' + m.toLowerCase())})` : ''}` : 'in its profiles');
function components() {
  return comps.ALL.map(c => `- **${code(c.id)}** · ${HOST[c.host || 'claude'] || c.host} · ${flagOf(c)} · evidence: ${c.evidence || 'none'}${c.mirrors ? ` · mirrors ${code(c.mirrors)}` : ''}.\n  ${c.title}. ${osPlan(c.plan)}`).join('\n');
}
function profileTable() {
  return table(['Profile', 'What it is', 'Components', 'Path rules'], Object.entries(profiles.PROFILES).map(([n, p]) => [
    code(n) + (n === profiles.DEFAULT ? ' (default)' : ''), p.summary, p.components.join(', '), (p.rules || []).join(', ') || 'none']));
}
function claudeSettings() {
  const lean = comps.byId('lean');
  const rows = [[code('model'), cfg.DEFAULT_MAIN_MODEL, 'baseline', 'Claude Code starts on Opus otherwise; --main-model changes it']];
  for (const [k, v] of Object.entries(cfg.BASELINE)) {
    if (k === 'skillOverrides') rows.push([code('skillOverrides'), `${Object.keys(v).length} bundled skills set to name-only`, 'baseline', 'smaller skill listing in every session']);
    else if (k === 'env') for (const [ek, ev] of Object.entries(v)) rows.push([code(`env.${ek}`), JSON.stringify(ev), 'baseline', 'subagents mostly search and read']);
    else rows.push([code(k), JSON.stringify(v), 'baseline', k === 'effortLevel' ? 'medium for routine work; raise it for a hard step' : '']);
  }
  for (const k of lean.leanKeys || []) rows.push([code(k.env ? `env.${k.key}` : k.key), JSON.stringify(k.value), 'lean', k.why || '']);
  rows.push([code('includeGitInstructions'), 'false', 'lean with --lean-git', 'no commit and PR instructions or git snapshot in every turn']);
  rows.push([code('permissions.deny'), (lean.leanDeny || []).join(', '), 'lean', 'the most expensive useless reads, and secrets']);
  return table(['Key', 'Value', 'Component', 'Why'], rows);
}
// One row per switch case in askai.js. gen-docs refuses to write if a command is missing here.
const COMMAND_SOURCE = {
  cli: 'askai.js cmdCli; lib/cli-prepare.js',
  install: 'askai.js cmdInstall; lib/components.js; lib/profiles.js; lib/agents.js',
  update: 'askai.js cmdUpdateSelf',
  tools: 'askai.js cmdUpdate; lib/components.js',
  status: 'askai.js cmdStatus; lib/status.js; lib/findings.js',
  report: 'askai.js cmdReport; lib/usage.js',
  profiles: 'askai.js cmdProfiles; lib/profiles.js',
  suggest: 'askai.js cmdSuggest; lib/suggest.js',
  project: 'lib/project-build.js; askai.js cmdProject; lib/project.js; lib/project-registry.js; lib/project-refresh.js; lib/project-review.js; lib/daily.js',
  set: 'askai.js cmdSet; lib/project-registry.js',
  shell: 'askai.js cmdShell; lib/project-shell.js',
  uninstall: 'askai.js cmdUninstall; lib/components.js',
  restore: 'askai.js cmdRestore',
  statusline: 'askai.js cmdStatusline; lib/status.js',
  session: 'askai.js cmdSession; lib/session.js',
  init: 'askai.js; lib/project.js',
  review: 'lib/project-review.js',
  map: 'lib/project.js',
  models: 'askai.js cmdModels; lib/models.js',
  go: 'lib/launch.js',
  prompt: 'askai.js cmdPrompt; lib/prompt.js',
  mcp: 'askai.js cmdMcp; lib/mcp.js',
  audit: 'lib/audit.js; lib/findings.js',
  infra: 'lib/infra.js',
  guide: 'lib/guide.js',
  docs: 'askai.js cmdDocs',
  plugins: 'lib/plugins.js; lib/plugins-ready.js; lib/usage-guide.js',
  savings: 'askai.js cmdSavings; lib/usage.js; lib/savings.js',
  convert: 'askai.js cmdConvert',
  desktop: 'lib/desktop.js; standalone/desktop.cs; standalone/desktop.py; standalone/desktop-bridge.js; setup-desktop.ps1; setup-desktop.sh',
  clear: 'lib/guide.js',
  context: 'lib/guide.js',
  todo: 'lib/todo.js; lib/findings.js',
  diff: 'askai.js cmdDiff',
  graph: 'askai.js cmdGraph; lib/graph-query.js',
  hook: 'lib/hook.js',
  check: 'askai.js cmdCheck; lib/check.js; lib/findings.js',
  why: 'askai.js cmdWhy; lib/findings.js',
  next: 'askai.js; lib/daily.js',
  route: 'askai.js; lib/models.js',
  handoff: 'lib/daily.js',
  weigh: 'lib/daily.js',
  run: 'lib/daily.js',
  errors: 'lib/daily.js',
  snapshot: 'lib/daily.js',
  stop: 'lib/daily.js',
  bootstrap: 'lib/daily.js',
  test: 'askai.js cmdTest; lib/selftest.js',
  setup: 'askai.js cmdSetup; lib/setup.js',
  ask: 'askai.js cmdAsk; lib/kb.js; lib/knowledge.js',
  start: 'lib/session.js',
  break: 'lib/session.js',
  resume: 'lib/session.js',
  scaffold: 'askai.js cmdScaffold; lib/scaffold.js',
  chat: 'lib/chat.js',
  tips: 'lib/tips.js',
  cheat: 'lib/surface.js',
  direction: 'lib/surface.js',
  version: 'askai.js; lib/runtime.js',
  '--version': 'askai.js',
};
function commandMap() {
  const src = fs.readFileSync(path.join(ROOT, 'askai.js'), 'utf8');
  const cases = [...new Set([...src.matchAll(/case '([^']+)'/g)].map(m => m[1]))];
  const missing = cases.filter(c => !COMMAND_SOURCE[c]);
  if (missing.length) throw new Error('command map missing: ' + missing.join(', '));
  return table(['Command', 'Source'], cases.map(c => [code('askai ' + c), code(COMMAND_SOURCE[c])]));
}
function commandRef() {
  return help.names().map(n => ['#### ' + code(`askai ${n}`), '', '```text', help.render(n), '```'].join('\n')).join('\n\n');
}
function practices() {
  return kb.KB.map(e => `- **${e.title}** (${code('askai ask ' + e.id)}): ${e.rule}\n  Why: ${e.why}${e.auto ? `\n  AskAI: ${e.auto}` : ''}`).join('\n');
}

function tierTable() {
  const p = models.load({ paths: { askaiDir: '/nonexistent-askai-defaults' } });
  return table(['Tier', 'Agent', 'Use for', 'Claude Code', 'Codex', 'Cursor (Grok / Sonnet)', 'Antigravity'], models.TIERS.map(t => {
    const c = x => { const q = models.pick(p, x, t); return `${q.model}, ${q.effort}`; };
    const s2 = models.DEFAULTS.cursorSonnet[t];
    return [t, code(models.TIER_INFO[t].agent), models.TIER_INFO[t].what, c('claude'), c('codex'), `${c('cursor')} / ${s2.model}, ${s2.effort}`, `${c('agy')} (model: flash in the file; /effort per session)`];
  }));
}
const ECOSYSTEM = [
  ['Built in', 'Claude Code /doctor', 'Weekly health check: large CLAUDE.md, agent descriptions over 15K tokens, MCP tools over 25K, permission conflicts', 'askai check adds billing, model, effort and four-tool checks'],
  ['Built in', '/usage, /context, /insights, plan mode, /clear, effort, skills, advisor', 'Official ways to see and cut usage', 'askai tips and askai ask point to them per tool'],
  ['Terse output', 'Caveman (skill, plugin, proxy)', 'Median -8% cost in six studies; its proxy is a third party in the request path', 'askai writes a terse block (--caveman lite|full|ultra|off); --caveman-plugin is opt-in; the proxy is not installed'],
  ['Terse output', 'SuperClaude --uc', 'Claims 30-50%; no third-party measurement; the framework loads several thousand tokens of instructions', 'Not installed; askai ask superclaude'],
  ['Smallest change', 'Ponytail, Karpathy guidelines, claude-token-efficient', 'Ponytail -10.3% (JetBrains); claude-token-efficient -11.6% (THOL)', 'askai writes the build-lean rule'],
  ['Compression proxy', 'Headroom', 'Median +32% in four studies; can move Claude Code to API billing', 'Not installed; askai check fails on ANTHROPIC_BASE_URL'],
  ['Compression proxy', 'lean-ctx, pxpipe, llmtrim, ClaudeSlim', 'lean-ctx +10.3%; others unmeasured; pxpipe lossy', 'Not installed'],
  ['Shell output filter', 'RTK', 'Median +7% cost; its own counter overstated savings', 'Opt-in --rtk; askai check warns when wired'],
  ['Context sandbox', 'Context Mode', '+33% to +72% in the one paired study', 'Opt-in --context-mode; askai check warns when on'],
  ['Code navigation', 'Claude Code LSP plugins', '-13% cost (Marmelab)', 'Opt-in --lsp ts,py,kotlin,ruby,swift'],
  ['Code navigation', 'Serena', 'No third-party measurement', 'coding and full profiles, all four hosts'],
  ['Code navigation', 'CodeGraph, code-review-graph, Graphify, Claude Context, Token Savior and others', 'Small or no measured effect', 'Not installed'],
  ['Audit', 'claude-config-doctor (LLM skill), claude-doctor (offline transcript analysis)', 'Useful reviews; the LLM one spends tokens per run', 'askai check is deterministic and free'],
  ['Plugin bundles', 'context_guard, token-saver, TokenRoll scout', 'No third-party measurement; scout moves reads to subagents (still billed)', 'Their sound parts are askai settings and rules'],
  ['Budget guard', 'tokenlens', 'Warns or blocks against your weekly cap; saves nothing per task', 'askai savings and the status line show spend'],
  ['Measurement', 'ccusage, Claude-Code-Usage-Monitor, ccstatusline, CCometixLine, claude-powerline, claude-hud', 'Show where tokens go', 'ccusage in the full profile; askai status line'],
  ['Measurement', 'Token Monitor (26+ tools), Claude/Codex quota bar for VS Code and Cursor, Antigravity Cockpit, Cursor dashboard', 'Cross-tool views', 'Named by askai savings'],
  ['Routers', '9Router, OmniRoute, claude-code-router, routatic-proxy, Weave Router', 'Billing, terms and data risk on a subscription', 'Not installed'],
  ['Memory', 'claude-mem, ICM, Greplica, Magic Compact, Dynamic Context Pruning', 'No independent measurement', 'Not installed; the handoff file replaces them'],
  ['MCP trimming', 'mcp2cli, Token Optimizer MCP', 'Only matters with many MCP servers', 'askai check counts servers'],
  ['Rules on demand', 'CARL / BASE', 'Keyword-loaded rules', 'askai uses path and glob rules'],
  ['Documents', 'markitdown', 'PDF and Office to Markdown before reading', 'docs and full profiles'],
  ['Hosted or paid', 'Edgee, Fermat, Parsec, WOZCODE', 'Single-study results', 'Not installed'],
  ['Bundles', 'tokless, dotclaude', 'Wire several of the above; dotclaude publishes measured usage', 'askai follows dotclaude\'s evidence, not its tools'],
  ['Docs retrieval', 'Context7', 'Current library documentation over MCP; no saving measured', 'askai plugins install context7'],
  ['Snapshots', 'Repomix', 'Whole-repo snapshot; large; useful for handovers between tools', 'askai plugins install repomix; narrow with --include'],
  ['Separate agent', 'Aider', 'Its own sessions and /architect mode; never on the same files as another agent', 'askai plugins info aider'],
  ['Memory', 'Supermemory', 'Hosted memory MCP; no independent measurement', 'Off; the handoff file replaces it'],
  ['Rules', 'Graftcode rules', 'CLAUDE.md router plus per-language rules read on demand, for Graftcode projects', 'askai plugins info graftcode'],
  ['Code indexes', 'SigMap, codebase-memory-mcp, Graft (Nanonets)', 'No independent measurement; Graft\'s structural layer needs no API key', 'Optional for very large repos'],
  ['Prompt compression', 'LLMLingua', 'Library for your own API apps', 'Not wired into the four CLIs'],
  ['API routing', 'LiteLLM, OpenRouter', 'Per-token API billing; a subscription does not transfer', 'Not for subscription use'],
  ['Toolkits', 'ChatGPT-built AskAI toolkit (Python)', 'Policies, a work order, a clear/compact gate, manual context readings', 'Merged into AskAI: work order, router, orchestration rules, skills, clear gate, context advice'],
];

function build() {
  return `# AskAI ${pkg.version} architecture

Generated by \`node scripts/gen-docs.js\` from the code; do not edit by hand. The tables of components, profiles, settings, commands and practices come straight from \`lib/\`, so this file always matches what AskAI does.

AskAI is a command-line tool that sets up Claude Code, Codex, Antigravity and Cursor for the longest possible usage, checks that they stay that way, and helps at breaks. Everything it does follows the evidence in \`docs/research/\`: settings and short rules that independent tests show save tokens, no compressors or proxies that tests show cost more.

## 0. AskAI as the mediator

![AskAI as the mediator between you and each agent engine](askai-mediator.png)

\`\`\`mermaid
flowchart LR
  U["You: prompt or dictated ask"] -->|askai prompt / askai go| IN
  subgraph A["AskAI control layer"]
    IN["Input: prompt refiner, tier router (model + effort), context pack (AGENTS.md -> docs/ai -> HANDOFF)"]
    POL["Settings it owns: rules blocks, subagents, skills, MCP on/off, plugins, billing and cache guards"]
    OUT["Observers: reminder hooks, status line, savings, audit, ledger"]
  end
  IN --> CC["Claude Code"] & CX["Codex"] & CU["Cursor"] & AG["Antigravity"]
  POL -. configures .-> CC & CX & CU & AG
  CC & CX & CU & AG -->|session logs, status JSON, hook events| OUT
  OUT -->|reminders; askai infra, audit, savings| U
\`\`\`

| When | What passes through AskAI | How |
| --- | --- | --- |
| Before a session | The task, the tier (lead, build, chore), the model and effort, the active MCP servers, peak hours, the project context | ${code('askai go')}, ${code('askai prompt')}, ${code('askai mcp')}, ${code('askai models')}, ${code('askai init')} |
| During a session | The rules, subagents and skills AskAI wrote (the agent loads them); reminders at 60% and 80% context, long sessions, peak hours, stale handoff, cache misses | Files in each tool; Claude Code ${code('SessionStart')} and ${code('UserPromptSubmit')} hooks answering with ${code('systemMessage')} only (zero tokens) |
| At a break or a /clear | The handoff, the ledger, the check that the handoff is fresh | Ask the agent to write .ai-work/HANDOFF.md; ${code('askai break')}, ${code('askai clear')}, ${code('askai resume')} |
| After work | Usage, cache reuse, model switches, the models subagents really ran, what is installed versus used | ${code('askai savings')}, ${code('askai audit')}, ${code('askai infra')}, ${code('askai session report')} |

AskAI does not sit inside a running agent and rewrite each message: none of the four tools allows that without proxying their traffic, which can switch billing and breaks caching. It mediates at the boundaries (session start, breaks, clears) and inside the session through the files and hooks each tool already reads. That also matches the cache rule: the model, effort and tools are chosen once per session.

## 1. Design principles

- **Evidence first.** A tool or setting is installed by default only when official guidance or a third-party measurement supports it. Tools the benchmarks did not support stay opt-in (\`--rtk\`, \`--context-mode\`) or out.
- **Never override.** Every setting is added only when you have not set it; your own model, effort or rules stay. The retired AskAI defaults (haiku, effort medium, autoCompactWindow 150000) are the exception: the next baseline install updates them.
- **Reversible.** Each file is backed up before its first change; rule text lives in marked blocks; a manifest records every key, file and registration AskAI added, and \`askai uninstall\` removes only those.
- **No background work.** AskAI adds no hooks. Its own earlier hooks were measured to cost more than they saved.
- **No sudo, one install for four agents.** Package managers per OS (winget, Homebrew, vendor scripts, cargo), user-level paths only.

## 2. How AskAI saves tokens

| AskAI feature | Mechanism | Evidence |
| --- | --- | --- |
| Sonnet 5.5 default, Haiku subagents (when unset) | Everyday model at high effort; subagents mostly search | A model switch is the only repeated large saving across eight benchmarks |
| ${code('effortLevel')} medium; Codex effort medium, verbosity low | Raise effort for a hard step | Thinking is billed as output (Anthropic) |
| Lean settings (suggestions, recaps, goal check-ins, cross-session wake-ups off) | No requests you did not ask for | Anthropic's cost guide lists each as a background request |
| ${code('bashOutputMaxChars')} and deny-read rules | Less tool output and no useless reads in context | Reads are about 90% of tool-result tokens |
| Token rules, build-lean rule, terse block in every host | Fewer turns, smaller diffs, shorter replies | Ponytail -10.3%, Caveman-style -8% |
| Path and glob rules | Detail loads only for matching files | Always-on instruction budgets (Anthropic, Antigravity) |
| ${code('askai scaffold')} (AGENTS.md, .cursorignore) | Agents stop re-discovering the project and skip junk files | Vendor guidance in all four tools |
| ${code('askai check')} | Catches drift: Opus default, high effort, API keys, oversized files, MCP sprawl | Each check maps to a rule above |
| ${code('askai break')} / ${code('askai resume')} | Nothing left running; fresh chat after the cache expires | Cache lifetime 1 h on a subscription, 5 min on usage credits |
| LSP plugins (${code('--lsp')}) | Symbol navigation instead of whole-file reads | -13% cost (Marmelab) |
| ${code('askai savings')}, ${code('askai report')}, status line, ledger | You can see and compare what each tool and habit costs | Measure accepted work per token, not tool counters |

## 3. From installation to daily use

| Stage | Do | AskAI |
| --- | --- | --- |
| Day 0, each machine | Preview, install, open new sessions, confirm subscription billing | ${code('askai install --dry-run')}, ${code('askai install')}, ${code('askai check')} |
| Each repository | Shared instruction file, ignore list, local handoff folder | ${code('askai scaffold .')}, ${code('askai check . --fix')} |
| Start of a task | One task per chat; one complete prompt; plan for multi-file work | ${code('askai start')}, ${code('askai tips peak')} |
| While working | Search then read ranges, smallest change, Esc early, few cheap subagents | Rules installed in every host; ${code('askai ask <topic>')} |
| Before a break | Verified step, commit, handoff, stop background work | Ask the agent to write .ai-work/HANDOFF.md; ${code('askai break')} |
| Coming back | Continue within the cache lifetime; otherwise fresh chat from the handoff | ${code('askai resume --copy')} |
| Weekly | Compare tools and habits on accepted work per token | ${code('askai savings 7')}, ${code('askai session report')}, ${code('/doctor')} |
| Upgrades | Re-check after each tool update | ${code('askai update')}, ${code('askai check')} |

## 4. Module map

| File | Responsibility |
| --- | --- |
| ${code('askai.js')} | CLI: argument parsing, command dispatch, the install/update/uninstall pipeline, report |
| ${code('install.ps1')}, ${code('install.sh')} | Windows and macOS/Linux/WSL entry points: check Node, then run askai.js |
| ${code('lib/components.js')} | The Claude Code components and the ALL list (install order) |
| ${code('lib/agents.js')} | Codex, Antigravity, handoff, lean and code-intelligence components |
| ${code('lib/cursor.js')} | Host detection and the Cursor components |
| ${code('lib/claude-config.js')} | settings.json baseline, managed CLAUDE.md block, terse levels, token rules |
| ${code('lib/profiles.js')} | Profiles and component selection |
| ${code('lib/rules.js')} | Path-scoped rules for Claude Code and Cursor |
| ${code('lib/pkg.js')}, ${code('lib/sys.js')}, ${code('lib/winpath.js')} | Cross-platform installs, process helpers, Windows PATH |
| ${code('lib/toml-lite.js')} | Add-if-absent TOML editing for Codex |
| ${code('lib/status.js')} | status, doctor, status line, cache view |
| ${code('lib/check.js')} | askai check |
| ${code('lib/kb.js')} | The knowledge base behind askai ask |
| ${code('lib/session.js')} | Ledger, handoff, break, resume, measurements |
| ${code('lib/usage.js')} | Codex usage from session files |
| ${code('lib/scaffold.js')}, ${code('lib/suggest.js')}, ${code('lib/tips.js')}, ${code('lib/help.js')} | Repo files, profile suggestion, offline tips and peak hours, command help |
| ${code('hooks/askai-report.js')} | Transcript spend report (run on demand, not as a hook) |
| ${code('standalone/')} | The settings-only script for machines without AskAI |
| ${code('scripts/')} | Preview matrix, platform simulation, this generator |

## 5. Install pipeline

\`\`\`mermaid
flowchart LR
  A[parse options] --> B[detect hosts]
  B --> C[select components: profile + opt-ins - skips]
  C --> D[detect state of each: ok / partial / missing / other]
  D --> E[show plan, ask once]
  E --> F[install or update each, in order]
  F --> G[record keys, files and registrations in the manifest]
  G --> H[summary and next steps]
\`\`\`

The diagram source renders on GitHub and in Mermaid-aware editors. A dry run stops after the plan. Each component has ${code('detect')}, ${code('install')}, ${code('update')} and ${code('uninstall')}; mirrors (for example ${code('cursor-serena')} for ${code('serena')}) follow the component they mirror.

## 5a. Project knowledge pack (askai init)

Runtime copying writes ${code('runtime.json')} with a revision and content fingerprint; ${code('lib/runtime.js')} compares known installed copies without relying on version labels. ${code('status --brief')} skips process/usage probes. Shared uv recovery honors ${code('--python PATH')} and a remembered local choice. ${code('lib/graph-query.js')} bounds queries and reports heuristic freshness. MCP telemetry explicitly labels partial user-log/project-export evidence; quota plans require matched account/window/acceptance and successful isolated workloads before printing comparisons.

Live audits distinguish installation/configuration, server protocol responsiveness, client attachment, observed calls and measured effect. ${code('plugins ready')} does not prove a connection. ${code('mcp verify')} preserves early-exit failures and leaves Windows npm shell launchers to native clients. Cross-client status examines registrations beyond the last install target. See ${code('docs/SUPPORT_WORKFLOWS.md')} for runtime drift and missing telemetry; Headroom reports use its durable savings command, not proxy performance data.

Project workflows accept any folder and language. Shared extension/manifest definitions in ${code('lib/project-source.js')} drive inventory, review scans, profile suggestions and terminal root discovery. Detection is advisory; unknown stacks use ${code('other')}. Explicit ${code('--type')}, ${code('--about')}, ${code('--build')} and ${code('--test')} choices persist locally in ${code('.ai-work/askai-init.json')} across map and refresh. Init never executes these commands. Symbol/import heuristics and optional navigation plugins do not support every language semantically. Normal CLI launch performs no source analysis.

Long conversations are the biggest token cost: every turn re-sends the whole chat. ${code('askai init')} puts the context into small files, so ${code('/clear')} costs nothing and a new session reads only what the task needs.

| File | Purpose |
| --- | --- |
| ${code('AGENTS.md')} | Short index (under ${project.MAX_LINES} lines): project, pointers, commands, working rules, sessions, delegation. Read by Codex, Cursor and Antigravity |
| ${code('CLAUDE.md')} | ${code('@AGENTS.md')} plus Claude-only notes. Shared rules stay in AGENTS.md |
| ${code('GEMINI.md')} | Antigravity-only notes. Gemini CLI loads this file; add AGENTS.md to ${code('context.fileName')} to load the router too |
| ${code('docs/ai/PROJECT_MAP.md')} | Folders, languages, commands, entry points. Purposes come from the README or a known folder name; a written purpose is kept |
| ${code('docs/ai/SOURCE_INDEX.md')} | Folder counts, then one row per eligible source file. Search it; do not load it whole |
| ${code('docs/ai/REFERENCES.md')} | Official pages for frameworks AskAI can check. Other dependencies are omitted. Page titles only; no repository text uploaded |
| ${code('docs/ai/ARCHITECTURE.md')} | Evidenced flow, static imports and README constraints. A decision row is added only after a decision is made |
| ${code('docs/ai/FEATURES.md')} | At most 12 rows: README bullets (documented) and routes or page modules (detected) |
| ${code('docs/ai/WORK_ORDER.md')} | The current task. An empty goal is replaced on the next init; a written goal is kept |
| ${code('docs/ai/MODELS.md')} | The tier table below. The task stays in the work order |
| ${code('.claude/agents/')}, ${code('.codex/agents/')}, ${code('.cursor/agents/')}, ${code('.agents/agents/')} | ${code('architect')}, ${code('builder')}, ${code('runner')} in each tool's format |
| ${code('.claude/skills/')}, ${code('.agents/skills/')} | ${code('architecture-map')}, ${code('prompt-refiner')}, ${code('investigate-bug')}, ${code('verify-and-review')} (load on demand) |
| ${code('.cursorignore')} | Dependencies, build output, secrets, and large media folders in the repo. An edited file is kept. Terminal and MCP tools can still read ignored paths |
| ${code('.ai-work/')} | Handoff, ledger and measurements (gitignored). The shipped handoff means no session is recorded |

Initialization also registers the canonical folder under a short name in ${code('~/.askai/projects.json')}. Tool integrations remain global; project files and ${code('.ai-work/')} stay in each repository. ${code('lib/project-registry.js')} resolves an explicit ${code('--project NAME')} or ${code('-p NAME')} first, then the terminal's ${code('ASKAI_PROJECT')}, the registered or initialized current directory, an optional default, and finally the older current-directory behavior. Missing registrations fail clearly. ${code('lib/project-shell.js')} supplies PowerShell, Bash and Zsh functions so ${code('askai set project NAME')} changes only the calling terminal. ${code('docs/PROJECT_MANAGEMENT.md')} covers registration, two terminals and moved folders.

Init scans eligible first-party source files locally (up to 1 MiB per file), records static declarations, routes and cross-folder imports, and fetches page titles from up to four fixed official framework documentation sites. It uses no model tokens and sends no repository contents. ${code('--offline')} skips the web lookup. Static evidence cannot establish runtime behavior, the current work order or handoff state; review those separately. Generated source detail is stored behind the short router and refreshed only when unedited.

The installed ${code('askai-cli')} entry point runs ${code('askai cli --prepare')}: select a project and launch its terminal without scans, installation, initialization, research, or AI review. Missing/stale review does not block launch; skipped review is never marked current. Explicit ${code('--review')} enables setup and host AI verification, with a description question for new/stale packs. Only after that review may the host call ${code('askai review done')}. Normal terminal ${code('askai init')} generates a static pack without a model. Chat invocation itself still uses tokens; direct ${code('askai cli')} avoids that chat turn. ${code('/askai-plugins')} handles its own one-time actions. Status, infra, plugins, and todo remain separate commands.

## 5b. Model and effort per tier

${tierTable()}

Change one with ${code('askai models set <tool>.<tier> <model>[:<effort>]')}; ${code('askai init --refresh')} rewrites the agent files. Antigravity agent files accept only a tier (${code('flash')}, ${code('pro')}, ${code('flash_lite')}, ${code('inherit')}); any other value makes Antigravity skip the file silently.

## 6. Components

In install order. Evidence labels: measured (a third-party saving), mixed, claims (vendor numbers only), none (a setting or prerequisite).

${components()}

## 7. Profiles

${profileTable()}

## 8. Settings written

### Claude Code (${code('~/.claude/settings.json')})

${claudeSettings()}

### Codex (${code('~/.codex/config.toml')})

| Key | Value | Why |
| --- | --- | --- |
| ${code('model_reasoning_effort')} | "medium" | less thinking by default |
| ${code('model_verbosity')} | "low" | shorter replies |
| ${code('personality')} | "none" | no personality section in the prompt |
| ${code('[agents] default_subagent_reasoning_effort')} | "medium" | cheaper subagents |
| ${code('[tui] auto_recap')} | false | no background recap requests |
| ${code('model')} | with ${code('--codex-model')} only | a cheaper default model |
| ${code('[mcp_servers.serena]')} | coding profile, when the codex CLI is missing | the same entry ${code('codex mcp add')} would write |

### Antigravity and Cursor

| Tool | File | What |
| --- | --- | --- |
| Antigravity | ${code('~/.gemini/antigravity-cli/settings.json')} | ${code('useG1Credits: false')} when unset |
| Antigravity | ${code('~/.gemini/GEMINI.md')} | the token rules block |
| Antigravity | ${code('~/.gemini/config/rules/askai-*.md')} | code and document rules with ${code('trigger: glob')} |
| Antigravity | ${code('~/.gemini/config/mcp_config.json')} | Serena (coding profile) |
| Antigravity | ${code('~/.gemini/antigravity-cli/skills/askai-cli')}, ${code('~/.gemini/config/skills/askai-cli')} | AskAI-only terminal |
| Cursor | ${code('~/.cursor/rules/askai-*.mdc')} | always-on token rule; code and document rules with globs |
| Cursor | ${code('~/.cursor/mcp.json')}, ${code('~/.cursor/hooks.json')} | Serena; RTK only with --rtk |
| Cursor | ${code('~/.cursor/commands/askai-cli.md')} | AskAI-only terminal |
| Claude Code, Cursor, Codex, Antigravity | ${code('askai-plugins')} command or skill | one-time plugin setup, then call each tool only when the task matches |

## 9. Files and data AskAI keeps

Install and update refresh both the active runtime and an existing managed legacy ${code('~/.claude/askai/app')} runtime. Old PATH entries and shell aliases therefore use current code. A registry-only ${code('~/.askai')} directory does not override an existing legacy installation's state. Runtime synchronization leaves manifests, credentials and to-do completion records outside the app untouched.

| Where | What |
| --- | --- |
| ${code('~/.askai/manifest.json')} | every key, file and registration AskAI added (drives uninstall) |
| ${code('~/.askai/backups/')} | a copy of each file before its first change (askai restore) |
| ${code('~/.askai/sessions/')} | status-line snapshots of context and cache per session (askai savings) |
| ${code('~/.askai/cache/')} | cached tool checks for askai status |
| ${code('<repo>/.ai-work/HANDOFF.md')} | the current handoff, overwritten each time |
| ${code('<repo>/.ai-work/SESSION_LEDGER.md')} | append-only ledger of starts, breaks and finishes |
| ${code('<repo>/.ai-work/measurements.csv')} | one row per measured task |
| ${code('<repo>/.ai-work/LAST_BREAK')} | the time of the last askai break (askai resume) |

## 10. Commands

Only ${code('askai cli --prepare --review')} enables setup/review. Within that explicit workflow, first setup or ${code('--refresh')} installs tools; an existing recorded profile otherwise skips installation. Source changes alone never enable review during normal launch. Run diagnostics directly in a terminal when the model does not need their output. ${code('askai savings 7')} shows uncached Codex input and cache share; cached input is already included in input, and raw totals are not weekly plan usage or measured savings. ${code('rtk proxy')} passes raw output through.

Where each command is implemented. Written from the \`case\` list in \`askai.js\` before behavior changes; \`node scripts/gen-docs.js\` fails if a command has no row.

${commandMap()}

${commandRef()}

## 11. Inside the agents

| Tool | Command or skill | What it does |
| --- | --- | --- |
| Claude Code | ${code('/askai-cli')} | opens the AskAI-only terminal |
| Codex | ${code('$askai-cli')} | opens the AskAI-only terminal |
| Antigravity | ${code('/askai-cli')} | opens the AskAI-only terminal |
| Cursor | ${code('/askai-cli')} | opens the AskAI-only terminal |
| Claude Code | ${code('/askai-plugins')} | one-time plugin setup; call each tool only when the task matches |
| Codex | ${code('$askai-plugins')} | one-time plugin setup; call each tool only when the task matches |
| Antigravity | ${code('/askai-plugins')} | one-time plugin setup; call each tool only when the task matches |
| Cursor | ${code('/askai-plugins')} | one-time plugin setup; call each tool only when the task matches |

## 12. Practices AskAI knows (askai ask)

${practices()}

## 13. Plugins and tools considered

Every tool below was researched (official docs, third-party benchmarks, community reports, YouTube). Details and sources: ${code('docs/research/TOOLS_CATALOG.md')} and the guide's Part 3.

${table(['Category', 'Tool', 'Finding', 'In AskAI'], ECOSYSTEM)}

## 14. Safety and uninstall

- Backups before the first change to each file; ${code('askai restore')} lists and restores them.
- Marked blocks in CLAUDE.md, AGENTS.md and GEMINI.md; text outside them is never touched.
- ${code('askai uninstall')} removes keys only while they still hold AskAI's value, its blocks, its own files and its MCP and plugin registrations.
- ${code('askai check')} fails when ${code('ANTHROPIC_API_KEY')} or ${code('ANTHROPIC_BASE_URL')} is set or Antigravity's paid credits are on; ${code('askai check')} shows per-tool configuration coverage.

## 15. Testing and previews

- ${code('node --test test/*.test.js')}: every component installs, detects and uninstalls in throwaway folders; settings are never overridden; the CLI, checks, knowledge base, break and resume, savings and this document are tested.
- ${code('bash scripts/preview-matrix.sh')}: ${code('askai install --dry-run')} on simulated Linux, macOS and Windows for each tool and all four, plus the standalone script; results in ${code('docs/PREVIEW_MATRIX.md')}.
- ${code('node scripts/gen-docs.js --check')}: this file matches the code.

## 16. Standalone script

${code('standalone/token-setup.mjs')} applies the same settings without AskAI (no CLI, ledger or checks), for machines where you want only the configuration. See ${code('standalone/README.md')}.

The two never run side by side: ${code('askai install')} applies every setting token-setup applies (a test compares them), and running both would load the token rules twice. When token-setup ran first, the ${code('token-kit')} component runs its ${code('--uninstall')} and AskAI applies the same settings under its own manifest. When AskAI is installed, token-setup stops and points to ${code('askai check')} (${code('--force')} overrides).

## 17. Adding a component

1. Add an object with ${code('id')}, ${code('host')}, ${code('title')}, ${code('evidence')}, ${code('plan')}, ${code('detect')}, ${code('install')}, ${code('update')} and ${code('uninstall')} to ${code('lib/components.js')} or ${code('lib/agents.js')}; record what it adds in the manifest.
2. Add it to a profile in ${code('lib/profiles.js')}, or mark it ${code('optIn')} with an ${code('optInFlag')}.
3. Add a test in ${code('test/')} for install, detect and uninstall in a throwaway folder.
4. Run ${code('node scripts/gen-docs.js')} to refresh this file.
`;
}

const out = path.join(ROOT, 'docs', 'ARCHITECTURE.md');
const text = build().replace(/[ \t]+$/gm, '');
const cheatOut = path.join(ROOT, 'docs', 'CHEAT_SHEET.md');
const cheat = require('../lib/surface').markdown();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('docs/ARCHITECTURE.md is out of date: run node scripts/gen-docs.js'); process.exit(1); }
  const curCheat = fs.existsSync(cheatOut) ? fs.readFileSync(cheatOut, 'utf8').replace(/\r\n/g, '\n') : '';
  if (curCheat !== cheat) { console.error('docs/CHEAT_SHEET.md is out of date: run node scripts/gen-docs.js'); process.exit(1); }
  const pdf = path.join(ROOT, 'docs', 'CHEAT_SHEET.pdf');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(cheatOut)).digest('hex');
  if (!fs.existsSync(pdf) || !fs.readFileSync(pdf).includes(Buffer.from(`askai-md-sha256:${digest}`))) {
    console.error('docs/CHEAT_SHEET.pdf is out of date: run python scripts/build-cheat-pdf.py'); process.exit(1);
  }
  console.log('generated documents are up to date');
} else {
  fs.writeFileSync(out, text);
  fs.writeFileSync(cheatOut, cheat);
  console.log(`wrote ${out} (${text.split('\n').length} lines) and ${cheatOut} (${cheat.split('\n').length} lines)`);
}
