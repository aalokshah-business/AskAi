# Changelog

AskAI follows semantic versioning from 1.0.0 (see [RELEASING.md](RELEASING.md)). Installs always take the latest version on `main`.

## Unreleased

- `askai cli --prepare` installs the `max` profile for the recorded target and records that profile. `/askai-cli` then inits the project in the same run. Components already healthy are skipped.
- When `astral.sh` is blocked, uv is installed with `python3 -m pip install --user uv` and the blocked host is not retried. Serena, Headroom, Graphify, and MarkItDown then continue. Context Mode stays off on Node older than 22.5 instead of asking for a Node replacement. `gh` without Homebrew names `sudo apt-get install -y gh`.
- On a devcontainer or SSH session, `askai cli --launch` starts the CLI in `tmux` or `screen` and attaches the current terminal when it can. `askai upgrade`, `askai update`, and `askai setup` install `tmux` on that machine when the user is root or `sudo -n` works. They never wait for a password.

## 1.2.5 (22 October 2026): Linux and Windows host setup

- Added a Git-clone-first Linux Cursor walkthrough to the README and both installation guides, plus a checklist for Claude Code, Cursor, Antigravity and Codex on Linux and Windows.
- Clarified Cursor-only versus all-host targets, PATH refresh, project review and verification. Updated the Linux installer to recommend Node.js 24 LTS and corrected the Claude Code model check.

## 1.2.4 (22 October 2026): clearer first-time Windows setup

- Added a Git-clone-first office-laptop path in the README and both install guides, including local project selection, dry run, validation, host restart and CLI entry points.
- Bootstrap scripts now refuse to replace unrelated source folders. Corrected Windows installer help to describe Sonnet 5.5/high and no automatic compact setting.
- Updated the Windows self-test to count current Node test output, fail on a failed check, and verify its temporary path before cleanup.

## 1.2.3 (22 October 2026): verified project setup and agent upgrade review

- `/askai-cli` now requires an explicit project description for a new or stale project even with `--yes`. A current reviewed project still opens directly.
- `askai upgrade --agents` now opens Claude Code, Cursor and Codex in sequence for source-backed reviews and verified improvements. It checks all three CLIs before starting the reviews, and dry-run shows the workflow. `askai go` starts each CLI in its selected project folder.
- Audited the 21 consolidated requests against current commands, project packs and official host guidance.

## 1.2.2 (22 October 2026): full source inventory and official references

- AI review now becomes stale when README or build manifests change, not only source code. The default changed-path list stays capped at 40 for short agent output; `askai review status --all --json` exposes the full list. `askai-cli` repairs missing pack files, including agents and skills, before review.
- `askai help --help` now shows its command usage, matching every other command in the matrix.
- New-machine examples now use the lean `coding` default; `max` stays opt-in and an existing installation keeps its recorded profile when adding a project.
- `askai cli --launch` no longer fails when Linux has no `x-terminal-emulator`. A devcontainer or SSH session is told to run `askai cli` in the Cursor terminal. Firmware with `mk.sh` or Zephyr files is not labeled Android just because a Gradle file and Java sources exist.
- The guide and cheat sheet say how to fetch the latest AskAI and rerun so `/askai-cli` shows up in Cursor.
- A Cursor-only install no longer fails Claude Code checks. `~/.claude/askai` is named as AskAI's own folder. On macOS and Linux the `askai` command is added to `~/.bashrc` and `~/.profile` even when a later component fails. Serena's download is retried, and a connection reset says to re-run `askai install --only cursor-serena`. `/askai-cli` is the project file `.cursor/commands/askai-cli.md`; a remote `~/.cursor/commands` is not enough.
- `/askai-plugins` and `askai plugins ready` say which connected tools wait for a matching task and which one-time step is left. The graph build is one of those steps. `askai setup <repo>` runs status, the guideline audit, infra, plugins, the to-do list, and the file validator in one command.
- Claude Code's baseline default is `claude-sonnet-5-5` at high effort. The retired defaults (haiku, effort medium, `autoCompactWindow` 150000) are updated on the next baseline install. Compact stays in the tips.

- `askai cli --prepare` now stops until `--about` gives the project description for a review. `askai help` lists command names alphabetically. `askai graph` opens the architecture diagram in the browser from an interactive terminal. The AskAI terminal restores Backspace after a command. `askai upgrade --agents` starts a lead review after the update.

- `askai init` and project installation now scan eligible first-party source files, generate an on-demand source index, and summarize static imports and routes with source paths. Official framework documentation links are checked and cached without uploading repository content or using model tokens; `--offline` skips requests. Infra reports source-scan and official-reference coverage.
- Project files now say when a fact is unknown: an empty work order is rewritten until a goal is set, a placeholder handoff says no session is recorded, folder purposes and features stay labeled as README text or detected code, and `.cursorignore` adds large media folders that exist while keeping an edited ignore file.
- The single `askai-cli` entry point in Claude Code, Codex, Cursor and Antigravity now performs AI-assisted setup for a new project, asks for missing facts, then launches the terminal. Established projects still open directly unless setup or refresh is requested.

## 1.2.1 (21 October 2026): escape README text in generated Markdown

- Escaped angle brackets from README evidence before placing it in generated project docs, so strings such as `<style>` render as text.

## 1.2.0 (21 October 2026): evidence-based project init

- `askai init` now fills folder purposes from README layout and conventional names, architecture flow from entry code and package dependencies, features from README or page modules, and explicit README constraints. It leaves unsupported claims visible for review and preserves edited files on `--refresh`.
- `askai infra` reports project documentation coverage. The install guide now describes automatic analysis and the facts that still need owner input.
- Repeating `askai init` for an existing project no longer rewrites its registry entry.

## 1.1.0 (21 October 2026): project aliases and one AskAI launcher

- Registered initialized projects by name in `~/.askai/projects.json`; added `projects`, `set project`, and project show/rename/path/remove/switch commands. Project-aware commands now share the same resolver for names, terminal selection, directory discovery and an optional default.
- Added PowerShell, Bash and Zsh shell functions for terminal-scoped selection. Install scripts can add their managed profile block on request; full uninstall removes it.
- Added `askai docs check`, a project management guide and regression tests for command entry points, two-project setup, registry operations, terminal isolation and rollback.
- Kept `askai-cli` as the sole installed AskAI agent launcher. Reinstall removes unchanged legacy AskAI slash commands and handoff skills recorded in its manifest; edited files stay intact. AskAI-launched subprocesses now disable telemetry.

## 1.0.2 (21 October 2026): slash commands and accurate usage windows

- Added `/askai-cli` (Codex: `$askai-cli`) across Claude Code, Codex, Antigravity and Cursor; documented model token cost of the initial agent command.
- Counted MCP calls, Codex models and Codex tokens by event timestamp; fixed Claude CLI discovery and combined plugin/MCP status in `infra`.
- Included `askai-cli.md` in command status and diagnosed missing npm global bin folders in `todo`.
- Added `askai cli`, a dedicated terminal prompt for commands without slash or dollar prefixes.

## 1.0.1 (21 October 2026): CI on current Node, README caught up to the code

- GitHub Actions (`.github/workflows/test.yml`) now tests Node 22 and 24; Node 20 reached end of life.
- README: `## Commands` lists every real command and flag and all 36 component ids for `--only`/`--skip`; `## Tests` reports the current count and why a few are skipped; `## Repository layout` covers every file in `lib/`.
- Added: `scripts/validate-install.js`: read-only check of an install (`node scripts/validate-install.js <repo>`).

## 1.0.0 (21 October 2026): first public release

- One command per project from https://github.com/aalokshah-business/AskAi (`get.sh`, `get.ps1`), always the latest version; `askai upgrade` refreshes it; an agent prompt runs the command for you.
- Claude Code, Codex, Antigravity and Cursor on Windows, macOS, Linux and WSL, with evidence-based defaults and every optimiser on request (`--profile max`).
- Project knowledge pack, model tiers and subagents for all four tools, project skills, reminder hooks that cost no tokens, handoff and resume.
- In the terminal: `askai help all`, `askai todo`, `askai infra`, `askai savings`, `askai plugins info <id>` and `decisions`, `askai guide <moment>`, `askai work`, `askai audit`, `askai usage`, `askai check`.
- GitHub Actions on Ubuntu, macOS and Windows with a read-only token; CONTRIBUTING.md, SECURITY.md, RELEASING.md, issue and pull-request templates.
- MIT license. Only the maintainer pushes: CODEOWNERS and the `protect-main` ruleset (no force pushes, no deleting `main`, pull requests reviewed by the owner); `scripts/setup-github.js` applies every repository setting with the GitHub CLI.

## Before 1.0.0

Internal development builds, numbered 2.1 to 5.4, kept here for reference. Their full history is in git.

### 5.4.0 (21 October 2026): install from GitHub, share with your community (internal build)

#### Added
- `get.sh` and `get.ps1`: one command installs AskAI straight from https://github.com/aalokshah-business/AskAi (git clone, or GitHub's archive without git) into `~/.claude/askai/src`, then runs the installer with your options. `ASKAI_REF` pins a branch or tag; `ASKAI_REPO` / `ASKAI_REPO_URL` point at a fork.
- `askai upgrade [--ref REF]`: fetch the latest AskAI and re-apply the profile and target recorded at install; `askai uninstall` also removes the source checkout.
- GitHub Actions (`.github/workflows/test.yml`): tests, docs check and previews on Ubuntu, macOS and Windows (Node 20 and 22), plus the PowerShell self-test on Windows.
- CONTRIBUTING.md, SECURITY.md, docs/RELEASING.md, `scripts/sums.js` (refresh SHA256SUMS.txt before a release).
- README, INSTALL.md, docs/INSTALL.md and the guide lead with the GitHub one-liners and an agent prompt that uses them.

### 5.3.1 (21 October 2026): one command per project, and a prompt for your agent (internal build)

#### Added
- README, INSTALL.md and docs/INSTALL.md start with the one command per project (`install.ps1 -Target all -Workflow max -Project <repo> -Yes` or `install.sh --target all --profile max --project <repo> --yes`) and a short prompt that lets Claude Code, Codex, Antigravity or Cursor run it.
- A project install ends with that project's to-do list; `askai init` ends with the open count.
- `.gitattributes` (LF everywhere, CRLF for .ps1 and .cmd) and more `.gitignore` entries (plugin output folders, logs).

#### Changed
- `install.ps1 -Project` resolves the folder to a full path first and stops if it does not exist.
- The root INSTALL.md (the old Windows guide) is now the short version and points to docs/INSTALL.md.

### 5.3.0 (21 October 2026): every command and every plugin explained in the terminal (internal build)

#### Added
- `askai help all`: every command in full (usage, options, examples, exit codes). Tests now fail if a command or a flag has no help.
- `askai plugins info <id>` now includes how to use the plugin: its terminal commands, its commands or tools inside the agent, how to check it works, where to see its savings, how to switch it off, and warnings (for example Headroom's proxy and learn commands).
- `askai savings [days]`: runs each installed plugin's own report (rtk gain, ccusage daily, headroom stats, codebase-memory-mcp projects, Graphify graph status) and lists the in-agent reports.
- `askai infra`: each installed plugin points at `askai plugins info <id>`.
- Help for `askai init --build/--test/--about/--refresh`, `askai prompt --output/--kind`, `askai plugins info/install/decisions`.

### 5.2.0 (21 October 2026): nothing left for you to discover (internal build)

#### Added
- `askai todo`: everything only you can do, per tool and for the repository (sign-ins, restarts, app settings, model IDs, one-time plugin steps, project files with placeholders). Checkable items clear themselves; `askai todo done <id>` marks the rest. Shown in `askai infra`, `askai work`, the install summary and the session reminder.
- Diff-only rule in every tool's always-on rules and in AGENTS.md; `askai prompt --output diff|full`.
- Components: Repomix (`--repomix`, in max), codebase-memory-mcp (`--codebase-memory`, registered in all four tools, repositories indexed by `askai init`), claude-mem (`--claude-mem`, Claude Code plugin). The last two are not in max: one overlaps Serena and Graphify, the other summarises sessions with your plan.
- `askai init` builds the codebase-memory-mcp and Serena indexes when they are installed (local, no model).
- `askai plugins decisions`: every evaluated tool, including ChatGPT's 18, with its decision and reason. New entries: codebase-memory-mcp, SigMap, LiteLLM, OpenRouter.
- ccusage is now in the coding and docs profiles (it only measures).

#### Fixed
- A preview on Windows without npm on PATH no longer fails at ccusage; a dry run only plans the npm step.

### 5.1.0 (21 October 2026): one command installs every optimiser (internal build)

#### Added
- `max` profile (`--profile max`, PowerShell `-Workflow max`): full + RTK (all four tools), Context Mode, Headroom, Graphify, Context7, Caveman plugin, Claude Code LSP plugins (ts, py), base tools.
- `headroom` component (`--headroom`): `uv tool install headroom-ai[mcp]`, then `headroom mcp serve` registered in Claude Code, Codex, Cursor and Antigravity. Proxy mode is not set up (it can move Claude Code to API billing).
- `context7` component (`--context7`): the Context7 docs MCP server in all four tools.
- `graphify` component (`--graphify`): `uv tool install graphifyy`, then `graphify install --platform` for each tool in play. A project's graph is built once inside the agent with `/graphify .`.
- `askai infra` shows each of them per tool; `askai uninstall` removes only the entries AskAI added.

### 5.0.1 (21 October 2026): everything from the whole thread, in the terminal (internal build)

#### Added
- `askai work`, `askai etiquette`, `askai continue`, `askai checkpoint` (your wording), `askai diff`, `askai graph`.
- `askai guide security` (restored from the first kit: secrets, untrusted output, approvals, installer scripts, proxies, MCP least privilege).
- `askai prompt --kind bug|feature|design|risky`.
- `--base-tools` (PowerShell `-BaseTools`): ripgrep, jq and gh where missing (winget, Homebrew or a manual command).
- `askai infra`: a plugins and third-party tools section with the state of each, plus project-level MCP servers (.mcp.json, .cursor/mcp.json) and project hooks.
- Guide: first-run checklist per tool, MCP profiles by project type and the six states, the log-to-file pattern, safe self-healing, one stable customization line per app.
- Project files: AGENTS.md keeps long output in .ai-work/last.log; ARCHITECTURE.md has critical invariants, known problems and sensitive boundaries.
- Plugins registry: Karpathy guidelines, base tools.

### 5.0.0 (21 October 2026): AskAI as the mediator (internal build)

#### Fixed before release
- Codex chore tier: `gpt-6-luna` (GPT-6 Luna); `gpt-6.1-luna` does not exist and would fail the agent with a 400 error. `askai models set` warns on unknown Codex IDs.
- `askai uninstall` removes the reminder hooks; the clear gate ignores the empty handoff template and says so.
- The installed copy carries the Markdown documents and the diagram, so `askai docs` works from any terminal.

#### Added
- `askai init` / `askai map` (lib/project.js): project knowledge pack for all four tools; interactive questions or `--about/--yes`; marked blocks, never overwrites; `--refresh`.
- `askai models` (lib/models.js): lead, build and chore tiers per tool with the user's preferences; `set`, `verify`.
- `askai go` (lib/launch.js), `askai prompt` (lib/prompt.js), `askai guide`, `askai clear`, `askai context` (lib/guide.js).
- `askai mcp` (lib/mcp.js), `askai audit` (lib/audit.js), `askai infra` (lib/infra.js), `askai plugins` (lib/plugins.js), `askai convert`, `askai docs`, `askai hook`.
- `prompt-hooks` component: SessionStart and UserPromptSubmit reminders answering only with systemMessage.
- Codex session models (turn_context) and Claude subagent models in usage, audit and infra.
- Merged from the ChatGPT-built toolkit: work order, context router, orchestration rules (stop after two failed attempts, bounded outputs), on-demand skills, the clear/compact gate, manual context advice.
- `install.ps1 -Project`, `askai install --project`; new install.ps1 actions.
- Architecture document: mediator diagram (image and Mermaid), knowledge pack, tier table, expanded tool list.

### 4.2.1 (20 October 2026) (internal build)

#### Added
- `scripts/windows-selftest.ps1`: runs the real install.ps1 into a temporary folder (preview, install, check, uninstall), the checksums and the tests, and prints a summary to paste back. A test checks that every install.ps1 parameter and askai.js flag it uses exists (PowerShell was not available to execute it here).

### 4.2.0 (20 October 2026): one installation, clear install guide (internal build)

#### Added
- `docs/INSTALL.md` (+ PDF, Word): step-by-step install for Windows, macOS, Linux and WSL, environment setup, files created, verification, troubleshooting.
- `token-kit` component (first in install order): takes over a previous run of `standalone/token-setup.mjs` (runs its `--uninstall`, then AskAI applies the same settings); later components are checked again after it runs.
- `standalone/token-setup.mjs` stops when AskAI is installed (`--force` overrides).
- Tests: install.ps1 options, actions and documentation match askai.js; AskAI applies every token-setup setting with the same values; takeover leaves one rules block and no duplicate handoff.

#### Fixed
- `install.ps1` help described the 3.0 defaults; `-Lean` was accepted but ignored.
- The installed copy of AskAI did not include `standalone/`.
- The preview-matrix test is skipped on Windows (it needs bash), so `node --test` runs there.
- After a takeover, settings removed by token-setup's uninstall were not re-applied: components after `token-kit` are now checked again.
- `askai uninstall` kept Antigravity's `useG1Credits` key, and re-created the Cursor user rule (and could re-create Claude Code path rules) after removing them. Found by the new install-then-uninstall test.

### 4.1.0 (20 October 2026): one package, architecture document, help for every command (internal build)

#### Added
- `docs/ARCHITECTURE.md` (+ PDF, Word), generated from the code by `scripts/gen-docs.js`; `--check` is part of the test suite.
- `askai help <command>` and `askai <command> --help` (lib/help.js).
- `standalone/`: the settings-only `token-setup.mjs` with its launchers and templates (formerly Token_Saving_Kit.zip).
- `docs/research/`: the neutral Token-Saving Guide, tool catalogue, screenshot and tip checks, sources.
- Knowledge base: SuperClaude, doctor and audit tools, status lines and monitors, budget guards, subagent offloading, all-in-one plugins.
- Preview matrix rows for the standalone script.

### 4.0.0 (20 October 2026): one tool from setup to daily use (internal build)

#### Added
- `askai check [dir]`: machine and repo audit against the Token-Saving Guide (billing traps, default and subagent models, effort, auto-compact, idle drains, instruction-file sizes, MCP counts, RTK and Context Mode, Codex and Antigravity settings, Cursor rules, repo AGENTS.md / CLAUDE.md / .cursorignore / .ai-work), each gap with its fix; `--fix` scaffolds the repo; exit 1 on a failing item.
- `askai ask <words>`: 37 offline rules with their evidence and the command in each tool.
- `askai start`, `askai break` (git state, running agent CLIs, handoff per tool, ledger entry, break time) and `askai resume` (time away and continue-or-fresh advice, handoff, prompt; `--copy` to the clipboard).
- `askai usage [days]`: Claude Code via ccusage or transcripts; Codex from `~/.codex/sessions`, read best effort.
- `agy-baseline` (Antigravity `useG1Credits: false` when unset).
- `scripts/preview-matrix.sh` and `scripts/fake-platform.cjs`: dry-run previews of every OS (Linux, macOS, Windows) x tool; results in `docs/PREVIEW_MATRIX.md`.

#### Changed
- Claude Code defaults when unset: main model `haiku`, subagents `haiku`, `effortLevel: medium`.
- `lean` is in every profile; `--lean-git` adds `includeGitInstructions: false`.
- Codex `[tui] auto_recap = false` is part of `codex-baseline`.

#### Fixed
- `--target codex` failed when the codex CLI was not installed (found by the preview matrix). AskAI now writes `[mcp_servers.serena]` itself in that case, and removes it cleanly.

### 3.1.0 (20 October 2026): evidence-based defaults (internal build)

Research round 3 (official docs of all four tools, JetBrains' paired benchmarks, the cc.bruniaux.com catalogue of 45 tools and 8 benchmarks, dotclaude's measured heavy week, community guides and YouTube) changed the defaults.

#### Changed
- **RTK and Context Mode are opt-in** (`--rtk`, `--context-mode`, `-Rtk`, `-ContextMode`) in every profile, and their Cursor, Codex and Antigravity twins follow the flags. Independent paired benchmarks: RTK median +7% task cost (JetBrains +7.6% at low effort, p=0.004); Context Mode +33% to +72% (one study). Existing installs keep them.
- RTK's status text now says that `rtk gain` estimates shell output trimmed, not cost; its evidence label is "reported".

#### Added
- A **build-lean rule line** (smallest change, reuse, no speculative code) in every host's token rules: Ponytail's mechanism, -10.3% cost in JetBrains' test.
- **`--lsp ts,py,kotlin,ruby,swift`** (`code-intel`): Claude Code's official code-intelligence plugins plus the npm language servers for ts and py.
- **`agy-path-rules`**: AskAI's code and document rules for Antigravity as glob-triggered rules in `~/.gemini/config/rules`.
- **`--lean`** also sets `awaySummaryEnabled: false`, `crossSessionInbound: "hold"`, `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0`, and Codex `[tui] auto_recap = false`.
- **`doctor`** warns about CLAUDE.md or MEMORY.md over 200 lines, more than five user-scope MCP servers, and a wired RTK.
- **`askai tips`** rewritten with the round-3 findings for each host. 7 new tests (189 in total).

#### Fixed
- A new doctor check could throw on an unparseable `settings.json`; it is now guarded.

### 3.0.0 (20 October 2026): AskAI merged edition (internal build)

Merges AskAI 2.1, the first token-saving playbook and its installer kit, and the ChatGPT efficiency kit into one tool and one guide.

#### Added
- **Codex and Antigravity hosts** (`--target codex|agy|all` or a list such as `claude,codex`; `auto` finds them): `codex-baseline`, `codex-rules`, `codex-rtk`, `codex-serena`, `agy-rules`, `agy-rtk`, `agy-serena`.
- **macOS, Linux and WSL**: `install.sh`; `lib/pkg.js` uses Homebrew, the vendors' installer scripts, or cargo (RTK from its git repository). Windows keeps winget. The install plan names what will really run on each OS.
- **Baseline model choices**: Claude Code main model `sonnet` when none is set (`--main-model haiku|sonnet|opus|keep`), `--subagent-model`; Codex `--codex-model`.
- **`--lean`** (opt-in): `promptSuggestionEnabled=false`, `bashOutputMaxChars=15000`, `includeGitInstructions=false`, and `permissions.deny` `Read()` rules for `node_modules`, build output, lockfiles, minified files and `.env`.
- **Hook-free handoff in every host** (`handoff` component, in every profile): `/askai-handoff` for Claude Code and Cursor, the `askai-handoff` skill for Codex and Antigravity.
- **`askai session`** (init, start, pause, resume, status, finish, measure, report), **`askai scaffold`**, **`askai tips`**, **`askai peak`**.
- **Billing-safety checks in `askai doctor`**: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, no default model, Antigravity `useG1Credits`, oversized `CLAUDE.md` and Codex `AGENTS.md`.
- `lib/toml-lite.js`: add-if-absent edits of Codex's `config.toml` that keep comments, order and line endings.
- `docs/`: the AskAI Guide (Markdown, PDF, Word), this changelog and the two-page cheat sheet. 16 new tests (182 in total).

#### Merged from the first kit and the ChatGPT kit
- Session ledger, measurements CSV and report (from `ai_session.py` and `usage_report.py`), project templates (from `bootstrap_project.py`), handoff prompts, deny-read list, billing warnings, peak-hour check and cheat sheet. The kits' separate installers (`setup.sh`, `setup.ps1`) and Python helpers are retired: AskAI does their jobs.

#### Fixed during self-review
- The install plan said "winget install" on macOS and Linux.
- Uninstall left an empty `[agents]` table in `config.toml` and empty rules files that AskAI had created.
- A dry run threw on machines without Homebrew instead of showing the manual step.
- The guide's claim that Antigravity removed `/fast` (it did not; corrected from the official reference).

#### Not yet verified on a real machine
- `rtk init -g --codex --auto-patch` and `rtk init -g --agent antigravity --auto-patch`, `codex mcp add serena -- ...`, and the Antigravity app reading `~/.gemini/config/skills`. Start with `--dry-run`, then `askai doctor`.
