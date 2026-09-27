# Installing askai on a new Windows laptop

Prerequisites: Windows 10/11 with PowerShell 5.1+ and `winget` (App Installer from the Microsoft Store). Node.js is installed for you if it is missing, and the installer offers an upgrade when it is older than 22.5 (Context Mode and the Cursor Context Mode route need 22.5 or newer). Git is only needed to clone this repo; copying the folder works too.

## 1. Get the repo onto the laptop

```powershell
git clone <this repo> askai
cd askai
```

## 2. Pick a profile, preview, then install

Profiles choose the tools by the kind of work. `coding` is the default.

| Profile | For | Adds to the base |
|---|---|---|
| `minimal` | Shell-output compression and terse replies only | nothing (no MCP servers or plugins) |
| `coding` (default) | Source code | Context Mode, Serena, coding rule |
| `docs` | Documents, PDFs, Office files | Context Mode, markitdown, docs rule |
| `full` | Mixed work, plus a usage report | Context Mode, Serena, markitdown, ccusage, both rules |

The base is the Claude Code CLI, the baseline settings, RTK, the terse-output block, the status line and the path rules the profile selects. Not sure which fits? Ask about a folder (read-only):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action suggest -Path C:\work\my-project
```

Then preview and install:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File .\install.ps1                       # coding
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Workflow docs        # or minimal, full
```

The dry run prints every step and writes nothing. The real run shows the plan and asks once before changing anything (`-Yes` skips the question). What it does, in order:

1. Ensures Node.js 22.5+ (winget `OpenJS.NodeJS.LTS`, with a prompt).
2. Ensures the Claude Code CLI (winget `Anthropic.ClaudeCode`, only if missing).
3. Adds the baseline settings to `~/.claude/settings.json` (only keys you have not set).
4. Installs RTK (winget `rtk-ai.rtk`), checks `rtk gain` works, registers its hook with `rtk init -g --auto-patch`.
5. Installs the Context Mode plugin through Claude Code's plugin commands (coding, docs, full).
6. Installs Serena (winget `astral-sh.uv` if needed, `uv tool install -p 3.13 serena-agent`, `serena init`), adds uv's tool bin dir to the user PATH (skipped with `-NoPath`), and registers it as a user-scope MCP server (coding, full). If uv fails with "Missing expected target directory for Python minor version link", askai removes that stale link (only the link, never the Python folder it points at) and retries.
7. Installs markitdown with `uv tool install` (docs, full, or `-Markitdown`) and ccusage with `npm install -g` (full, or `-Ccusage`). Both are third-party packages that askai has not run on this machine; the plan names them before anything is installed.
8. Writes the managed terse-output and token-rules block into `~/.claude/CLAUDE.md`, and the path-scoped rule files into `~/.claude/rules/`.
9. Sets the status line (only if you have none).
10. Copies askai to `~/.claude/askai/app`, adds the `askai` command to the user PATH, and installs the `/askai-status` and `/askai-report` slash commands.
11. If Cursor is present, wires it as well (see below).

Fine-tuning: `-Only claude,rtk` runs just those components (and does not change the remembered profile), `-Skip serena` drops one, `-Markitdown` and `-Ccusage` add a tool to any profile. Components: `claude, baseline, rtk, context-mode, serena, markitdown, ccusage, caveman, caveman-plugin, rules, statusline, cursor-rtk, cursor-context-mode, cursor-serena`. `-Caveman lite|full|ultra|off` sets the terse level (default `full`). `-CavemanPlugin` adds the Caveman plugin as well (off by default; it duplicates the `CLAUDE.md` directive). A profile only adds: switching to a smaller one keeps the installed tools and removes only the rule files it no longer wants.

Some steps may need one interactive sign-in or approval (Claude Code login, winget prompts). Those are left to the tool; askai never enters credentials.

## 3. Cursor

`-Target auto` (the default) wires Claude Code always, and Cursor too when `~/.cursor` exists. Use `-Target cursor` or `-Target both` to be explicit, `-Target claude` to leave Cursor alone.

What Cursor gets: RTK's hook in `~/.cursor/hooks.json`, MCP entries for Context Mode and Serena in `~/.cursor/mcp.json`, and, per project, rule files in `.cursor/rules/`. Cursor has no file-based user rules, so write those for each project you use it in:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action project -Path C:\work\my-project
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action project -Path C:\work\my-project -Print    # show only
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action project -Path C:\work\my-project -Remove   # take them out
```

Cursor has no status line, so cache and context figures, ccusage and the spend report cover Claude Code only. Context Mode reaches Cursor as MCP tools only (its hooks do not run there); the always-applied project rule steers the agent to them. Restart Cursor after the install so it reads the new hooks and MCP servers.

## 4. Open a new Claude Code session

Settings, hooks, plugins, MCP servers, `CLAUDE.md` and rules are read when a session starts. From then on RTK and the Context Mode hooks fire on their own in every project; Serena, markitdown and the `ctx_*` tools are used when the model chooses to. Nothing has to be typed per prompt.

Open a new terminal too, so `askai` and the freshly installed tools are on PATH.

## 5. Check that it works

```powershell
askai report        # everything: tools and measured savings, health, cache per session, spend (last 6h; pass hours for more)
askai doctor        # health checks only
askai status        # profile, per-tool state, wiring, measured savings only
rtk gain            # RTK's own cross-session counter
```

In Claude Code: `/askai-report [hours]`, `/askai-status`, `/context-mode:ctx-stats`. The status line shows RTK's running total, and cache hit and context use when Claude Code reports them (v2.1.251 or later for the cache figures). Serena, markitdown, Caveman and the path rules have no counter, so no number is shown for them, and ccusage only reports.

## Updating, undoing, recovering

```powershell
askai update                    # refresh askai's copy, then winget upgrade, plugin update, uv/npm tool upgrade
askai profiles                  # list the profiles; the one in effect is marked
askai restore                   # list backups in ~/.claude/askai/backups
askai restore <stamp> --yes     # put settings.json / CLAUDE.md / .claude.json (and Cursor's mcp.json / hooks.json) back from that backup
askai uninstall                 # remove only what askai added, including project rules it wrote; backups are kept
askai uninstall --tools         # also uninstall tools askai installed via winget/uv/npm
askai uninstall --force         # also remove things askai did not add (a hook, tool or rule file you set up yourself)
```

To update askai itself, pull the repo and run `install.ps1` again. Re-running is safe: healthy components are skipped, and `-Force` re-runs them.

## Trying it without touching your real setup

```powershell
node askai.js install --only baseline,caveman,rules,statusline --no-path --yes `
  --claude-home "$env:TEMP\claude-test"
New-Item -ItemType Directory -Force "$env:TEMP\proj" | Out-Null
node askai.js project "$env:TEMP\proj" --profile coding --claude-home "$env:TEMP\claude-test" --cursor-home "$env:TEMP\cursor-test"
```

`--claude-home` points askai at a throwaway folder, and `--cursor-home` does the same for Cursor's config. They are testing aids: RTK's own `init -g` may still write to the real `~/.claude` and `~/.cursor`, so keep RTK, Context Mode and Serena out of such runs (as above, with `--only`). Status and doctor against a throwaway Claude folder can let the real Claude CLI create its own files there.

## Troubleshooting

- `winget` not found: install App Installer from the Microsoft Store, then re-run.
- `rtk gain` fails after install: the wrong `rtk` package (Rust Type Kit) was installed; askai reports this and stops for that component. Remove it and install `rtk-ai.rtk`.
- Context Mode refuses to install: Node.js is older than 22.5. Re-run `install.ps1` and accept the Node upgrade.
- settings.json "cannot parse": fix or move the file; askai will not overwrite a file it cannot read.
- Some RTK filters need ripgrep: `winget install BurntSushi.ripgrep.MSVC`.
- Cursor does not show the tools: restart Cursor, and check that `~/.cursor/mcp.json` has the entries (`askai status` lists what is wired where).
- A run that changed something you did not want: `askai restore`.

See `README.md` for the landscape of tools, why this combination, what each does, evidence labels and known risks.
