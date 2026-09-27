# askai

askai installs and wires up existing token-saving tools for Claude Code and Cursor on a Windows machine, chooses the set by the kind of work (coding, documents, both, or minimal), and shows the savings those tools measure. It does not ship hooks of its own.

Background: the earlier self-built askai hook system was measured net negative over 7 days (it cost 26.38M units against 248.6K computed savings, NET -26.14M, -2.60% of the 940.15M spent). Its files are kept in `legacy/` for reference only. This version installs tools other people maintain and registers them once, globally, so they work in every project without any per-prompt step.

Contents: [Quick start](#quick-start) | [The landscape](#the-landscape-what-exists-and-what-askai-uses) | [Why this combination](#why-this-combination) | [Profiles](#profiles-different-tools-for-different-work) | [Claude Code and Cursor](#claude-code-and-cursor) | [What it installs](#what-it-installs) | [Seeing what is saved](#seeing-what-is-saved) | [Commands](#commands) | [Safety](#safety) | [Known risks](#known-risks) | [Tests](#tests) | [Layout](#repository-layout)

## Quick start

```powershell
git clone <this repo> askai; cd askai
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action suggest -Path C:\work\my-project   # which profile fits a folder (read-only)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun                                     # the plan, changes nothing
powershell -ExecutionPolicy Bypass -File .\install.ps1                                             # do it (asks once before changing anything)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Workflow docs                              # a different kind of work
```

`install.ps1` makes sure Node.js 22.5+ is present (winget `OpenJS.NodeJS.LTS`, with a prompt), then runs `askai.js install`. With no `-Workflow` the `coding` profile is used. Open a new Claude Code session afterwards: settings, hooks, plugins, MCP servers and `CLAUDE.md` are read at session start. Cursor reads its MCP servers and hooks when it starts, and project rules when a project is opened; run `askai project` in each project you want the rules in.

## The landscape: what exists and what askai uses

Token use in an agent session comes from a handful of sources, and each tool below attacks one of them. "In askai" says what this repo does with it. Nothing here was installed or benchmarked just for this table: it comes from reading each project's own documentation and repositories, so vendor figures are the vendor's.

| Token sink | Tool or workflow | What it does | In askai |
|---|---|---|---|
| Shell command output | [RTK](https://github.com/rtk-ai/rtk) | Rewrites Bash commands so their output is filtered before the model reads it | **Yes, every profile** (default choice) |
| | [Headroom](https://github.com/headroomlabs-ai/headroom) | Compression layer for context and tool output | No: overlaps RTK and Context Mode; not evaluated here |
| | [Token Optimizer MCP](https://github.com/ooples/token-optimizer-mcp) | MCP proxy: caches/compresses tool output, AST-based code nav, SQLite-backed dedup | No: overlaps RTK, Context Mode and Serena all at once; savings are vendor self-reported (60-90%), not independently benchmarked |
| Large tool output, logs, scraped pages | [Context Mode](https://github.com/mksglu/context-mode) | Runs and indexes large output in a sandbox, hands the model a summary; keeps session memory across compactions | **Yes, coding and docs** |
| Session memory across sessions | claude-mem and similar | Records sessions and injects recalled context | No: adds hooks and a database; Context Mode already covers session continuity |
| Reading whole source files | [Serena](https://github.com/oraios/serena) | Language-server symbol navigation: overview, find symbol, references | **Yes, coding** |
| | [Token Savior](https://github.com/mibayy/token-savior), jCodeMunch, code-review-graph, claude-context | Other code-index or code-graph MCP servers | No: one code-navigation server is enough; Serena has the widest language support of these and no index to build. Not benchmarked against each other here |
| | Claude Code LSP / code-intelligence plugins | First-party route to go-to-definition and diagnostics | No: not evaluated; Serena works in Cursor too |
| Verbose replies | [Caveman](https://github.com/JuliusBrussee/caveman) style, as a managed `CLAUDE.md` block | Terse-output directive; short token rules | **Yes, every profile** (as text in `CLAUDE.md`, not the plugin) |
| | [claude-token-efficient](https://github.com/drona23/claude-token-efficient) | Ready-made `CLAUDE.md` profiles that ask for concise output | No: a large always-loaded file costs tokens every session; askai keeps the block to a few lines |
| Always-loaded instructions | Path-scoped rules (`~/.claude/rules/*.md` with `paths:`; Cursor `.mdc` with `globs`) | A rule loads only when a matching file is read | **Yes, per profile** (`rules` component) |
| Binary documents (PDF, Office) | [markitdown](https://github.com/microsoft/markitdown) | Converts a document to Markdown once, so it is read as text | **Yes, docs and full** |
| Library documentation lookups | Context7 | MCP server that fetches current library docs | No: it saves searching, not tokens in general; add it yourself if you need it |
| Model cost, not tokens | claude-code-router, LiteLLM | Proxy that routes requests to cheaper models | No: puts a proxy in the request path. The cheap first-party version is used instead: `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` |
| Usage and cost reporting | [ccusage](https://github.com/ryoppippi/ccusage) | Reads local Claude Code transcripts, prints usage and cost per day | **Yes, opt-in (full profile or `--ccusage`)**; reports, saves nothing |
| | Claude-Code-Usage-Monitor | Live terminal view of limits and burn rate | No: ccusage covers reporting |
| | Claude Code `/usage`, `/context`, OpenTelemetry export | First-party views and metrics | Used as they are; not wrapped |
| | Status line `prompt_cache` and `context_window` fields | Claude Code reports cache hit and context use to the status line command | **Yes**: `askai statusline` records them per session (Claude Code v2.1.251+) |
| Built into Claude Code | Prompt caching, `/compact` and `autoCompactWindow`, `/clear`, `/effort`, subagent model, skills, MCP tool-definition deferral, output styles | Native levers | Baseline settings (`autoCompactWindow`, subagent model, `skillOverrides`); the rest are habits, not something to install |

Names without a link were found in searches while researching this; find the official repository yourself before installing any of them.

### Evidence labels

Every claim about a saving in this README, in `askai status` and in `askai report` falls in one of these:

| Label | Meaning | Examples |
|---|---|---|
| Measured by the tool | The tool counts it itself; askai prints the number as given | RTK's `rtk gain` (RTK's own token estimate, cross-session) |
| Tool-reported, per session | The tool reports it per session | Context Mode's `/context-mode:ctx-stats` |
| Reported by Claude Code | Figures Claude Code hands to the status line | Context use, prompt-cache hit, re-cache tokens, last miss cause |
| Third-party report | Another program's own output, shown and not parsed | ccusage |
| Not measured | No counter exists, so askai shows no number and claims none | Serena, markitdown, Caveman, path-scoped rules |
| Vendor claim | A figure from a project's own README | RTK's 60-90% and Context Mode's 98% style headline reductions: not verified here |

The net effect of the whole stack is unproven. The spend section of `askai report` reads the Claude Code transcripts and shows where tokens actually went; use it to check that the stack helps.

## Why this combination

askai installs a specific subset. The reasons, in order of weight:

1. **One tool per sink, no overlap.** Shell output goes to RTK, big tool output to Context Mode, source reading to Serena, binary documents to markitdown, reply length to the Caveman block, always-loaded text to path-scoped rules. Two tools competing for the same sink would both add overhead for one saving. RTK and Context Mode do both touch Bash calls, which is the one known overlap (see [Known risks](#known-risks)); the alternatives (Headroom, a second index server) would add more.
2. **No always-on cost that is not earned.** RTK's hook runs locally and adds no model tokens. Rule files are path-scoped, so a coding rule costs nothing in a document session. The `CLAUDE.md` block is a few lines. Serena and Context Mode are MCP servers, whose tool definitions Claude Code defers by default rather than loading in full each session; that is a small cost, and it is not measured here.
3. **Nothing self-built.** The earlier askai hooks were the largest single cost in the measured ledger. Everything installed now is maintained by someone else, and askai registers no hooks of its own.
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
| `minimal` | Base only | none | Shell-output compression, terse replies, settings baseline, status line; no MCP servers or plugins |
| `coding` (default) | Base + Context Mode + Serena | coding | Source code work |
| `docs` | Base + Context Mode + markitdown | docs | Writing and reading documents, PDFs and Office files; no code navigation |
| `full` | Base + Context Mode + Serena + markitdown + ccusage | coding + docs | Mixed work, plus the usage report |

The base is `claude`, `baseline`, `rtk`, `caveman`, `statusline` and `rules` (the rule files a profile selects).

- `askai suggest [dir]` scans up to three levels (skipping `node_modules`, `.git` and similar), counts code files, text documents and binary documents, and recommends: `full` when both code and binary documents are common, `coding` when code dominates, `docs` when documents dominate, otherwise `minimal`. It is a heuristic; it reads file names only.
- Path rules: the coding rule loads only when a source file is read, the docs rule only when a document is read. Each is a few lines, and a line that names a tool is written only when that tool is present.
- Profiles only add. Switching to a smaller profile never uninstalls tools; it keeps what is installed and removes only the rule files it no longer wants. Use `askai uninstall` to remove tools. The profile of the last full install is remembered.
- `--only a,b` overrides the profile for that run and does not change the remembered profile. `--skip a,b` removes components from the selection. `--markitdown` and `--ccusage` add their tool to any profile.

## Claude Code and Cursor

`--target auto` (the default) wires Claude Code, and Cursor as well when `~/.cursor` exists. `--target claude`, `--target cursor` and `--target both` are explicit. In a sandboxed run (`--claude-home`) Cursor is used only when `--cursor-home DIR` names a directory.

| Capability | Claude Code | Cursor |
|---|---|---|
| Shell-output compression (RTK) | Hook in `~/.claude/settings.json` (`rtk init -g --auto-patch`) | Hook in `~/.cursor/hooks.json` (`rtk init -g --agent cursor --auto-patch`) |
| Large-output sandbox (Context Mode) | Plugin: its hooks fire on their own, plus `ctx_*` tools | Global npm package plus an MCP entry in `~/.cursor/mcp.json`. MCP tools only: Cursor does not run Context Mode's hooks, so the always-applied project rule is what steers the agent to the tools |
| Code navigation (Serena) | User-scope MCP server | MCP entry in `~/.cursor/mcp.json` with `--context ide --project-from-cwd` |
| PDF and Office to Markdown (markitdown) | CLI, referenced by the docs rule | Same CLI, referenced by the docs rule |
| Terse replies and token rules | Managed block in `~/.claude/CLAUDE.md` | Always-applied `.cursor/rules/askai-tokens.mdc` in each project |
| Path-scoped rules | `~/.claude/rules/askai-coding.md`, `askai-docs.md` (`paths:`) | `.cursor/rules/askai-coding.mdc`, `askai-docs.mdc` (`globs`), per project |
| Status line, cache and context figures | Yes | No |
| ccusage and the transcript spend report | Yes (they read Claude Code transcripts) | No: Cursor usage is not measured by askai; use Cursor's own usage view |

Cursor has no file-based user-level rules, so the terse block and the path rules live in each project. Write them with:

```powershell
askai project                 # current directory, using the recorded profile
askai project C:\work\app     # a specific project
askai project --print         # show the rules without writing
askai project --remove        # delete the rule files askai wrote
```

A rule file without askai's marker line is not askai's: it is skipped unless `--force`, and `--remove` never deletes it. `askai uninstall` removes the project rules it wrote in every project it recorded.

Cursor points that are not verified on this machine (state them to yourself before relying on them): RTK's `--agent cursor` init writes only to Cursor's files and leaves Claude Code's untouched; `rtk init --agent cursor` can be reversed cleanly; Serena's `ide` context behaves as its documentation describes; Cursor can start a globally installed npm command through its Windows `.cmd` shim; Cursor reads the expanded globs askai writes; and the rules cost less context than they save. `--cursor-home` only changes where askai looks and writes: RTK's own init writes to the real `~/.cursor`.

## What it installs

| Component | What it is | How it is delivered | Fires |
|---|---|---|---|
| `claude` | Claude Code CLI | winget `Anthropic.ClaudeCode`, only if missing | - |
| `baseline` | The three zero-cost settings | `~/.claude/settings.json`: `autoCompactWindow` 150000, `env.CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `skillOverrides` (rarely used bundled skills to `name-only`). Added only when absent, never overriding your values. Also removes registrations of the retired askai hook | Every session |
| `rtk` | [RTK](https://github.com/rtk-ai/rtk) | winget `rtk-ai.rtk`, then `rtk init -g --auto-patch` (a PreToolUse hook on Bash calls) | Every Bash tool call, automatically |
| `context-mode` | [Context Mode](https://github.com/mksglu/context-mode) | `claude plugin marketplace add mksglu/context-mode`, `claude plugin install context-mode@context-mode` | Plugin hooks fire automatically; the model chooses when to call `ctx_*` tools |
| `serena` | [Serena](https://github.com/oraios/serena) | `uv tool install -p 3.13 serena-agent`, `serena init`, uv's tool bin dir added to the user PATH, `claude mcp add --scope user serena ...` (dashboard off) | The model chooses to call its tools; the `CLAUDE.md` block and the coding rule nudge it |
| `markitdown` | [markitdown](https://github.com/microsoft/markitdown) | `uv tool install -p 3.13 markitdown[...]` (pinned in `lib/components.js`), bin dir on the user PATH. Opt-in: docs and full profiles, or `--markitdown` | When the model runs it, prompted by the docs rule |
| `ccusage` | [ccusage](https://github.com/ryoppippi/ccusage) | `npm install -g ccusage` (Node; version pinned in `lib/components.js`). Opt-in: full profile, or `--ccusage` | On demand, from `askai report` |
| `caveman` | Terse-output directive | Managed block in `~/.claude/CLAUDE.md` (level `--caveman lite\|full\|ultra\|off`, default `full`) | Every session, automatically |
| `rules` | Path-scoped rules | `~/.claude/rules/askai-coding.md` and `askai-docs.md`, as the profile selects | Only when a matching file is read |
| `statusline` | One-line status: RTK's savings, cache hit and context use; Context Mode's line when its CLI exists | `statusLine` in `settings.json`, only if you have none | Every render |
| `caveman-plugin` | The Caveman plugin | Opt-in only: `--caveman-plugin` | Plugin hooks |
| `cursor-rtk`, `cursor-context-mode`, `cursor-serena` | The Cursor twins of `rtk`, `context-mode` and `serena` | See [Claude Code and Cursor](#claude-code-and-cursor) | Cursor's own hook and MCP mechanisms |

The managed `CLAUDE.md` block also carries four short token rules: state a tool-call limit and a reply-size limit in every subagent prompt, Grep then Read with offset/limit, prefer `ctx_*` tools for large output, prefer Serena symbol tools over reading whole files. The lines about Context Mode and Serena are written only when those tools are installed. The block sits between `<!-- askai:begin ... -->` and `<!-- askai:end -->`; if your `CLAUDE.md` already has a `# Terse output (caveman` heading, the directive is not added a second time.

The versions of markitdown and ccusage that askai installs, and the shape of ccusage's output, come from their package pages and have not been run on this machine. `askai install` prints a plan and asks before installing either.

### Not installed, on purpose

- Serena's reminder hooks (extra per-prompt text).
- The `@caveman-ai/cli` proxy and any `irm | iex` installer.
- The Caveman plugin, unless you pass `--caveman-plugin` (it would double up with the `CLAUDE.md` directive).
- Any hook written by askai.
- Any proxy or router in the request path, memory database, or second code-index server (see [the landscape](#the-landscape-what-exists-and-what-askai-uses)).

## How it works with no manual step per prompt

Claude Code reads user-scope configuration when a session starts, for every project:

1. `~/.claude/settings.json` holds the RTK hook, the status line and the baseline values.
2. Plugins (Context Mode) register their own hooks and MCP tools.
3. `~/.claude.json` holds the user-scope Serena MCP server.
4. `~/.claude/CLAUDE.md` holds the terse directive and token rules.
5. `~/.claude/rules/` holds the path-scoped rules, loaded when a matching file is read.

So once `install.ps1` has run and a new session is opened, RTK compresses Bash output and Context Mode's hooks run on their own. Serena, markitdown and the `ctx_*` tools are used when the model decides to, which the `CLAUDE.md` block and the rules encourage. Sessions that were already open keep their old configuration.

For Cursor, `~/.cursor/hooks.json` holds RTK's hook and `~/.cursor/mcp.json` holds the MCP servers; both are read when Cursor starts. The project rules apply per project.

## Seeing what is saved

```powershell
askai report [hours]  # everything in one view (default 6h)
askai status          # profile, per-tool state, where it is wired, measured savings
askai doctor          # health checks (exit 1 on failure)
askai report --json   # machine-readable; status --json and doctor --json also exist
```

Inside Claude Code: `/askai-report [hours]` (everything), `/askai-status` (tools only), and `/context-mode:ctx-stats` for the current session. The status line shows RTK's running total, and cache hit and context use when Claude Code reports them.

`askai report` prints these sections, each independent, so one failing does not hide the others:

1. **Tools and measured savings**: the profile in effect and the state and wiring of each tool (same as `askai status`).
2. **Health**: the `askai doctor` checks.
3. **Cache and context per session**: from the snapshots the status line records in `~/.claude/askai/sessions` (kept 14 days): context use, prompt-cache hit, misses per request, re-cache tokens and the last miss cause, for each session in the window. Claude Code reports these figures; askai does not recompute them. A high re-cache figure means a long prefix was written to the cache again, after idle time or a changed prefix. Cache figures cover the main conversation only, not subagents. Claude Code v2.1.251 or later sends the `prompt_cache` field; on older versions the columns are empty.
4. **Usage and cost by day** (only when ccusage is installed): ccusage's own output, its first lines only, not parsed.
5. **Spend from transcripts**: a savings ledger, then where tokens went (main conversation against subagents, top sessions by cost). The ledger was written for the retired hook system: most rows read 0 with an evidence label of none, and the skill name-only overrides row is computed from config. Treat its NET line as a floor, not a total.

It exits 1 only when the spend part could not be produced; use `askai doctor` when you want a failing exit code for health. When Cursor is wired, the report says that its usage is not included.

## Commands

```
askai install [--profile minimal|coding|docs|full] [--target auto|claude|cursor|both] [--markitdown] [--ccusage]
              [--only a,b] [--skip a,b] [--caveman LEVEL] [--caveman-plugin] [--no-statusline] [--no-path]
              [--yes] [--dry-run] [--force]
askai profiles                     list the profiles and what each installs
askai suggest [dir] [--json]       which profile fits a directory (read-only)
askai project [dir] [--print|--remove] [--force]   Cursor: write, show or remove the token rules for a project
askai update                       refresh askai's own copy and upgrade the tools it manages (skips what is not installed)
askai report [hours] [--json]      everything in one view
askai status | doctor [--json]     sections 1 and 2 of report, on their own
askai uninstall [--tools] [--force] [--yes]
askai restore [stamp] [--yes]      list backups, or put a backed-up file back
askai statusline                   what Claude Code's statusLine calls
askai version
```

Components for `--only` and `--skip`: `claude, baseline, rtk, context-mode, serena, markitdown, ccusage, caveman, caveman-plugin, rules, statusline, cursor-rtk, cursor-context-mode, cursor-serena`.

`install.ps1` takes the same choices as parameters:

| Parameter | Meaning |
|---|---|
| `-Action` | `install` (default), `update`, `status`, `doctor`, `report`, `profiles`, `suggest`, `project`, `restore`, `uninstall` |
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

`askai` is copied to `~/.claude/askai/app` and a shim is placed in `~/.claude/askai/bin` (added to the user PATH unless `--no-path`). To update askai itself, run `install.ps1` from a fresh checkout.

## Safety

- Idempotent: components that already look healthy are skipped; `--force` re-runs them.
- Existing tools are detected and never reinstalled.
- Before `settings.json`, `CLAUDE.md`, `~/.claude.json`, or Cursor's `mcp.json` and `hooks.json` are changed, the file is copied to `~/.claude/askai/backups/<timestamp>/`. `askai restore` lists and restores them.
- An unparseable `settings.json` or `~/.claude.json` stops the run; askai never overwrites a file it could not read.
- `askai uninstall` removes only what askai added, recorded in `~/.claude/askai/manifest.json`. A tool, hook, MCP entry or rule file you set up yourself is left in place and named; `--force` removes it too, `--tools` also uninstalls tools askai installed through winget, uv or npm. Backups are kept.
- Non-interactive runs refuse to change anything without `--yes`.
- `--dry-run` writes nothing and installs nothing; it prints the plan.
- `RTK_TELEMETRY_DISABLED=1` is set for the RTK commands askai runs.
- askai never enters credentials. Sign-ins some tools need are left to the tool.

## Known risks

- RTK and Context Mode both hook Bash tool calls. Their interaction is unverified; `askai doctor` warns when more than one such hook is registered.
- Serena and Context Mode add MCP servers. Claude Code defers MCP tool definitions by default, so the per-session cost should be small, but it is not measured here and not zero (each server is a process that starts with the session).
- Serena writes a `.serena/` folder into projects it works in.
- uv keeps a `cpython-X.Y-<platform>` minor-version link (a junction on Windows) next to each Python it downloads. A link whose target folder is missing makes `uv tool install` fail with "Missing expected target directory for Python minor version link". Before the install, and again after a failure that names such a link, askai removes dangling links inside uv's python directory (only the link; the Python folder is never touched) and retries once. The root cause of the broken link is not known.
- Serena's ownership is recorded as soon as the `uv tool install` step succeeds, so `askai uninstall --tools` removes `serena-agent` even when a later step failed. If an earlier askai run failed at the uv step and you finished the install by hand, the next `askai install --only serena --force` treats Serena as askai's; that guess is wrong if you had installed Serena yourself independently. A Serena that askai did not install is left alone unless `--force` is given.
- Serena's tool bin dir (`~/.local/bin` for uv) is added to the user PATH so `serena` works in a shell. An already-ok Serena is skipped by a normal install, so use `askai install --only serena --force` to get the PATH entry on a machine that has Serena already. `askai uninstall --tools` removes that PATH entry again, but only if askai added it.
- If you install the Caveman plugin as well as the `CLAUDE.md` directive, terse instructions are duplicated; `askai doctor` flags it.
- RTK needs `rg` for some filters (`winget install BurntSushi.ripgrep.MSVC`).
- Rule files are input tokens each time they load. They are short and path-scoped, but whether a profile's rules save more than they cost has not been measured.
- markitdown and ccusage are third-party packages askai has not run on this machine: their licences, command-line behaviour, and (for ccusage) output format and price lookups are unverified. Cursor's behaviour with the entries askai writes is unverified (see [Claude Code and Cursor](#claude-code-and-cursor)).
- Unverified until first real run: whether `serena init` prompts (it runs with stdin closed and a timeout, failure allowed), whether the `context-mode` CLI ends up on PATH, the shape of `claude plugin list --json` with plugins present, and whether `rtk init -g --uninstall` needs `--auto-patch` (askai falls back to removing the hook entry itself).
- `--claude-home DIR` and `--cursor-home DIR` are testing aids: RTK's own `init -g` may still write to the real `~/.claude` and `~/.cursor`, and running status or doctor against them lets the real Claude CLI create its own files there.
- askai's status, doctor and install call `claude plugin list --json`. The Claude CLI itself may migrate values in `settings.json` when it runs (observed on Claude Code 2.1.281: `"model": "opus"` became `"opus[1m]"`). That is the CLI's behaviour, not askai's, and it can happen before askai's own backup of that file.

## Tests

```powershell
npm test        # node --test test/*.test.js, needs Node 21+ for the glob
```

166 tests against throwaway folders under the OS temp dir with fake process runners: nothing installs software, touches the network, or writes to your real `~/.claude` or `~/.cursor`. The two `report` tests only read your real Claude Code transcripts (`~/.claude/projects`), because that is what the spend section reports on.

## Repository layout

- `install.ps1`: Windows entry point (Node check, then `askai.js`).
- `askai.js`: CLI (install, update, status, doctor, report, profiles, suggest, project, uninstall, restore, statusline).
- `lib/components.js`: one entry per tool (detect, install, uninstall), for Claude Code and Cursor.
- `lib/profiles.js`: the profiles and how a run's component set is chosen.
- `lib/rules.js`: the path-scoped rules, as `~/.claude/rules` files and Cursor `.mdc` files.
- `lib/cursor.js`: Cursor config paths, `mcp.json` and `hooks.json` edits, project rule files.
- `lib/suggest.js`: the directory scan behind `askai suggest`.
- `lib/claude-config.js`: safe edits of `settings.json` and `CLAUDE.md`, backups, manifest.
- `lib/status.js`, `lib/sys.js`, `lib/winpath.js`: status/doctor/cache views, process helpers, user PATH edit.
- `hooks/askai-report.js`: transcript-based spend report used by `askai report`.
- `commands/`: `/askai-status` and `/askai-report` slash commands (copied to `~/.claude/commands`).
- `legacy/`: the retired self-built hook system and its installer. Not used by anything above.
- `test/`: the test suite.
