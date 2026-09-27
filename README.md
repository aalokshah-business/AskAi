# askai

askai installs and wires up existing token-saving tools for Claude Code on a Windows machine, then shows the savings those tools measure. It does not ship hooks of its own.

Background: the earlier self-built askai hook system was measured net negative over 7 days (it cost 26.38M units against 248.6K computed savings, NET -26.14M, -2.60% of the 940.15M spent). Its files are kept in `legacy/` for reference only. This version installs tools other people maintain and registers them once, globally, so they work in every project without any per-prompt step.

## One command on a new laptop

```powershell
git clone <this repo> askai; cd askai
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun   # see the plan, changes nothing
powershell -ExecutionPolicy Bypass -File .\install.ps1           # do it (asks once before changing anything)
```

`install.ps1` makes sure Node.js 22.5+ is present (winget `OpenJS.NodeJS.LTS`, with a prompt), then runs `askai.js install`. Open a new Claude Code session afterwards: settings, hooks, plugins, MCP servers and `CLAUDE.md` are read at session start.

## What it installs

| Component | What it is | How it is delivered | Fires |
|---|---|---|---|
| `claude` | Claude Code CLI | winget `Anthropic.ClaudeCode`, only if missing | - |
| `baseline` | The three zero-cost settings from the earlier install | `~/.claude/settings.json`: `autoCompactWindow` 150000, `env.CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `skillOverrides` (rarely used bundled skills to `name-only`). Added only when absent, never overriding your values. Also removes registrations of the retired askai hook. | Every session |
| `rtk` | [RTK](https://github.com/rtk-ai/rtk): compresses the output of shell commands before the model reads it | winget `rtk-ai.rtk`, then `rtk init -g --auto-patch` (a PreToolUse hook on Bash calls) | Every Bash tool call, automatically |
| `context-mode` | [Context Mode](https://github.com/mksglu/context-mode): keeps large tool output out of the context window, exposes `ctx_*` tools | `claude plugin marketplace add mksglu/context-mode`, `claude plugin install context-mode@context-mode` | Plugin hooks fire automatically; the model chooses when to call `ctx_*` tools |
| `serena` | [Serena](https://github.com/oraios/serena): symbol-level code navigation instead of reading whole files | `uv tool install -p 3.13 serena-agent`, `serena init`, uv's tool bin dir added to the user PATH, `claude mcp add --scope user serena ...` (dashboard off) | The model chooses to call its tools; the `CLAUDE.md` block nudges it |
| `caveman` | Terse-output directive | Managed block in `~/.claude/CLAUDE.md` (level `--caveman lite\|full\|ultra\|off`, default `full`) | Every session, automatically |
| `statusline` | One-line status: RTK's measured savings, plus Context Mode's line when its CLI exists | `statusLine` in `settings.json`, only if you have none | Every render |
| `caveman-plugin` | The Caveman plugin | Opt-in only: `--caveman-plugin` | Plugin hooks |

The managed `CLAUDE.md` block also carries four short token rules: state a tool-call limit and a reply-size limit in every subagent prompt, Grep then Read with offset/limit, prefer `ctx_*` tools for large output, prefer Serena symbol tools over reading whole files. The block sits between `<!-- askai:begin ... -->` and `<!-- askai:end -->`; if your `CLAUDE.md` already has a `# Terse output (caveman` heading, the directive is not added a second time.

### Not installed, on purpose

- Serena's reminder hooks (extra per-prompt text).
- The `@caveman-ai/cli` proxy and any `irm | iex` installer.
- The Caveman plugin, unless you pass `--caveman-plugin` (it would double up with the `CLAUDE.md` directive).
- Any hook written by askai.

## How it works with no manual step per prompt

Claude Code reads user-scope configuration when a session starts, for every project:

1. `~/.claude/settings.json` holds the RTK hook, the status line and the baseline values.
2. Plugins (Context Mode) register their own hooks and MCP tools.
3. `~/.claude.json` holds the user-scope Serena MCP server.
4. `~/.claude/CLAUDE.md` holds the terse directive and token rules.

So once `install.ps1` has run and a new session is opened, RTK compresses Bash output and Context Mode's hooks run on their own. Serena and the `ctx_*` tools are used when the model decides to, which the `CLAUDE.md` block encourages. Sessions that were already open keep their old configuration.

## Seeing what is saved

```powershell
askai report [hours]  # everything in one: status + doctor + transcript spend (default 6h)
askai status          # per-tool state, where it is wired, measured savings
askai doctor          # health checks (exit 1 on failure)
askai report --json   # {hours, tools, health, spend}; status --json and doctor --json also exist
```

Inside Claude Code: `/askai-report [hours]` (everything), `/askai-status` (tools only), and `/context-mode:ctx-stats` for the current session. The status line shows RTK's running total.

`askai report` prints three sections, each independent, so one failing does not hide the others: tool status and measured savings (same as `askai status`), health checks (same as `askai doctor`), and the transcript spend ledger. It exits 1 only when the spend part could not be produced; use `askai doctor` when you want a failing exit code for health.

Evidence labels used in `askai status`:

- **Measured by the tool**: RTK's `rtk gain` (cross-session total, using RTK's own token estimate).
- **Tool-reported, per session**: Context Mode's `/context-mode:ctx-stats`. Its vendor's headline reduction figure is not verified here.
- **Not measured**: Serena and Caveman have no counter, so askai shows no number for them.

The net effect of the whole stack is unproven. The spend section of `askai report [hours]` reads the Claude Code transcripts and shows where tokens actually went; use it to check that the stack helps. Its ledger was written for the retired hook system, so rows for features that no longer exist read 0 with an evidence label of none.

## Commands

```
askai install [--only a,b] [--skip a,b] [--caveman LEVEL] [--caveman-plugin] [--no-statusline] [--no-path] [--yes] [--dry-run] [--force]
askai update                       upgrade the installed tools
askai report [hours] [--json]      status + doctor + transcript spend in one view
askai status | doctor [--json]     the first two sections of report, on their own
askai uninstall [--tools] [--force] [--yes]
askai restore [stamp] [--yes]      list backups, or put a backed-up file back
askai statusline                   what Claude Code's statusLine calls
```

Components: `claude, baseline, rtk, context-mode, serena, caveman, caveman-plugin, statusline`. `install.ps1` takes the same switches (`-DryRun`, `-Yes`, `-Only`, `-Skip`, `-Caveman`, `-CavemanPlugin`, `-NoStatusline`, `-NoPath`, `-Action`).

`askai` is copied to `~/.claude/askai/app` and a shim is placed in `~/.claude/askai/bin` (added to the user PATH unless `--no-path`). To update askai itself, run `install.ps1` from a fresh checkout.

## Safety

- Idempotent: components that already look healthy are skipped; `--force` re-runs them.
- Existing tools are detected and never reinstalled.
- Before `settings.json`, `CLAUDE.md` or `~/.claude.json` is changed, it is copied to `~/.claude/askai/backups/<timestamp>/`. `askai restore` lists and restores them.
- An unparseable `settings.json` stops the run; askai never overwrites a file it could not read.
- `askai uninstall` removes only what askai added, recorded in `~/.claude/askai/manifest.json`. A tool or hook you set up yourself is left in place and named; `--force` removes it too, `--tools` also uninstalls tools askai installed through winget or uv. Backups are kept.
- Non-interactive runs refuse to change anything without `--yes`.
- `RTK_TELEMETRY_DISABLED=1` is set for the RTK commands askai runs.

## Known risks

- RTK and Context Mode both hook Bash tool calls. Their interaction is unverified; `askai doctor` warns when more than one such hook is registered.
- Serena and Context Mode each add tool definitions to every session. That is a per-session cost.
- Serena writes a `.serena/` folder into projects it works in.
- uv keeps a `cpython-X.Y-<platform>` minor-version link (a junction on Windows) next to each Python it downloads. A link whose target folder is missing makes `uv tool install` fail with "Missing expected target directory for Python minor version link". Before the install, and again after a failure that names such a link, askai removes dangling links inside uv's python directory (only the link; the Python folder is never touched) and retries once. The root cause of the broken link is not known.
- Serena's ownership is recorded as soon as the `uv tool install` step succeeds, so `askai uninstall --tools` removes `serena-agent` even when a later step failed. If an earlier askai run failed at the uv step and you finished the install by hand, the next `askai install --only serena --force` treats Serena as askai's; that guess is wrong if you had installed Serena yourself independently. A Serena that askai did not install is left alone unless `--force` is given.
- Serena's tool bin dir (`~/.local/bin` for uv) is added to the user PATH so `serena` works in a shell. An already-ok Serena is skipped by a normal install, so use `askai install --only serena --force` to get the PATH entry on a machine that has Serena already. `askai uninstall --tools` removes that PATH entry again, but only if askai added it.
- If you install the Caveman plugin as well as the `CLAUDE.md` directive, terse instructions are duplicated; `askai doctor` flags it.
- RTK needs `rg` for some filters (`winget install BurntSushi.ripgrep.MSVC`).
- Unverified until first real run: whether `serena init` prompts (it runs with stdin closed and a timeout, failure allowed), whether the `context-mode` CLI ends up on PATH, the shape of `claude plugin list --json` with plugins present, and whether `rtk init -g --uninstall` needs `--auto-patch` (askai falls back to removing the hook entry itself).
- `--claude-home DIR` is a testing aid: RTK's own `init -g` may still write to `~/.claude`, and running status or doctor against it lets the real Claude CLI create its own files there.
- askai's status, doctor and install call `claude plugin list --json`. The Claude CLI itself may migrate values in `settings.json` when it runs (observed on Claude Code 2.1.281: `"model": "opus"` became `"opus[1m]"`). That is the CLI's behaviour, not askai's, and it can happen before askai's own backup of that file.

## Tests

```powershell
npm test        # node --test test/*.test.js, needs Node 21+ for the glob
```

42 tests against throwaway folders under the OS temp dir with fake process runners: nothing installs software, touches the network, or writes to your real `~/.claude`. The two `report` tests only read your real Claude Code transcripts (`~/.claude/projects`), because that is what the spend section reports on.

## Repository layout

- `install.ps1`: Windows entry point (Node check, then `askai.js`).
- `askai.js`: CLI (install, update, status, doctor, report, uninstall, restore, statusline).
- `lib/components.js`: one entry per tool (detect, install, uninstall).
- `lib/claude-config.js`: safe edits of `settings.json` and `CLAUDE.md`, backups, manifest.
- `lib/status.js`, `lib/sys.js`, `lib/winpath.js`: status/doctor views, process helpers, user PATH edit.
- `hooks/askai-report.js`: transcript-based spend report used by `askai report`.
- `commands/`: `/askai-status` and `/askai-report` slash commands (copied to `~/.claude/commands`).
- `legacy/`: the retired self-built hook system and its installer. Not used by anything above.
- `test/`: the test suite.
