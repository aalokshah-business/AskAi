# Installing askai on a new Windows laptop

Prerequisites: Windows 10/11 with PowerShell 5.1+ and `winget` (App Installer from the Microsoft Store). Node.js is installed for you if missing or older than 22.5. Git is only needed to clone this repo; copying the folder works too.

## 1. Get the repo onto the laptop

```powershell
git clone <this repo> askai
cd askai
```

## 2. Preview, then install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The dry run prints every step and writes nothing. The real run shows the plan and asks once before changing anything (`-Yes` skips the question). What it does, in order:

1. Ensures Node.js 22.5+ (winget `OpenJS.NodeJS.LTS`, with a prompt).
2. Ensures the Claude Code CLI (winget `Anthropic.ClaudeCode`, only if missing).
3. Adds the baseline settings to `~/.claude/settings.json` (only keys you have not set).
4. Installs RTK (winget `rtk-ai.rtk`), checks `rtk gain` works, registers its hook with `rtk init -g --auto-patch`.
5. Installs the Context Mode plugin through Claude Code's plugin commands.
6. Installs Serena (winget `astral-sh.uv` if needed, `uv tool install -p 3.13 serena-agent`, `serena init`) and registers it as a user-scope MCP server.
7. Writes the managed terse-output and token-rules block into `~/.claude/CLAUDE.md`.
8. Sets the status line (only if you have none).
9. Copies askai to `~/.claude/askai/app`, adds the `askai` command to the user PATH, and installs the `/askai-status` and `/askai-report` slash commands.

Pick what you want with `-Only claude,rtk,context-mode` or `-Skip serena`; components are `claude, baseline, rtk, context-mode, serena, caveman, caveman-plugin, statusline`. `-Caveman lite|full|ultra|off` sets the terse level (default `full`). `-CavemanPlugin` adds the Caveman plugin as well (off by default; it duplicates the `CLAUDE.md` directive).

Some steps may need one interactive sign-in or approval (Claude Code login, winget prompts). Those are left to the tool; askai never enters credentials.

## 3. Open a new Claude Code session

Settings, hooks, plugins, MCP servers and `CLAUDE.md` are read when a session starts. From then on RTK and the Context Mode hooks fire on their own in every project; Serena and the `ctx_*` tools are used when the model chooses to. Nothing has to be typed per prompt.

Open a new terminal too, so `askai` and the freshly installed tools are on PATH.

## 4. Check that it works

```powershell
askai report        # everything: tool status + measured savings, health checks, transcript spend (last 6h; pass hours for more)
askai doctor        # health checks only
askai status        # per-tool state, wiring, measured savings only
rtk gain            # RTK's own cross-session counter
```

In Claude Code: `/askai-report [hours]`, `/askai-status`, `/context-mode:ctx-stats`. The status line also shows RTK's running total. Serena and Caveman have no counter, so no number is shown for them.

## Updating, undoing, recovering

```powershell
askai update                    # winget upgrade, plugin update, uv tool upgrade
askai restore                   # list backups in ~/.claude/askai/backups
askai restore <stamp> --yes     # put settings.json / CLAUDE.md / .claude.json back from that backup
askai uninstall                 # remove only what askai added; backups are kept
askai uninstall --tools         # also uninstall tools askai installed via winget/uv
askai uninstall --force         # also remove things askai did not add (a hook or tool you set up yourself)
```

To update askai itself, pull the repo and run `install.ps1` again. Re-running is safe: healthy components are skipped, and `--force` re-runs them.

## Trying it without touching your real setup

```powershell
node askai.js install --only baseline,caveman,statusline --no-path --yes --claude-home "$env:TEMP\claude-test"
```

`--claude-home` points askai at a throwaway folder. It is a testing aid: RTK's own `init -g` may still write to `~/.claude`, so keep RTK, Context Mode and Serena out of such runs (as above).

## Troubleshooting

- `winget` not found: install App Installer from the Microsoft Store, then re-run.
- `rtk gain` fails after install: the wrong `rtk` package (Rust Type Kit) was installed; askai reports this and stops for that component. Remove it and install `rtk-ai.rtk`.
- Context Mode refuses to install: Node.js is older than 22.5. Re-run `install.ps1` and accept the Node upgrade.
- settings.json "cannot parse": fix or move the file; askai will not overwrite a file it cannot read.
- Some RTK filters need ripgrep: `winget install BurntSushi.ripgrep.MSVC`.
- A run that changed something you did not want: `askai restore`.

See `README.md` for what each tool does, how firing works, evidence labels and known risks.
