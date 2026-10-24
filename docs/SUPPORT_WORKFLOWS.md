# MCP, quota, build and clipboard support

These workflows are local and explicit. They do not start AI agents, switch models, change billing or silently configure firmware targets. MCP verification starts the server commands you already configured; those commands can invoke package managers or contact their own services.

## 1. Verify MCP servers across four environments

```text
askai mcp verify --tool cursor
askai mcp verify --tool claude
askai mcp verify --tool codex
askai mcp verify --tool agy
askai mcp verify serena --tool cursor --json
```

Without a tool filter, all configured environments are checked. Global registrations are read for all four clients; Claude and Cursor project definitions override global names. No configuration is edited.

For supported stdio configurations, AskAI starts a short-lived server, sends MCP `initialize`, then `tools/list`, and attempts to stop its process tree. It does not call a tool or send a model request. Each probe has an eight-second timeout and a 1 MiB response limit. Raw server logs, commands, environment values and tool descriptions are not printed.

Results distinguish verified, initialized without tools, partial pagination, disabled, failed, timeout and not verified. HTTP/OAuth, complex TOML and Windows `.cmd` launchers require native-client verification. Unknown protocol versions remain unverified. A startup timeout may mean the package is downloading or indexing; inspect it in the native client rather than treating that as a demonstrated model/token problem.

**A responding server is not proof that your editor has connected to it.** JSON explicitly reports `clientConnectionVerified: false`. Check Cursor MCP Logs, Claude Code `/mcp`, and the corresponding tools/settings in Codex and Antigravity. AskAI never runs these probes automatically from status, check, infra or its default self-test.

## 2. Record real quota observations

AskAI does not currently fetch Cursor or Antigravity account quota through an integrated vendor API. Read the account dashboard and record it without API credentials:

```text
askai session quota --tool cursor --used 23 --window 100 --window-id current-window --usage-source dashboard
# Work normally, then record another actual dashboard reading:
askai session quota --tool cursor --used 26 --window 100 --window-id current-window --usage-source dashboard
askai session quota report --tool cursor
askai session quota report --json
```

This example records 23% and 26% used, a three-percentage-point observed change. Replace those numbers with actual readings. The denominator defaults to 100; provide the real denominator when recording another unit. Give every reset window a new ID. Decreasing counters within one ID are marked as a reset and excluded from delta calculations.

Observations stay in `.ai-work/quota-observations.jsonl`, separate from the existing measurements CSV. Do not put tokens, cookies or credentials in metadata. Blank readings, invalid percentages and oversized metadata are rejected. `--dry-run` does not write a record.

### Compare a baseline and AskAI workflow

For each workflow, take a reading before and after the same accepted workload. Add:

```text
--variant baseline --name trial-1 --task matched-workload --model actual-model-id --effort medium
```

For the AskAI phase, use `--variant askai` and the same experiment, task, model and effort. Keep the appropriate window ID on each phase. `session quota report` prints an observed comparison only when each labeled phase has two usable readings and matching metadata.

Keep account/plan, task difficulty, accepted result and background activity comparable. Include setup/review costs when assessing the total benefit. Quota is account-wide, often rounded, and may update late. **An observed difference does not prove that AskAI caused a saving.** Raw tokens and cache ratios are not converted into plan quota.

## 3. Discover and select an existing firmware build

```text
askai project build
askai project build --json
askai project build select PRESET_NAME --dry-run
askai project build select PRESET_NAME
```

Discovery reads project-local CMake preset files and their simple includes, PlatformIO environments, and compile databases at standard locations. It excludes hidden presets and does not read includes outside the project. Metadata and include scans are bounded. Conditional presets, inheritance and toolchain compatibility are left for the build system to evaluate.

For projects whose supported build entry point is `./mk.sh`, discovery lists that existing script too. Use `askai project build select ./mk.sh` to record the exact command without guessing arguments, board names or a replacement CMake invocation. AskAI does not execute or infer the behavior of the wrapper. Inspect the script and its configuration to determine how it selects the board/toolchain and emits a compile database.

Selection requires one unique discovered name. It records `.ai-work/build-selection.json` and prints command argv for review. It does not run a build, alter CMake/PlatformIO files, configure editor extensions or mark the selection verified. CMake compile-database export requires Ninja or Makefiles.

For Zephyr without an existing preset, provide your successful `west build` command, board/configuration and toolchain. AskAI cannot infer a safe board from an arbitrary firmware directory. Existing `compile_commands.json`, `build/compile_commands.json` and `_out/compile_commands.json` satisfy the compile-database presence check; live editor use still requires verification.

## 4. Copy reliably from a container

```text
askai check --env
askai resume --copy
```

Resume always saves `.ai-work/RESUME_PROMPT.md` before attempting clipboard transfer. If direct clipboard tools are unavailable, an interactive terminal can receive an OSC 52 write request. This has no desktop paste acknowledgement. Requests larger than 100,000 UTF-8 bytes do not use OSC 52.

When inside tmux, inspect:

```bash
tmux show-options -sv set-clipboard
```

The outer terminal must support and allow OSC 52. If your environment permits it, tmux's `set-clipboard on` allows applications inside tmux to request clipboard writes; changing it is your choice, and AskAI does not change it automatically. This permission allows applications in tmux to write your clipboard.

If paste still fails, open `.ai-work/RESUME_PROMPT.md` in Cursor and copy from the editor. This fallback works without a remote desktop clipboard bridge. Use `askai cli` directly in the Cursor terminal when you prefer normal terminal scrolling over tmux copy mode. AskAI does not read your clipboard to test it.

## What remains unverified

- A server probe cannot observe every desktop client's live connection.
- HTTP/OAuth and complex launcher configurations still need native-client checks.
- Dashboard readings support observations, not automatic causal proof of weekly savings.
- Firmware board, toolchain and generated headers still require project-specific input.
- Container clipboard writes cannot guarantee a successful paste in every desktop terminal.

## Primary references

- [MCP stdio and HTTP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [CMake presets](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html)
- [tmux clipboard behavior](https://github.com/tmux/tmux/wiki/Clipboard)
