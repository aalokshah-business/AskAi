# askai

**Desktop app:** Windows installation adds **Ask AI** to the Desktop and Start Menu; graphical Linux installs add an application-menu launcher and desktop shortcut. Open it to convert PDF, Word, PowerPoint, Excel, images or YouTube captions to Markdown, or select an AskAI command and view its output. Local files default to Markdown in the same folder; an output-folder picker and collision-safe filenames are included. Run `askai desktop` to open it. Separate setup: `powershell -File .\setup-desktop.ps1 -Yes` from this checkout, or `askai desktop install --yes` after installing AskAI. Linux Docker/container and headless environments skip the GUI; macOS keeps the CLI. Linux separate setup: `bash ./setup-desktop.sh --yes`. Windows/Linux can opt out with `--no-desktop` (`install.ps1 -NoDesktop`). See [desktop setup and conversion limits](docs/INSTALL.md#ask-ai-desktop-windows-and-linux).

[![test](https://github.com/aalokshah-business/AskAi/actions/workflows/test.yml/badge.svg)](https://github.com/aalokshah-business/AskAi/actions/workflows/test.yml)

askai makes AI coding subscriptions last longer. It installs and wires up existing token-saving tools for **Claude Code, Cursor, OpenAI Codex and Google Antigravity** on **Windows, macOS, Linux and WSL**, chooses the set by the kind of work (coding, documents, both, or minimal), sets each tool's own cheap defaults, and shows the savings those tools measure. It keeps a session ledger so any of the four agents can pick a task up again after a break, and prints an offline cheat sheet. The only hooks it registers are a couple of in-session reminders (`prompt-hooks`); it does not run a proxy, router or background process.

The full guide (why tokens run out, setup per tool, daily habits, session breaks, measurement, the research behind every choice) is [`docs/ASKAI_GUIDE.md`](docs/ASKAI_GUIDE.md). The [complete command sheet](docs/CHEAT_SHEET.md) and its [PDF](docs/CHEAT_SHEET.pdf) show the framework, working loop, and every supported command.

Background: the earlier self-built askai hook system was measured net negative over 7 days (it cost 26.38M units against 248.6K computed savings, NET -26.14M, -2.60% of the 940.15M spent). Its files are kept in `legacy/` for reference only. This version installs tools other people maintain and registers them once, globally, so they work in every project without any per-prompt step.

**Installing: follow [docs/INSTALL.md](docs/INSTALL.md).** Architecture, settings and command reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Contents: [Quick start](#quick-start-one-command-per-project) | [Documentation](#documentation) | [What AskAI includes](#what-askai-includes) | [The landscape](#the-landscape-what-exists-and-what-askai-uses) | [Commands](#commands) | [Safety](#safety)

## Quick start: one command per project

AskAI installs straight from GitHub: nothing to download first. Run **one command per project**. Fresh installs keep source, the application, and data under `~/.askai`; existing `~/.claude/askai` installs keep working. The default `lean` profile configures hosts found on this machine, then writes the project's knowledge pack. Running it again for another project keeps the recorded profile and skips healthy components. Use `askai update` to refresh AskAI and `askai install --add ID` to opt into a specific extra tool.

**Windows office laptop, fetch with Git first.** Install Git and [Node.js LTS](https://nodejs.org/en/download) if missing, then open a new PowerShell window. Clone your own project first and replace the sample path below with its existing local folder. The `coding` profile is the token-conscious default; `max` adds tools that may increase usage.

```powershell
$askaiSource = Join-Path $HOME '.askai\src'
$projectPath = 'C:\code\myapp'  # existing local project folder
New-Item -ItemType Directory -Force -Path (Split-Path $askaiSource) | Out-Null
git clone https://github.com/aalokshah-business/AskAi.git $askaiSource
powershell -NoProfile -ExecutionPolicy Bypass -File "$askaiSource\install.ps1" -DryRun -Target all -Workflow coding -Project $projectPath
powershell -NoProfile -ExecutionPolicy Bypass -File "$askaiSource\install.ps1" -Target all -Workflow coding -Project $projectPath -Yes
```

Open a new PowerShell window and run `askai setup --project $projectPath` (set `$projectPath` again in that window, or pass the path directly). If `askai` is not on PATH yet, run `& "$HOME\.askai\bin\askai.cmd" setup --project 'C:\code\myapp'`. See [installation steps](docs/INSTALL.md) for prerequisites, project registration and checks.

**Linux, Cursor first.** Install Git and Node.js 24 LTS, and install [Cursor for Linux](https://cursor.com/download) and sign in. Clone your project first; change the local path below. The same installer supports all four hosts: use `--target cursor` for Cursor only, or `--target all` after installing the other hosts.

```bash
project_path="$HOME/code/myapp" # existing local project folder
ls -ld "$project_path" # stop and correct the path if this fails
askai_source="$HOME/.askai/src"
mkdir -p "$(dirname "$askai_source")"
git clone https://github.com/aalokshah-business/AskAi.git "$askai_source"
bash "$askai_source/install.sh" --dry-run --target cursor --profile coding --project "$project_path"
bash "$askai_source/install.sh" --target cursor --profile coding --project "$project_path" --yes
"$HOME/.askai/bin/askai" setup --project "$project_path"
```

Restart Cursor, open that project, then run `/askai-cli` in its chat to open the terminal. AI analysis is optional: explicitly request `/askai-cli --review` (Codex: `$askai-cli --review`). `askai cli` opens the terminal directly without a chat turn. For install and chat entry points for **Claude Code, Cursor, Antigravity and Codex on Linux and Windows**, see the [host checklist](docs/INSTALL.md#linux-and-windows-host-checklist).

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.ps1))) -Target all -Project C:\code\myapp -Yes
```

macOS, Linux or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.sh | bash -s -- --target all --project ~/code/myapp --yes
```

Then open a new terminal and run `askai setup --project NAME`. That one command runs status, the guideline audit, infra, which plugins are waiting, the to-do list, and the file validator. Restart each tool. `/askai-cli` (Codex: `$askai-cli`) reviews the project pack. `/askai-plugins` finishes one-time plugin setup. The project passed during install is registered by folder name. Use `askai project list` to see it. [Project management](docs/PROJECT_MANAGEMENT.md) covers two or more repositories and shell integration. Add `-DryRun` / `--dry-run` to preview installation settings; the one-line bootstrap still downloads the AskAI source first.

**Or ask your agent to do it.** Paste this into Claude Code, Codex, Antigravity or Cursor, opened in the project:

```text
Set up AskAI for this repository. From the repository root, run the one command for this OS and wait for it to finish (it asks no questions):
- macOS, Linux or WSL: curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.sh | bash -s -- --target all --project . --yes
- Windows: powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.ps1))) -Target all -Project . -Yes"
Then run, from the repository: askai setup .
(if askai is not found yet, use its full path: ~/.askai/bin/askai, or askai.cmd on Windows)
Reply with what was installed, anything that failed, the plugin-ready report, and my to-do list. Change no other files. Remind me to restart this session, then run /askai-plugins once.
```

**Other ways to get it.** Clone it (`git clone https://github.com/aalokshah-business/AskAi ~/tools/AskAI`) or download the ZIP from GitHub (Code, Download ZIP), then run the installer in that folder with the same options: `bash ~/tools/AskAI/install.sh --target all --project ~/code/myapp --yes`, or on Windows `powershell -ExecutionPolicy Bypass -File C:\tools\AskAI\install.ps1 -Target all -Project C:\code\myapp -Yes`. With Node.js and git installed, `npx github:aalokshah-business/AskAi install --target all --project . --yes` works too.

**Keeping it current.** `askai update` fetches the latest AskAI from GitHub and re-applies your profile; `askai tools update` upgrades the tools it installed. `askai upgrade --agents` opens Claude Code, Cursor and Codex in sequence for reviews and verified improvements; it uses model tokens and needs all three CLIs on PATH. Before running a script from the internet you can read it first: [get.sh](get.sh), [get.ps1](get.ps1), and [SECURITY.md](SECURITY.md) for what the installer changes.

## Platforms

AskAI runs on Windows 11, Ubuntu, and a Debian-based devcontainer (Tier 1). macOS, Alpine, and WSL2 are Tier 2. `askai version --all` prints the same matrix. Node 22 and 24 are the CI versions. Node 20 still runs and prints one end-of-life line. Context Mode needs Node 22.5 or newer.

| Tier | Environment | Shell | Node | Gate |
| --- | --- | --- | --- | --- |
| 1 | Ubuntu (bookworm/jammy) | bash | 22, 24 | CI must pass |
| 1 | Windows 11 | Windows PowerShell 5.1 and PowerShell 7 | 22, 24 | CI must pass |
| 1 | Devcontainer / Docker, non-root | bash | 22, 24 | CI must pass |
| 2 | macOS (Apple Silicon) | zsh, bash 3.2 | 22, 24 | CI, may fail |
| 2 | Alpine | ash, bash if installed | 22 | CI, may fail |
| 2 | WSL2 | bash | 22, 24 | manual |

Troubleshooting: a `#!/bin/bash` script with a trailing CR fails in Linux (`*.sh` is LF in `.gitattributes`). `fatal: detected dubious ownership` is fixed with the `safe.directory` line `askai check --env` prints; git features are skipped, the rest keeps going. Windows PowerShell 5.1: `powershell -NoProfile -ExecutionPolicy Bypass -File .\get.ps1`. A host CLI that is a `.cmd` is started with `shell: true` so Node does not throw `EINVAL`.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/INSTALL.md](docs/INSTALL.md) | Step-by-step install for Windows, macOS, Linux and WSL, every option, every file AskAI creates, troubleshooting |
| [docs/ASKAI_GUIDE.md](docs/ASKAI_GUIDE.md) | The guide: AskAI, working etiquette, and the research behind every choice (also as .pdf and .docx) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, components, settings and the full command reference, generated from the code |
| [docs/CHEAT_SHEET.md](docs/CHEAT_SHEET.md), [PDF](docs/CHEAT_SHEET.pdf) | Framework, working loop, command choice, and the full command index |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | What changed in each version |
| [docs/PREVIEW_MATRIX.md](docs/PREVIEW_MATRIX.md) | Install previews on every OS for every tool |
| [docs/research/TOOLS_CATALOG.md](docs/research/TOOLS_CATALOG.md) | Every token-saving tool: claimed versus measured, and what AskAI does with it |
| [docs/research/SOURCES.md](docs/research/SOURCES.md) | Sources |
| [standalone/README.md](standalone/README.md) | The settings-only script for machines without AskAI |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [docs/RELEASING.md](docs/RELEASING.md) | How to help, what the installer changes and how to report a problem, how a version is released and how the repository is set up |
| [LICENSE](LICENSE) | MIT: free to use, change and share, with the copyright notice kept |

AskAI is MIT-licensed. Only the maintainer pushes to this repository; changes from others arrive as pull requests from forks and are reviewed before they are merged ([CONTRIBUTING.md](CONTRIBUTING.md)).

In the terminal: `askai help` lists seven categories, `askai help work` lists short command descriptions, and `askai help check` gives detailed command instructions. For shared names, use `askai help category setup` or `askai help command setup`. `askai help all` shows every command in detail. Use `askai plugins info <id>` for a plugin and `askai docs <name> --print` for a document above.

To check consumption, run `askai savings 7` directly in a terminal. Codex cached input is part of total input; AskAI shows uncached input and cache share separately. Raw session-token counts are not weekly plan usage or proof of savings. Read plan limits in Codex's account view. Chat skills and AI review use model tokens; terminal commands use none unless they launch an AI agent. `rtk proxy` passes raw output through without compression. Default `askai cli --prepare` only selects a project and opens the terminal. Source changes do not trigger analysis. Add `--review` explicitly for AI setup/review; combine it with `--refresh` to rerun setup.

## What AskAI includes

- **One command per project** from GitHub, for Claude Code, Codex, Antigravity and Cursor on Windows, macOS, Linux and WSL; `askai update` keeps it current.
- **Evidence-based defaults**: cheap default models and effort, idle drains off, output caps, short rules (terse replies, diff-only output, build-lean), reminder hooks that cost no tokens, a status line, handoff commands in every tool.
- **Every optimiser on request** (`--profile max`): Serena, RTK, Context Mode, Headroom (MCP mode), Graphify, Context7, Repomix, the Caveman plugin, LSP plugins, MarkItDown, ccusage, ripgrep, jq, gh; codebase-memory-mcp and claude-mem one flag each.
- **A project knowledge pack** (`askai init`): scans eligible first-party source files, README and manifests for an on-demand source index, static architecture and feature evidence. Fetches page titles from detected frameworks' official docs; `--offline` skips web access. No source text is uploaded and terminal init calls no model. Writes a short AGENTS.md router, CLAUDE.md, GEMINI.md, work order, model tiers, agents and project skills. `/askai-cli` (Codex: `$askai-cli`) opens the terminal without scanning or rewriting the pack. Explicit `--review` enables setup and host AI review, including questions for facts the repository cannot establish; this uses model tokens. Stale review state does not block normal launch. Refresh unedited generated docs locally with `askai init --project NAME --refresh --yes`. Each initialized folder gets a name in `~/.askai/projects.json`.
- **Everything visible in the terminal**: `askai help all`, `askai todo` (what only you can do), `askai infra` (installed, configured, used), `askai plugins ready` (when each connected tool is called), `askai savings`, `askai plugins info <id>`, `askai guide <moment>`, `askai audit`. A new machine is checked with `askai setup <repo>`.

What changed in each version: [docs/CHANGELOG.md](docs/CHANGELOG.md).

## The landscape: what exists and what askai uses

Token use in an agent session comes from a handful of sources, and each tool below attacks one of them. "In askai" says what this repo does with it. Nothing here was installed or benchmarked just for this table: it comes from reading each project's own documentation and repositories, so vendor figures are the vendor's.

| Token sink | Tool or workflow | What it does | In askai |
|---|---|---|---|
| Shell command output | [RTK](https://github.com/rtk-ai/rtk) | Rewrites Bash commands so their output is filtered before the model reads it | **Opt-in** (`--rtk`): six paired third-party benchmarks put its median task cost at +7% (JetBrains +7.6% at low effort, p=0.004) |
| | [Headroom](https://github.com/headroomlabs-ai/headroom) | Compression layer for context and tool output | No: four paired benchmarks put its median cost at +32% |
| | [Token Optimizer MCP](https://github.com/ooples/token-optimizer-mcp) | MCP proxy: caches/compresses tool output, AST-based code nav, SQLite-backed dedup | No: overlaps RTK, Context Mode and Serena all at once; savings are vendor self-reported (60-90%), not independently benchmarked |
| Large tool output, logs, scraped pages | [Context Mode](https://github.com/mksglu/context-mode) | Runs and indexes large output in a sandbox, hands the model a summary; keeps session memory across compactions | **Opt-in** (`--context-mode`): the one paired benchmark found +33% to +72% cost |
| Session memory across sessions | claude-mem and similar | Records sessions and injects recalled context | No: adds hooks and a database; Context Mode already covers session continuity |
| Reading whole source files | [Serena](https://github.com/oraios/serena) | Language-server symbol navigation: overview, find symbol, references | **Yes, coding** |
| | [Token Savior](https://github.com/mibayy/token-savior), jCodeMunch, code-review-graph, claude-context | Other code-index or code-graph MCP servers | No: one code-navigation server is enough; Serena has the widest language support of these and no index to build. Not benchmarked against each other here |
| | Claude Code LSP / code-intelligence plugins | First-party route to go-to-definition and diagnostics | **Opt-in** (`--lsp ts,py`): one paired benchmark measured LSP navigation at -13% cost |
| Code written, not read | [Ponytail](https://github.com/DietrichGebert/ponytail) idea | Smallest working change, no speculative code | **Yes, every profile** as one rule line (JetBrains measured the skill at -10.3% cost, p=0.004) |
| Verbose replies | [Caveman](https://github.com/JuliusBrussee/caveman) style, as a managed `CLAUDE.md` block | Terse-output directive; short token rules | **Yes, every profile** (as text in `CLAUDE.md`, not the plugin) |
| | [claude-token-efficient](https://github.com/drona23/claude-token-efficient) | Ready-made `CLAUDE.md` profiles that ask for concise output | No: a large always-loaded file costs tokens every session; askai keeps the block to a few lines |
| Always-loaded instructions | Path-scoped rules (`~/.claude/rules/*.md` with `paths:`; Cursor `.mdc` with `globs`) | A rule loads only when a matching file is read | **Yes, per profile** (`rules` component) |
| Binary documents (PDF, Office) | [markitdown](https://github.com/microsoft/markitdown) | Converts a document to Markdown once, so it is read as text | **Yes, docs and full** |
| Library documentation lookups | Context7 | MCP server that fetches current library docs | No: it saves searching, not tokens in general; add it yourself if you need it |
| Model cost, not tokens | claude-code-router, LiteLLM | Proxy that routes requests to cheaper models | No: puts a proxy in the request path. The cheap first-party version is used instead: `CLAUDE_CODE_SUBAGENT_MODEL=haiku` |
| Usage and cost reporting | [ccusage](https://github.com/ryoppippi/ccusage) | Reads local Claude Code transcripts, prints usage and cost per day | **Yes, opt-in (full profile or `--ccusage`)**; reports, saves nothing |
| | Claude-Code-Usage-Monitor | Live terminal view of limits and burn rate | No: ccusage covers reporting |
| | Claude Code `/usage`, `/context`, OpenTelemetry export | First-party views and metrics | Used as they are; not wrapped |
| | Status line `prompt_cache` and `context_window` fields | Claude Code reports cache hit and context use to the status line command | **Yes**: `askai statusline` records them per session (Claude Code v2.1.251+) |
| Peer installers | [tokless](https://pkg.go.dev/github.com/HoangP8/tokless), [dotclaude](https://github.com/xsyetopz/dotclaude) | tokless wires RTK, Caveman, Ponytail, codegraph and Context Mode into four agents; dotclaude is a lean settings snippet | No: same idea, different stance (askai installs fewer tools and labels the evidence); worth reading |
| Request-rewriting proxies | ClaudeSlim and similar | Rewrite or "hash" the system prompt and tool names in a local proxy | No, and avoid: breaks prompt caching and tool semantics, and sits in the billing path |
| Built into Claude Code | Prompt caching, `/compact`, `/clear`, `/effort`, subagent model, skills, MCP tool-definition deferral, output styles | Native levers | Baseline settings (subagent model, `skillOverrides`); compact and `/clear` stay habits, see tips |

Names without a link were found in searches while researching this; find the official repository yourself before installing any of them.

### Evidence labels

Every claim about a saving in this README, in `askai status` and in `askai report` falls in one of these:

| Label | Meaning | Examples |
|---|---|---|
| Measured by the tool | The tool counts it itself; askai prints the number as given | RTK's `rtk gain`: its own estimate of shell output trimmed, not of cost (in JetBrains' runs it logged 96.2M tokens saved while task cost rose 7.6%) |
| Tool-reported, per session | The tool reports it per session | Context Mode's `/context-mode:ctx-stats` |
| Reported by Claude Code | Figures Claude Code hands to the status line | Context use, prompt-cache hit, re-cache tokens, last miss cause |
| Third-party report | Another program's own output, shown and not parsed | ccusage |
| Not measured | No counter exists, so askai shows no number and claims none | Serena, markitdown, Caveman, path-scoped rules |
| Vendor claim | A figure from a project's own README | RTK's 60-90% and Context Mode's 98% style headline reductions: not verified here |

The net effect of the whole stack is unproven. The spend section of `askai report` reads the Claude Code transcripts and shows where tokens actually went; use it to check that the stack helps.

## Why this combination

> RTK and Context Mode are opt-in (`--rtk`, `--context-mode`): paired third-party benchmarks found no net saving for either. The reasons below explain the one-tool-per-sink design; [Evidence labels](#evidence-labels) above gives the sourcing for every claim.

askai installs a specific subset. The reasons, in order of weight:

1. **One tool per sink, no overlap.** Shell output goes to RTK, big tool output to Context Mode, source reading to Serena, binary documents to markitdown, reply length to the Caveman block, always-loaded text to path-scoped rules. Two tools competing for the same sink would both add overhead for one saving. RTK and Context Mode do both touch Bash calls, which is the one known overlap (see [Known risks](#known-risks)); the alternatives (Headroom, a second index server) would add more.
2. **No always-on cost that is not earned.** RTK's hook runs locally and adds no model tokens. Rule files are path-scoped, so a coding rule costs nothing in a document session. The `CLAUDE.md` block is a few lines. Serena and Context Mode are MCP servers, whose tool definitions Claude Code defers by default rather than loading in full each session; that is a small cost, and it is not measured here.
3. **Almost nothing self-built.** The earlier askai hooks were the largest single cost in the measured ledger. Everything installed now is maintained by someone else, except a couple of short in-session reminders (`prompt-hooks`); askai runs no proxy, router or background process of its own.
4. **Measured where possible, silent where not.** RTK and Context Mode have counters and are shown. Serena, markitdown and Caveman have none, so askai claims no number for them. ccusage is included because a report that reads transcripts is the independent check on the rest, not because it saves anything.
5. **Reversible.** Every changed file is backed up first, ownership is recorded in a manifest, and `askai uninstall` removes only what askai added.
6. **Works on both hosts where the tool allows it.** RTK, Context Mode and Serena each have a Cursor route; the status line, cache figures, ccusage and the spend report are Claude Code only (see [Claude Code and Cursor](#claude-code-and-cursor)).
7. **Conditional.** Document work does not need code navigation, and code work does not need a PDF converter. Profiles keep each kind of work to the tools it uses.

Left out on purpose, with the reason in the table above: proxies and routers (a moving part in the request path), memory databases and second code indexes (overlap), big `CLAUDE.md` templates (always-loaded cost), and anything whose only support is a single-source benchmark.

## Profiles: different tools for different work

```powershell
askai profiles                          # list them
askai suggest C:\work\my-project        # read-only: counts code and document files and names a profile
askai install --profile docs            # install one
askai install --markitdown --ccusage    # add a tool to whatever profile is in effect
```

| Profile | Installs (on top of the base) | Path rules | For |
|---|---|---|---|
| `minimal` | Base only | none | Cheap model defaults, token and terse rules, status line, handoff; no MCP servers or plugins |
| `coding` (default) | Base + Serena + ccusage | coding | Source code work |
| `docs` | Base + markitdown + ccusage | docs | Writing and reading documents, PDFs and Office files; no code navigation |
| `full` | Base + Serena + markitdown + ccusage | coding + docs | Mixed work |
| `max` | `full` + RTK, Context Mode, Headroom (MCP mode), Graphify, Context7, Repomix, the Caveman plugin, LSP plugins (ts, py), base tools | coding + docs | Every optimiser, for people who choose all of them over the evidence-based default |

The base is `token-kit`, `claude`, `baseline`, `caveman`, `statusline`, `rules` (the rule files a profile selects), `handoff`, `lean` and `prompt-hooks`. RTK (`--rtk`), Context Mode (`--context-mode`) and the code-intelligence plugins (`--lsp`) are opt-in on top of any profile.

- `askai suggest [dir]` scans up to three levels (skipping `node_modules`, `.git` and similar), counts code files, text documents and binary documents, and recommends: `full` when both code and binary documents are common, `coding` when code dominates, `docs` when documents dominate, otherwise `minimal`. It is a heuristic; it reads file names only.
- Path rules: the coding rule loads only when a source file is read, the docs rule only when a document is read. Each is a few lines, and a line that names a tool is written only when that tool is present.
- Profiles only add. Switching to a smaller profile never uninstalls tools; it keeps what is installed and removes only the rule files it no longer wants. Use `askai uninstall` to remove tools. The profile of the last full install is remembered.
- `--only a,b` overrides the profile for that run and does not change the remembered profile. `--skip a,b` removes components from the selection. `--markitdown` and `--ccusage` add their tool to any profile.

## Claude Code and Cursor

`--target auto` (the default) wires Claude Code, and Cursor as well when `~/.cursor` exists. `--target claude`, `--target cursor` and `--target both` are explicit. In a sandboxed run (`--claude-home`) Cursor is used only when `--cursor-home DIR` names a directory.

| Capability | Claude Code | Cursor |
|---|---|---|
| Shell-output compression (RTK) | Hook in `~/.claude/settings.json` (`rtk init -g --auto-patch`) | Hook in `~/.cursor/hooks.json` (`rtk init -g --agent cursor --auto-patch`) |
| Large-output sandbox (Context Mode) | Plugin: its hooks fire on their own, plus `ctx_*` tools | Global npm package plus an MCP entry in `~/.cursor/mcp.json`. MCP tools only: Cursor does not run Context Mode's hooks, so the always-applied user rule is what steers the agent to the tools |
| Code navigation (Serena) | User-scope MCP server | MCP entry in `~/.cursor/mcp.json` with `--context ide --project-from-cwd` |
| PDF and Office to Markdown (markitdown) | CLI, referenced by the docs rule | Same CLI, referenced by the docs rule |
| Terse replies and token rules | Managed block in `~/.claude/CLAUDE.md` | Always-applied `~/.cursor/rules/askai-tokens.mdc` (every project on this machine) |
| Path-scoped rules | `~/.claude/rules/askai-coding.md`, `askai-docs.md` (`paths:`) | `~/.cursor/rules/askai-coding.mdc`, `askai-docs.mdc` (`globs`), same folder |
| Status line, cache and context figures | Yes | No |
| ccusage and the transcript spend report | Yes (they read Claude Code transcripts) | No: Cursor usage is not measured by askai; use Cursor's own usage view |

Cursor documents machine-local user rules at `~/.cursor/rules` (they stay on this PC and do not sync with the account). `askai install` writes them there, so one install covers every project. `askai-tokens.mdc` is always applied. The code and document rules use globs, so they attach when a matching file is in play.

`askai project` is optional. It writes the same files into one repo's `.cursor/rules/` so they can be committed for teammates who have not run askai. On a machine that already has the user rules, skip it: the always-applied file would be loaded twice.

```powershell
askai project                 # current directory, using the recorded profile
askai project C:\work\app     # a specific project
askai project --print         # show the rules without writing
askai project --remove        # delete the rule files askai wrote in that repo
```

A rule file without askai's marker line is not askai's: it is skipped unless `--force`, and `--remove` never deletes it. `askai uninstall` removes the user rules and the project rules it wrote.

`--cursor-home` only changes where askai looks and writes: RTK's own init writes to the real `~/.cursor`. Whether a given Cursor build follows the glob rules in the user folder the same way it follows project globs is Cursor's behaviour; the always-applied token rule carries the Serena and Context Mode lines either way. The rules cost tokens each time they load; that cost against the savings is not measured.

## Codex and Antigravity

| Capability | OpenAI Codex | Google Antigravity CLI and app |
|---|---|---|
| Token rules + terse style | Managed block in `~/.codex/AGENTS.md` (`codex-rules`) | Managed block in `~/.gemini/GEMINI.md` (`agy-rules`) |
| Cheap defaults | `codex-baseline`: effort medium, verbosity low, no personality section, subagent effort medium (all add-if-absent) | `agy-baseline`: `useG1Credits` is left false; `askai check` warns when it is true |
| Shell-output compression (RTK) | `rtk init -g --codex --auto-patch` (RTK's PreToolUse hook) | `rtk init -g --agent antigravity --auto-patch` (RTK's plugin in `~/.gemini/config/plugins/rtk`) |
| Code navigation (Serena) | `codex mcp add serena -- serena start-mcp-server --context codex --project-from-cwd` | `serena` entry in `~/.gemini/config/mcp_config.json` (`--context ide`) |
| Large-output sandbox (Context Mode) | Supported by Context Mode itself: run its installer (`npx skills add mksglu/context-mode`); askai does not guess its flags | Same |
| Handoff | Ask the agent to write `.ai-work/HANDOFF.md` | Ask the agent to write `.ai-work/HANDOFF.md` |
| AskAI-only terminal | `/prompts:askai-cli` or `$askai-cli` | `/askai-cli` (AskAI skill) |
| Usage figures | `/status`, `/usage`; not read by askai | `/usage`, `/credits`; not read by askai |

`--target auto` adds Codex when `~/.codex` (or `CODEX_HOME`) exists or `codex` is on PATH, and Antigravity when `~/.gemini/antigravity-cli` or `~/.gemini/config` exists or `agy` is on PATH. Restart those tools after an install.

## What it installs

| Component | What it is | How it is delivered | Fires |
|---|---|---|---|
| `token-kit` | Takeover of a previous standalone `token-setup.mjs` run | Only if `~/.token-kit/state.json` exists: runs `standalone/token-setup.mjs --uninstall` (removes its keys, rule blocks and handoff files, with backups) so askai's settings and rules are not applied twice | Once, during install |
| `claude` | Claude Code CLI | winget `Anthropic.ClaudeCode` (Windows); Homebrew cask `claude-code` or `claude.ai/install.sh` (macOS, Linux), only if missing | - |
| `baseline` | The zero-cost settings | `~/.claude/settings.json`: `model` `claude-haiku-5-5` when none is set, `effortLevel` medium, `env.CLAUDE_CODE_SUBAGENT_MODEL=haiku`, `skillOverrides` (rarely used bundled skills to `name-only`). Added only when absent. Retired AskAI defaults are updated. Also removes registrations of the retired askai hook | Every session |
| `rtk` | [RTK](https://github.com/rtk-ai/rtk), **opt-in** (`--rtk`) | winget `rtk-ai.rtk`, then `rtk init -g --auto-patch` (a PreToolUse hook on Bash calls) | Every Bash tool call, automatically |
| `context-mode` | [Context Mode](https://github.com/mksglu/context-mode), **opt-in** (`--context-mode`) | `claude plugin marketplace add mksglu/context-mode`, `claude plugin install context-mode@context-mode` | Plugin hooks fire automatically; the model chooses when to call `ctx_*` tools |
| `serena` | [Serena](https://github.com/oraios/serena) | `uv tool install -p 3.13 serena-agent`, `serena init`, uv's tool bin dir added to the user PATH, `claude mcp add --scope user serena ...` (dashboard off) | The model chooses to call its tools; the `CLAUDE.md` block and the coding rule nudge it |
| `markitdown` | [markitdown](https://github.com/microsoft/markitdown) | `uv tool install -p 3.13 markitdown[...]` (pinned in `lib/components.js`), bin dir on the user PATH. Opt-in: docs and full profiles, or `--markitdown` | When the model runs it, prompted by the docs rule |
| `ccusage` | [ccusage](https://github.com/ryoppippi/ccusage) | `npm install -g ccusage` (Node; version pinned in `lib/components.js`). Opt-in: full profile, or `--ccusage` | On demand, from `askai report` |
| `caveman` | Terse-output directive | Managed block in `~/.claude/CLAUDE.md` (level `--caveman lite\|full\|ultra\|off`, default `full`) | Every session, automatically |
| `rules` | Path-scoped rules | `~/.claude/rules/askai-coding.md` and `askai-docs.md`, as the profile selects | Only when a matching file is read |
| `statusline` | One-line status: RTK's savings, cache hit and context use; Context Mode's line when its CLI exists | `statusLine` in `settings.json`, only if you have none | Every render |
| `caveman-plugin` | The Caveman plugin | Opt-in only: `--caveman-plugin` | Plugin hooks |
| `cursor-rtk`, `cursor-context-mode`, `cursor-serena` | The Cursor twins of `rtk`, `context-mode` and `serena` | See [Claude Code and Cursor](#claude-code-and-cursor) | Cursor's own hook and MCP mechanisms |
| `cursor-rules` | The Cursor twin of the rule files | `~/.cursor/rules/askai-*.mdc` for the profile | Every Cursor chat (token rule); code and document rules when a matching file is in play |
| `codex-baseline`, `codex-rules`, `codex-rtk`, `codex-serena` | The Codex twins of `baseline`, `caveman`, `rtk` and `serena` | See [Codex and Antigravity](#codex-and-antigravity) | Every Codex session |
| `agy-baseline`, `agy-rules`, `agy-rtk`, `agy-serena` | The Antigravity twins of `baseline`, `caveman`, `rtk` and `serena` | See [Codex and Antigravity](#codex-and-antigravity) | Every Antigravity session |
| Session handoff | Ask the agent to update `.ai-work/HANDOFF.md` before a break | Repository-local `.ai-work/HANDOFF.md` | Only when you ask for it |
| `lean` | Lean Claude Code settings (idle drains off, Bash output cap, deny-read rules) | `settings.json`: `promptSuggestionEnabled` false, `bashOutputMaxChars` 15000, `includeGitInstructions` false (`--lean-git` to add this one too); `permissions.deny` `Read()` rules for `node_modules`, build output, lockfiles, minified files and `.env`; also `awaySummaryEnabled` false, `crossSessionInbound` hold and `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` (no idle wake-ups), plus Codex `[tui] auto_recap = false`. In every profile; leave it out with `--skip lean` | Every session |
| `prompt-hooks` | In-session reminders (zero-token Claude Code hooks) | `settings.json` hooks: `SessionStart` and `UserPromptSubmit` → `askai hook` (short reminders shown only to you: context at 60% and 80%, long sessions, peak hours, stale handoff, cache misses) | `SessionStart` and `UserPromptSubmit`; nothing is added to the model's context |
| `agy-path-rules` | The Antigravity twin of `rules` | `~/.gemini/config/rules/askai-<kind>.md` with `trigger: glob` frontmatter | Only when a matching file is touched |
| `code-intel` | Claude Code's official LSP plugins | `--lsp ts,py,kotlin,ruby,swift`: language server (npm for ts/py) + `claude plugin install <lang>-lsp@claude-plugins-official` | When Claude navigates code |
| `headroom` | Headroom (MCP mode: on-demand compression tools, no proxy), **opt-in** (`--headroom`) | `uv tool install --python 3.13 "headroom-ai[mcp]"`, registered as an MCP server in Claude Code, Codex, Cursor and Antigravity. Proxy mode is never set up | The model chooses to call `headroom_compress`, `headroom_retrieve`, `headroom_stats` |
| `context7` | Context7 (current library docs over MCP), **opt-in** (`--context7`) | `npx -y @upstash/context7-mcp` registered as an MCP server in Claude Code, Codex, Cursor and Antigravity | The model calls it only for library docs |
| `repomix` | Repomix (repository snapshot CLI), **opt-in** (`--repomix`) | `npm install -g repomix`, only if missing; nothing loads into any session | On demand, e.g. `repomix --compress --include "src/**"` |
| `graphify` | Graphify (code knowledge graph skill), **opt-in** (`--graphify`) | `uv tool install graphifyy` if missing, then `graphify install --platform <tool>` for each tool in play (a skill, a rule and, in Claude Code, a search hook). The Cursor rule is not left always on | `graphify update .` once per project (source only, no tokens). `/graphify .` also reads docs and images and spends tokens |
| `base-tools` | Base command-line tools (ripgrep, jq, gh) | winget/Homebrew/apt install of `rg`, `jq` and `gh`, only if missing. Opt-in: `--base-tools` | Used ad hoc in place of reading whole files or a GitHub MCP server |
| `codebase-memory` | codebase-memory-mcp (code knowledge-graph MCP server), **opt-in** (`--codebase-memory`) | `npm install -g codebase-memory-mcp`, registered as an MCP server in Claude Code, Codex, Cursor and Antigravity; `askai init` indexes each repository | The model chooses to call its tools |
| `claude-mem` | claude-mem (session memory plugin), **opt-in** (`--claude-mem`) | `claude plugin marketplace add thedotmack/claude-mem`, `claude plugin install claude-mem@thedotmack` | Hooks plus a background worker that summarises sessions, using your plan |

The managed `CLAUDE.md` block also carries four short token rules: state a tool-call limit and a reply-size limit in every subagent prompt, Grep then Read with offset/limit, prefer `ctx_*` tools for large output, prefer Serena symbol tools over reading whole files. The lines about Context Mode and Serena are written only when those tools are installed. The block sits between `<!-- askai:begin ... -->` and `<!-- askai:end -->`; if your `CLAUDE.md` already has a `# Terse output (caveman` heading, the directive is not added a second time.

The versions of markitdown and ccusage that askai installs, and the shape of ccusage's output, come from their package pages and have not been run on this machine. `askai install` prints a plan and asks before installing either.

### Not installed, on purpose

- Serena's reminder hooks (extra per-prompt text).
- The `@caveman-ai/cli` proxy and any `irm | iex` installer.
- The Caveman plugin, unless you pass `--caveman-plugin` (it would double up with the `CLAUDE.md` directive).
- Any hook written by askai beyond the short, zero-token reminders in `prompt-hooks`.
- Any proxy or router in the request path, memory database, or second code-index server (see [the landscape](#the-landscape-what-exists-and-what-askai-uses)).

## How it works with no manual step per prompt

Claude Code reads user-scope configuration when a session starts, for every project:

1. `~/.claude/settings.json` holds the RTK hook, the status line and the baseline values.
2. Plugins (Context Mode) register their own hooks and MCP tools.
3. `~/.claude.json` holds the user-scope Serena MCP server.
4. `~/.claude/CLAUDE.md` holds the terse directive and token rules.
5. `~/.claude/rules/` holds the path-scoped rules, loaded when a matching file is read.

So once `install.ps1` (or `install.sh`) has run and a new session is opened, the rules and settings apply on their own, and with `--rtk` / `--context-mode` RTK compresses Bash output and Context Mode's hooks run too. Serena, markitdown and the `ctx_*` tools are used when the model decides to, which the `CLAUDE.md` block and the rules encourage. Sessions that were already open keep their old configuration.

For Cursor, `~/.cursor/hooks.json` holds RTK's hook, `~/.cursor/mcp.json` holds the MCP servers, and `~/.cursor/rules` holds the token rules. Hooks and MCP servers are read when Cursor starts; the user rules apply in every project. Restart Cursor after install.

## Sessions: break, resume, switch tools

A break longer than about an hour costs you the prompt cache, and a long chat re-sends its whole history on every turn. The cheap pattern is: write a short handoff, start a fresh chat, and point the new chat at the handoff. Nothing here is a hook; it runs only when you run it.

```bash
askai session start --tool claude --task "Fix mobile nav"          # ledger entry: tool, task, branch, last commit
# ask the agent to write a short handoff to .ai-work/HANDOFF.md
askai session pause --summary "menu closes, unit test green" --next "check 320px"
askai session resume      # prints .ai-work/HANDOFF.md, the last ledger lines, and the prompt to paste into ANY of the four agents
askai session measure --tool codex --difficulty simple --task "..." --minutes 25 --input-tokens 9000 --output-tokens 2200 --success 1
askai session report      # accepted tasks and tokens per tool and difficulty (pass several repos to compare)
```

Files live in `<repo>/.ai-work/` (`HANDOFF.md`, `SESSION_LEDGER.md`, `measurements.csv`), and `askai session init` gitignores the folder. `askai scaffold [dir]` writes the per-repo files every agent reads (`AGENTS.md`, `CLAUDE.md` importing it, `docs/ai/PROJECT_PROFILE.md`, `docs/ai/HANDOFF_PROMPTS.md`, `.cursorignore`) and never overwrites one that exists.

## Tips and peak hours

```bash
askai tips            # all of it: habits, then Claude Code, Codex, Antigravity, Cursor and session commands
askai tips codex      # one host (claude | codex | agy | cursor | session | habits)
askai tips peak       # PEAK / off-peak for Claude now, and the peak window in your local time
```

Claude's peak window (announced March 2026) is weekdays 08:00-14:00 US Eastern: a session drains the 5-hour window faster then. In India that is 17:30-23:30 IST while the US is on daylight time and 18:30-00:30 IST after early November. Codex, Antigravity and Cursor publish no time-of-day pricing.

## Seeing what is saved

```powershell
askai report [hours]  # everything in one view (default 6h)
askai status          # profile, per-tool state, where it is wired, measured savings
askai check          # health checks (exit 1 on failure)
askai report --json   # machine-readable; status --json and check --json also exist
```

From `/askai-cli` (Codex: `$askai-cli`), type `report [hours]` or `status` in the AskAI terminal. Claude Code's `/context-mode:ctx-stats` reports the current Context Mode session. The status line shows RTK's running total, and cache hit and context use when Claude Code reports them.

`askai report` prints these sections, each independent, so one failing does not hide the others:

1. **Tools and measured savings**: the profile in effect and the state and wiring of each tool (same as `askai status`).
2. **Health**: the `askai check` checks.
3. **Cache and context per session**: from the snapshots the status line records in `~/.askai/sessions` (kept 14 days): context use, prompt-cache hit, misses per request, re-cache tokens and the last miss cause, for each session in the window. Claude Code reports these figures; AskAI does not recompute them. Cache figures cover the main conversation only, not subagents.
4. **Usage and cost by day** (only when ccusage is installed): ccusage's own output, its first lines only, not parsed.
5. **Spend from transcripts**: a savings ledger, then where tokens went (main conversation against subagents, top sessions by cost). The ledger was written for the retired hook system: most rows read 0 with an evidence label of none, and the skill name-only overrides row is computed from config. Treat its NET line as a floor, not a total.

It exits 1 only when the spend part could not be produced; use `askai check` when you want a failing exit code for health. When Cursor is wired, the report says that its usage is not included.

## Any project or programming language

For a live-machine audit, missing MCP reports, broken Python launchers, or differences between the installed app and a checkout, see [audit and reporting guidance](docs/SUPPORT_WORKFLOWS.md#audit-the-installed-runtime-and-missing-reports). Configured tools are not necessarily connected; compression estimates do not establish subscription savings.

Routine checks: `askai status --brief`. Runtime identity: `askai version --all` or `--json`. Bounded code-graph lookup: `askai graph query "question" --timeout 10 --budget 600`; freshness: `askai graph status`. These commands do not launch AI or rebuild a graph automatically. See [MCP evidence and matched quota plans](docs/SUPPORT_WORKFLOWS.md) for partial telemetry, local exports, and before/after measurement requirements.

Core project selection, handoffs, bounded command output, checks and usage reporting do not require a particular programming language. Initialize any existing folder; unknown stacks use `other`. Automatic language/framework detection and optional navigation plugins have narrower coverage and do not validate every toolchain.

```sh
askai init --path /path/to/project --name myproject --type other --build "your-build-command" --test "your-test-command" --offline --yes
askai map --project myproject
```

Use your actual build/test commands. Init records them without executing them and preserves explicit choices across map and refresh. Keep credentials out of command arguments. Language percentages describe recognized extensions; source symbols/imports are heuristic. Plain CMake and shell wrappers do not imply firmware; a Swift package alone does not imply iOS. Normal `askai cli` launch performs no source review. See [installation guidance](docs/INSTALL.md#custom-projects-and-toolchains).

## Commands

```
askai install [--profile minimal|coding|docs|full|max] [--target auto|claude|codex|agy|cursor|all|a,b] [--only a,b] [--skip a,b]
              [--main-model M] [--subagent-model M] [--codex-model M] [--caveman off|lite|full|ultra] [--lsp ts,py,kotlin,ruby,swift]
              [--lean-git] [--rtk] [--context-mode] [--base-tools] [--headroom] [--graphify] [--context7] [--repomix]
              [--codebase-memory] [--claude-mem] [--markitdown] [--ccusage] [--caveman-plugin]
              [--no-statusline] [--no-path] [--yes] [--dry-run] [--force]
askai profiles | suggest [dir] [--json]          which profile fits what
askai scaffold [dir] [--dry-run]                 repo files every agent reads (never overwrites)
askai init [dir] [--name NAME] [--path DIR] [--about "..."] [--type T] [--build "cmd"] [--test "cmd"] [--refresh] [--yes] [--dry-run]
                                                  project knowledge pack, so /clear can be run freely
askai review status|done [--project NAME]          changed source since AI review; mark done only after host-agent review
askai project [dir] [--print|--remove] [--force] Cursor: the token rules inside one repo
askai project list [--json] | show | rename OLD NEW | path NAME NEW_PATH | remove NAME | switch [NAME]
askai set project NAME|project --clear           active project in askai cli or an integrated terminal
askai set default NAME|default --clear           optional persistent fallback
askai shell init powershell|bash|zsh             shell function for terminal-scoped project selection
--project NAME or -p NAME                        select a registered project for one project-aware command
askai check [dir] [--fix] [--json]              audit the machine and a repo against the token guidelines
askai ask <words>                                offline answers on etiquette and the research
askai start | break | resume [--copy]              ledger entry, before-break checklist, coming back
askai go <claude|codex|cursor|agy> [--tier lead|build|chore] ["task"] [--resume] [--dry-run]
                                                  start a session with the tier's model and effort fixed, a structured prompt
askai prompt "ask" [--tier T] [--kind bug|feature|design|risky] [--mode ...] [--copy] | --output-safe "cmd" | --resume
                                                  turn a rough or dictated ask into a structured prompt
askai models [set <tool>.<tier> <model>[:effort] | verify [tool]]  model and effort per tier, per tool
askai savings [days] [--cache] [--full] [--week] [--repo DIR]      plugin savings, cache hits, and spend from local data
askai session init|pause|status|finish|measure|report [--repo DIR] [...]
askai session pause --summary "..." --next "..." ledger entry at a task boundary, without the break checklist
askai tips [claude|codex|agy|cursor|session|habits|peak]
askai guide [moment|all]                         etiquette for one moment, or all of it. guide work also lists open to-dos
askai context <percent> | --used N --window M    continue, hand off, or clear at this context level
askai diff [dir]                                 git diff --stat, staged changes, whitespace check before handoff
askai graph [dir]                                print the Mermaid architecture diagram in the terminal
askai map [dir] [--dry-run]                      regenerate docs/ai/PROJECT_MAP.md
askai mcp [list | on <name> | off <name>] [--tool claude|codex|cursor|agy] [--dry-run]
                                                  every MCP server in the four tools, and a switch
askai plugins [list | ready [dir] | info <id> | install <id> | decisions]  every token tool researched; ready says when each one is called
askai setup [dir]                                 status, check, infra, plugins, to-do, and the file validator
askai infra [dir] [--json]                       everything AskAI set up, per tool and for the repository
askai audit [dir] [--json]                       the seven-point token audit
askai todo [dir] [--all] | todo done|undo <id>   everything only you can do, per tool and for the repository
askai convert <file|url> [--out file.md]         PDF, Office file, web page or YouTube URL to Markdown, locally
askai docs [install|architecture|projects|guide|cheatsheet|changelog|preview|check] [--print]
askai update | tools update                fetch AskAI, or refresh the tools it installed
askai report [hours] [--json] | status | check [--json]
askai uninstall [--tools] [--force] [--yes] | restore [stamp] [--yes]
askai statusline | version | help [command]
```

Components for `--only` and `--skip`: `token-kit, claude, baseline, rtk, context-mode, serena, markitdown, ccusage, caveman, caveman-plugin, rules, statusline, prompt-hooks, handoff, lean, code-intel, base-tools, graphify, headroom, context7, repomix, codebase-memory, claude-mem, cursor-rtk, cursor-context-mode, cursor-serena, cursor-rules, codex-baseline, codex-rules, codex-rtk, codex-serena, agy-baseline, agy-rules, agy-rtk, agy-serena, agy-path-rules`.

`install.ps1` takes the same choices as parameters:

| Parameter | Meaning |
|---|---|
| `-Action` | `install` (default), `update`, `status`, `check`, `report`, `profiles`, `suggest`, `project`, `restore`, `uninstall` |
| `-Workflow` (alias `-Profile`) | `minimal`, `coding`, `docs`, `full` |
| `-Target` | `auto`, `claude`, `cursor`, `both` |
| `-Markitdown`, `-Ccusage` | Add that tool to the workflow |
| `-Only`, `-Skip` | Comma-separated components |
| `-Path` | Project folder for `-Action suggest` and `-Action project` |
| `-Print`, `-Remove` | With `-Action project` |
| `-Caveman`, `-CavemanPlugin`, `-NoStatusline`, `-NoPath` | As the flags of the same name |
| `-Tools`, `-Force` | uninstall: also remove tools askai installed / things it did not add; install: re-run healthy components |
| `-ClaudeHome`, `-CursorHome` | Testing aids: use these folders instead of `~/.claude` and `~/.cursor` |
| `-Yes`, `-DryRun` | Skip the confirmation; show the plan only |
| `-Lean`, `-MainModel`, `-SubagentModel`, `-CodexModel` | As `--lean`, `--main-model`, `--subagent-model`, `--codex-model` |
| `-CodexHome`, `-AgyHome` | Testing aids: use these folders instead of `~/.codex` and `~/.gemini` |
| `-Topic` | With `-Action tips`: one host |

`askai` is copied to `~/.askai/app` and a shim is placed in `~/.askai/bin` on a fresh install (added to the user PATH unless `--no-path`). Existing installations under `~/.claude/askai` remain supported. Use `askai update` to refresh AskAI itself.

## Safety

- Idempotent: components that already look healthy are skipped; `--force` re-runs them.
- Existing tools are detected and never reinstalled.
- Before `settings.json`, `CLAUDE.md`, `~/.claude.json`, or Cursor's `mcp.json` and `hooks.json` are changed, the file is copied to `~/.askai/backups/<timestamp>/` on a fresh install. `askai restore` lists and restores them.
- An unparseable `settings.json` or `~/.claude.json` stops the run; askai never overwrites a file it could not read.
- `askai uninstall` removes only what AskAI added, recorded in `~/.askai/manifest.json` on a fresh install. A tool, hook, MCP entry or rule file you set up yourself is left in place and named; `--force` removes it too, `--tools` also uninstalls tools AskAI installed through winget, uv or npm. Backups are kept.
- Non-interactive runs refuse to change anything without `--yes`.
- `--dry-run` writes nothing and installs nothing; it prints the plan.
- `RTK_TELEMETRY_DISABLED=1` is set for the RTK commands askai runs.
- askai never enters credentials. Sign-ins some tools need are left to the tool.
- `askai check` warns about the settings that silently move you off your subscription: `ANTHROPIC_API_KEY` (Claude Code uses it instead of your plan, and `claude -p` always does), `ANTHROPIC_BASE_URL` (a proxy), `OPENAI_API_KEY`, and Antigravity's `useG1Credits: true`.

## Known risks

- RTK and Context Mode both hook Bash tool calls. Their interaction is unverified; `askai check` warns when more than one such hook is registered.
- Serena and Context Mode add MCP servers. Claude Code defers MCP tool definitions by default, so the per-session cost should be small, but it is not measured here and not zero (each server is a process that starts with the session).
- Serena writes a `.serena/` folder into projects it works in.
- uv keeps a `cpython-X.Y-<platform>` minor-version link (a junction on Windows) next to each Python it downloads. A link whose target folder is missing makes `uv tool install` fail with "Missing expected target directory for Python minor version link". Before the install, and again after a failure that names such a link, askai removes dangling links inside uv's python directory (only the link; the Python folder is never touched) and retries once. The root cause of the broken link is not known.
- Serena's ownership is recorded as soon as the `uv tool install` step succeeds, so `askai uninstall --tools` removes `serena-agent` even when a later step failed. If an earlier askai run failed at the uv step and you finished the install by hand, the next `askai install --only serena --force` treats Serena as askai's; that guess is wrong if you had installed Serena yourself independently. A Serena that askai did not install is left alone unless `--force` is given.
- Serena's tool bin dir (`~/.local/bin` for uv) is added to the user PATH so `serena` works in a shell. An already-ok Serena is skipped by a normal install, so use `askai install --only serena --force` to get the PATH entry on a machine that has Serena already. `askai uninstall --tools` removes that PATH entry again, but only if askai added it.
- If you install the Caveman plugin as well as the `CLAUDE.md` directive, terse instructions are duplicated; `askai check` flags it.
- RTK needs `rg` for some filters (`winget install BurntSushi.ripgrep.MSVC`).
- Rule files are input tokens each time they load. They are short and path-scoped, but whether a profile's rules save more than they cost has not been measured.
- markitdown and ccusage are third-party packages askai has not run on this machine: their licences, command-line behaviour, and (for ccusage) output format and price lookups are unverified. Cursor documents `~/.cursor/rules` as machine-local user rules; glob attachment from that folder, as opposed to a project's `.cursor/rules`, is Cursor's behaviour (see [Claude Code and Cursor](#claude-code-and-cursor)).
- Unverified until first real run: whether `serena init` prompts (it runs with stdin closed and a timeout, failure allowed), whether the `context-mode` CLI ends up on PATH, the shape of `claude plugin list --json` with plugins present, and whether `rtk init -g --uninstall` needs `--auto-patch` (askai falls back to removing the hook entry itself).
- `--claude-home DIR` and `--cursor-home DIR` are testing aids: RTK's own `init -g` may still write to the real `~/.claude` and `~/.cursor`, and running status or check against them lets the real Claude CLI create its own files there.
- askai's status, check and install call `claude plugin list --json`. The Claude CLI itself may migrate values in `settings.json` when it runs (observed on Claude Code 2.1.281: `"model": "opus"` became `"opus[1m]"`). That is the CLI's behaviour, not askai's, and it can happen before askai's own backup of that file.

- Codex and Antigravity wiring follows each vendor's documentation (October 2026), but has not had a real first run on a machine with those tools: whether `rtk init -g --codex` and `--agent antigravity` accept `--auto-patch`, the exact shape of `codex mcp add`, and whether Antigravity's app reads `~/.gemini/config/skills` as documented. Start with `--dry-run`, then `askai check`.
- On macOS and Linux askai runs the vendors' installer scripts (`claude.ai/install.sh`, `astral.sh/uv/install.sh`) when Homebrew is absent; the install plan names each URL before the one confirmation. If `astral.sh` is blocked, uv is installed with `python3 -m pip install --user uv` from PyPI. It never prompts for a password: ripgrep and `gh` without Homebrew are a manual `apt`/`dnf` step. On a headless Linux machine, upgrade, update, and setup install `tmux` when the user is root or `sudo -n` works.
- `--main-model` is applied only when `settings.json` has no `model`. The default is `claude-haiku-5-5`. If you rely on Opus for everyday work, pass `--main-model keep`.

## Tests

```powershell
npm test        # node --test test/*.test.js, needs Node 21+ for the glob
npm run test:commands  # all command entry points; two-project setup, infra and uninstall in temporary folders
```

Tests use throwaway folders under the OS temp dir with fake process runners: nothing installs software, touches the network, or writes to your real `~/.claude` or `~/.cursor`. The two `report` tests only read your real Claude Code transcripts (`~/.claude/projects`), because that is what the spend section reports on. Three tests need `bash` (and one also `git`) and are skipped where neither is on PATH, such as plain Windows without Git Bash or WSL.

## Repository layout

- `install.ps1`: Windows entry point (Node check, then `askai.js`). `install.sh`: the same for macOS, Linux and WSL, plus the PATH line.
- `askai.js`: the CLI — parses flags and dispatches to every command below.
- `lib/components.js`: one entry per tool (detect, install, uninstall), for Claude Code and Cursor.
- `lib/agents.js`: the Codex and Antigravity components, the handoff and the lean settings. `lib/pkg.js`: winget, Homebrew, installer scripts, cargo. `lib/toml-lite.js`: add-if-absent edits of Codex's `config.toml`.
- `lib/profiles.js`: the profiles and how a run's component set is chosen.
- `lib/rules.js`: the path-scoped rules, as `~/.claude/rules` files and Cursor `.mdc` files.
- `lib/cursor.js`: Cursor config paths, `mcp.json` and `hooks.json` edits, user and project rule files.
- `lib/claude-config.js`: safe edits of `settings.json` and `CLAUDE.md`, backups, manifest.
- `lib/status.js`, `lib/sys.js`, `lib/winpath.js`: status/check/cache views, process helpers, user PATH edit.
- `lib/mcp.js`: `askai mcp` — list, on/off and park/unpark for every MCP server across the four tools.
- `lib/models.js`: `askai models` — model and effort per task tier, per tool.
- `lib/plugins.js`, `lib/plugins-ready.js`, `lib/usage-guide.js`: `askai plugins` — the researched tool catalogue, `askai plugins ready`, and each one's usage guide.
- `lib/infra.js`: `askai infra` — everything askai set up, per tool and for the repository.
- `lib/audit.js`: `askai audit` — the seven-point token audit.
- `lib/savings.js`: `askai savings` — each installed plugin's own savings report.
- `lib/todo.js`: `askai todo` — what only you can do, with auto-clearing checks.
- `lib/check.js`, `lib/suggest.js`: `askai check` (machine and repo audit against the guide) and the directory scan behind `askai suggest`.
- `lib/project.js`, `lib/kb.js`: `askai init`/`askai map` (the project knowledge pack) and `askai ask` (the offline etiquette knowledge base).
- `lib/project-registry.js`, `lib/project-shell.js`: project names, shared path resolution and terminal-scoped selection. The registry lives in `~/.askai/projects.json`; project notes remain in each repository.
- `lib/session.js`, `lib/scaffold.js`, `lib/tips.js`, `lib/launch.js`, `lib/prompt.js`, `lib/guide.js`: `askai session`, `scaffold`, `tips`/`peak`, `go`, `prompt`, and `guide`/`clear`/`context`/`work`/`etiquette`. `templates/`: the files scaffold and session write.
- `lib/help.js`: one entry per command; also the source `scripts/gen-docs.js` reads for the command reference in `docs/ARCHITECTURE.md`.
- `hooks/askai-report.js`: transcript-based spend report used by `askai report`. `lib/hook.js`: the Claude Code reminder hooks (`askai hook`), invoked by Claude Code itself, not typed by you.
- `commands/`: `/askai-cli` sets up a project and opens the terminal. `/askai-plugins` finishes one-time plugin setup and says when each connected tool is called. Claude Code, Cursor, and Antigravity install both. Codex gets the prompts and the `$askai-cli` and `$askai-plugins` skills. Earlier AskAI command files are retired during installation when AskAI still owns them.
- `legacy/`: the retired self-built hook system and its installer. Not used by anything above.
- `test/`: the test suite.

Windows terminal launch uses a visible PowerShell window in the selected project folder. If no window appears, run `askai cli` in your terminal. Uninitialized folders show `askai init --path "<project-folder>"` at startup; initialization is never automatic.

Interactive AskAI terminals restore key editing when an AI host exports TERM=dumb, so Backspace and Delete work normally. After upgrading, exit and reopen an existing AskAI shell to load current category help.

Use askai check as the single health command. It lists coverage for all four tools; passing details are hidden unless --all. doctor is retired and prints a migration hint only.

Status: askai status shows Codex, Antigravity, Cursor and Claude Code in four columns, with shared local tools below. Use askai status codex or askai status --host antigravity to select one environment; --json uses the same filter. Widen the terminal for the four-column view.

## Linux containers and terminal output

AskAI wraps audit evidence and help options without truncation, keeps table columns aligned, and adapts status to terminal width. Infra reports missing base tools, configuration-versus-desktop limits and remote MCP checks. See [the container command review](docs/CONTAINER_REVIEW.md), or run askai docs container --print.

## Explicit support workflows

Use askai mcp verify --tool cursor for a bounded stdio server probe, askai session quota to record dashboard observations, askai project build to discover existing build presets, and askai resume --copy for clipboard transfer with a saved-file fallback. These are explicit operations; server responsiveness is not an editor connection, quota differences are not proven savings, and firmware boards are never guessed. See [support workflows](docs/SUPPORT_WORKFLOWS.md) or askai docs support --print.
