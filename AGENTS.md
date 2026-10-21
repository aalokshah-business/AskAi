# AskAI development

- Reuse the existing CLI, component, project and documentation modules. Add a new directory only when the current layout cannot hold the feature.
- For every command or configuration change, update its help entry, relevant installer behavior, tests, README or install guide, generated architecture reference and changelog. Run `askai docs check` or `node scripts/gen-docs.js --check` before finishing.
- Keep setup repeatable and idempotent. Preserve user files and settings; never place credentials in project registries, backups, logs or test fixtures.
- Project-aware commands must resolve through `lib/project-registry.js`. Keep global tool configuration separate from project files and `.ai-work` session state.
- Add a regression test for a setup failure once diagnosed. Test new-laptop and uninstall behavior when a change affects either one.

<!-- askai:begin router (askai init --refresh updates this block; write your own notes outside it) -->
## Project
AskAI configures project guidance and token-saving tools across Claude Code, Codex, Cursor, and Antigravity to extend subscription usage through focused context and verifiable workflows. Type: other. Languages: JavaScript 100%.

## Read only what the task needs
| Need | File |
| --- | --- |
| Folders, languages, commands, entry points | docs/ai/PROJECT_MAP.md |
| Architecture and data flow | docs/ai/ARCHITECTURE.md |
| Features and where they live | docs/ai/FEATURES.md |
| Current task scope | docs/ai/WORK_ORDER.md |
| File and symbol lookup (search first) | docs/ai/SOURCE_INDEX.md |
| Official framework docs | docs/ai/REFERENCES.md |
| Where the last session stopped | .ai-work/HANDOFF.md |
| Model and effort per task | docs/ai/MODELS.md |

## Commands (narrowest first; quiet flags; long output: `cmd > .ai-work/last.log 2>&1; tail -n 40 .ai-work/last.log`)
- test: `npm test`
- test:commands: `npm run test:commands`

## Working rules
- Search (rg, symbol tools) before reading; read line ranges; never read dependencies, build output, lockfiles or .env files.
- Run the narrowest command in Commands before the full suite.
- Security constraints are in docs/ai/ARCHITECTURE.md. Keep them intact.
- Empty fields in WORK_ORDER.md and HANDOFF.md are unknown. Leave them until a person or a verified session fills them.
- Make the smallest change that solves the task; keep error handling, tests and security; no unrequested refactors or new dependencies.
- Quote only failing lines of tool output. Reply tersely: changed files, check run and result, blockers, next step. Show code changes as a diff, never whole files.

## Sessions
- One task per session. Keep the model chosen at the start (a switch rebuilds the prompt cache); raise effort for one hard step only.
- Before /clear or a break: ask the agent to write .ai-work/HANDOFF.md. After /clear: read the handoff, then only the files it names.
- Compact only to keep working on the same large feature; otherwise hand off and clear.
- When a feature or the structure changes, update one line in FEATURES.md or ARCHITECTURE.md.

## Delegation
- Tiers: lead `architect` (architecture, design, hard bugs, security), build `builder` (features and fixes within the design), chore `runner` (cleanup, scripts, git, test runs, search). Claude Code: sonnet/max, sonnet/high, haiku/high; other tools: docs/ai/MODELS.md.
- Routine work: no subagents. Give a subagent one bounded task, the files it owns, and a limit (15 tool calls, 1,500 characters).
- After two failed attempts: stop, report the cause, escalate one tier. Never relax a test to make it pass; verify results yourself.
<!-- askai:end -->

## Project notes

- Type stays `other`. `package.json` `bin.askai` is `askai.js`: a Node CLI, not a website, backend, or library.
- No build script. Checks are `npm test` and `npm run test:commands`.
