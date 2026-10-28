'use strict';
// One registry for the public surface. help, askai direction, and docs/CHEAT_SHEET.md read this.
// A visible flag list longer than four is a bug. The home screen lists no flags.

const TIER1 = [
  ['next', 'you are not sure what to do', 'askai next', []],
  ['go', 'start the coding app on a task', 'askai go <tool> "task"', ['--tier chore|build|lead', '--dry-run']],
  ['prompt', 'turn a rough idea into a task', 'askai prompt "idea"', ['--kind bug|feature|firmware', '--copy']],
  ['run', 'a build or test prints too much', 'askai run -- <command>', ['--save NAME', '--yes']],
  ['check', 'just installed, or something feels off', 'askai check', ['--fix', '--all', '--json']],
  ['break', 'you are stepping away', 'askai break', []],
  ['resume', 'you are back from a break', 'askai resume', ['--copy']],
  ['handoff', 'finish the note for the next session', 'askai handoff ["next step"]', ['--for cursor|claude|codex|agy', '--goal TEXT']],
  ['savings', 'cost feels high', 'askai savings', ['--week', '--full', '--cache', '--import-cursor FILE']],
  ['project', 'this folder needs its pack', 'askai project <sub>', ['--name', '--path', '--undo', '--shared']],
  ['install', 'set up or finish this machine', 'askai install', ['--profile', '--add ID', '--target', '--retry']],
  ['help', 'you need the exact command', 'askai help [command]', []],
];

const TIER2 = [
  ['desktop', 'convert files or run commands in a window', 'askai desktop'],
  ['errors', 'the last build failed', 'askai errors'],
  ['diff', 'you want the change list', 'askai diff'],
  ['clear', 'the chat is long (over 60%)', 'askai clear'],
  ['snapshot', 'save work without a commit', 'askai snapshot'],
  ['weigh', 'a file may be too big to read', 'askai weigh'],
  ['route', 'you want the tier, not a launch', 'askai route "task"'],
  ['models', 'the model or effort looks wrong', 'askai models'],
  ['mcp', 'too many tool servers are on', 'askai mcp'],
  ['plugins', 'deciding whether a tool is worth keeping', 'askai plugins'],
  ['convert', 'a PDF or Office file should be text', 'askai convert'],
  ['update', 'AskAI itself is old', 'askai update'],
  ['tools', 'an installed tool is old', 'askai tools update'],
  ['why', 'one finding needs the reason', 'askai why <id>'],
  ['stop', 'an agent CLI is still running', 'askai stop'],
];

const GLOBAL = ['--yes', '--dry-run', '--json', '--project'];

function rows(list) {
  return list.map(([name, useWhen, usage, flags]) => ({ name, useWhen, usage, flags: flags || [], tier: list === TIER1 ? 1 : 2 }));
}
const ALL = [...rows(TIER1), ...rows(TIER2)];
const byName = Object.fromEntries(ALL.map(r => [r.name, r]));

function home(version) {
  const lines = [
    `AskAI ${version}  make AI coding usage last longer`,
    'Cursor · Claude Code · Codex · Antigravity',
    '',
    'Start here. askai with no command is askai next.',
  ];
  for (const r of rows(TIER1)) lines.push(`  ${r.name.padEnd(10)} ${r.useWhen}`);
  lines.push('', 'askai help more · askai help <command> · askai help all · askai direction');
  return lines.join('\n');
}
function more() {
  const lines = ['More commands. Each one owns one job.'];
  for (const r of rows(TIER2)) lines.push(`  ${r.name.padEnd(10)} ${r.useWhen}`);
  lines.push('', 'Hidden names still run and are listed by askai help all.');
  return lines.join('\n');
}
function visible(name) {
  return byName[name] || null;
}
function clip(name, entry, advanced) {
  if (advanced || !entry) return null;
  const spec = byName[name];
  if (!spec) {
    const flags = (String(entry.usage || '').match(/--[A-Za-z0-9][\w-]*/g) || []).slice(0, 4);
    return { usage: flags.length ? `askai ${name}  ${flags.join(' ')}` : `askai ${name}`, options: flags.map(f => [f, 'see askai help ' + name + ' --advanced']) };
  }
  return {
    usage: spec.usage,
    options: spec.flags.map(f => [f, '']),
  };
}
function direction() {
  return [
    'AskAI  one screen',
    '',
    'Once per machine',
    '  askai install --profile lean',
    '  askai check',
    '  askai install --retry',
    '',
    'Once per project',
    '  askai project refresh',
    '  askai project hide-local',
    '  askai check .',
    '',
    'Each task',
    '  askai next',
    '  askai prompt "idea" --copy',
    '  askai go <tool> "task" --tier build',
    '  askai run -- <command>',
    '  askai errors',
    '',
    'Taking a break',
    '  askai break',
    '  askai handoff "next step"',
    '  askai clear',
    '  askai resume --copy',
    '',
    'Weekly',
    '  askai savings --week',
    '  askai check',
    '',
    'I want to…                         run…',
    '  see what to do                   askai next',
    '  start the app                    askai go <tool> "task"',
    '  keep a noisy build               askai run -- <command>',
    '  leave a note                     askai handoff "next step"',
    '  see spend                        askai savings',
    '  turn a server off                askai mcp off <name>',
  ].join('\n');
}
const cheat = direction;
function markdown() {
  const help = require('./help');
  const host = [
    '| Purpose | Claude Code | Codex | Antigravity | Cursor |',
    '|---|---|---|---|---|',
    '| What fills the context | `/context` | `/status` | `/context` | `/context` |',
    '| Usage | `/usage` | `/status` | `/usage` | Dashboard, Usage |',
    '| New task | `/clear` | `/new` | `/clear` | `/new` |',
    '| Keep a long chat | `/compact keep: goal, files, test` | `/compact` | new chat plus a handoff | `/summarize` |',
    '| Plan before editing | `/plan` | `/plan` | `/plan` | `/plan` |',
  ].join('\n');
  const twelve = rows(TIER1).map(r => `| \`askai ${r.name}\` | ${r.useWhen} | \`${r.usage}\` |`).join('\n');
  const extra = rows(TIER2).map(r => `| \`askai ${r.name}\` | ${r.useWhen} |`).join('\n');
  // The complete index follows the categories of `askai help`, so the sheet and the help read the same way.
  const row = name => {
    const entry = help.H[name];
    return `| \`askai ${name}\` | ${entry.summary.replace(/\|/g, '\\|')} | \`${entry.usage.replace(/\|/g, '\\|')}\` |`;
  };
  const section = (title, names) => `### ${title}\n\n| Command | Purpose | Form |\n|---|---|---|\n${names.map(row).join('\n')}`;
  const listed = new Set();
  const groups = Object.values(help.CATEGORIES).map(cat => {
    // The twelve and the additional commands above already carry their own rows: each command appears once in the whole sheet.
    const names = cat.commands.map(([name]) => name).filter(name => help.H[name] && !byName[name]);
    names.forEach(name => listed.add(name));
    return names.length ? section(cat.title, names) : '';
  }).filter(Boolean);
  const others = help.names().filter(name => !listed.has(name) && !byName[name]);
  if (others.length) groups.push(section('Other', others));
  const remaining = groups.join('\n\n');
  return `# AskAI cheat sheet

Twelve commands cover a working day. \`askai\` with no command is \`askai next\`. Everything else is \`askai help more\` or \`askai help all\`.

## Start here: the one-time sequence

Once per machine: install AskAI (\`get.sh\` or \`get.ps1\`, see the install guide), \`askai install --retry\` to finish anything left, then \`askai check --all\`, \`askai infra\` and \`askai status\` to verify. Once per project: \`askai init\` in the folder (no model, no tokens), reload the Cursor window or start a new Claude Code session, then \`/askai-cli --review\` (Codex: \`$askai-cli --review\`; the agent reviews the generated files and fills the gaps, and this is the one step that uses tokens) and \`/askai-plugins\`; \`askai todo\` lists the few steps only you can do. Prefer a window: \`/askai-gui\`. Keep it current with \`askai update\`, then exit and reopen \`askai cli\` (or the Ask AI window).

## How AskAI fits together

Run AskAI in a terminal for local checks and file generation. Opening an AskAI skill or slash command in an AI chat uses model tokens. \`askai go\` launches an AI tool; that session uses the tool's model allowance.

\`\`\`mermaid
flowchart LR
  you[Terminal: askai commands] --> machine[Machine: rules, models, optional tools]
  you --> project[Project: short router, docs/ai, local handoff]
  machine --> hosts[Cursor / Claude Code / Codex / Antigravity]
  project --> hosts
  hosts --> result[Shorter context and reviewable work]
\`\`\`

AskAI stores local session state under \`.ai-work/\` and excludes it through \`.git/info/exclude\`. Project guidance remains in the repository. Cursor must open the initialized project as its workspace root to find \`.cursor/commands/askai-cli.md\`.

## The loop

\`\`\`mermaid
flowchart LR
  machine[Once per machine] --> project[Once per project]
  project --> task[Each task]
  task --> away[Taking a break]
  away --> back[Coming back]
  back --> task
  task --> week[Weekly]
\`\`\`

| Phase | Sequence |
|---|---|
| Once per machine | \`askai install\` then \`askai check --fix\` then \`askai infra\`. Retry only failed items with \`askai install --retry\` |
| Once per project | \`askai init\` or \`askai project refresh\`, then \`askai project hide-local\`, then \`askai check\` |
| Each task | \`askai next\`, \`askai prompt\`, \`askai go <tool> "task"\`, \`askai run -- <command>\`, \`askai errors\`, then \`askai diff\` |
| Taking a break | \`askai break\`, complete the draft with \`askai handoff "next step"\`, then \`askai clear\` when it says safe |
| Coming back | \`askai resume --copy\` then \`askai next\` |
| Weekly | \`askai savings --week\`, \`askai check\`, \`askai mcp\`, then \`askai plugins\` |

## I want to… run…

| I want to | Run |
|---|---|
| See what to do | \`askai next\` |
| Turn an idea into a task | \`askai prompt "idea" --copy\` |
| Start Cursor, Claude Code, Codex, or Antigravity | \`askai go <tool> "task" --tier chore\\|build\\|lead\` |
| Keep a noisy build or test | \`askai run -- <command>\` |
| Read the failure | \`askai errors\` |
| Leave the session | \`askai break\` |
| Finish the note | \`askai handoff "next step"\` |
| Come back | \`askai resume --copy\` |
| See spend | \`askai savings\` |
| See whether a tool is worth it | \`askai plugins\` |
| Turn MCP servers off | \`askai mcp off <name>\` |
| Fix what AskAI can fix | \`askai check --fix\` |

## The twelve

| Command | Use when | Form |
|---|---|---|
${twelve}

Global flags, on any command: \`--yes\` \`--dry-run\` \`--json\` \`--project\`. A command shows at most four of its own flags. The rest are \`askai help <command> --advanced\`.

## When you need one more

| Command | Use when |
|---|---|
${extra}

## Complete command index

The commands below are also implemented, grouped by the same categories as \`askai help\` (work, project, setup, health, cost, learn, system). With the twelve and the additional commands above they cover every name in \`askai help --list\`. Use \`askai help <command> --advanced\` for less common flags. Printable versions: \`docs/AskAI-setup-A3.png\` (one-time setup, setup, health, system), \`docs/AskAI-working-A3.png\` (working loop, work, project, cost, learn) and both as \`docs/AskAI-cheatsheet.pdf\`.

${remaining}

Legacy spellings \`continue\`, \`etiquette\`, \`checkpoint\`, \`work\`, \`peak\`, \`projects\`, and \`cheat\` still route to their current commands. Prefer \`resume\`, \`guide\`, \`session pause\`, \`guide work\`, \`tips peak\`, \`project list\`, and \`direction\` in new scripts.

## Which command, when

| You are | Next command |
|---|---|
| Not sure | \`askai next\` |
| About to edit | \`askai go <tool> "task"\` |
| About to build or test | \`askai run -- <command>\` |
| Over 60% context | \`askai handoff "next step"\` then \`askai clear\` |
| Stepping away | \`askai break\` |
| Back | \`askai resume\` |
| Looking at cost | \`askai savings\` |
| Something feels off | \`askai check\` |

## Inside each coding app

${host}

Exit the coding app with its own \`/exit\`. That returns you to the terminal. \`exit\` at the \`askai>\` prompt leaves the AskAI terminal.

Local files AskAI writes stay out of git through \`.git/info/exclude\` (\`askai project hide-local\`). AskAI does not edit a tracked \`.gitignore\`.

Optional tools (RTK, Context Mode, Headroom, Graphify, Context7, Repomix) install only with \`askai install --add ID\`. RTK, Headroom, and Context Mode cost more in the measured studies. Do not add them to save tokens.
`;
}

module.exports = { TIER1, TIER2, GLOBAL, home, more, visible, clip, direction, cheat, markdown, byName };
