# Linux Cursor container command review

Reviewed the supplied terminal capture, including its help catalog, against the implementation. The capture is evidence of output from that machine, not proof that a configured plugin was connected or reduced subscription usage. Fixes below were tested locally; the remote container was not accessed.

## Command groups reviewed

| Group | Captured commands | Result |
| --- | --- | --- |
| Infrastructure | infra, plugins, mcp, models, route, audit, status, status cursor | Fixed audit wrapping, environment detection, requirement scoping and narrow-terminal layout. Existing model/MCP tables already align. |
| Health | todo, test, next, context, weigh | Fixed self-test fixtures and expected errors; retained genuine navigation and handoff findings. |
| Reference | ask, guide, tips, direction, docs, chat, version, help all, help COMMAND, statusline | Aligned help option descriptions and document paths; preserved category boundaries. statusline without JSON correctly prints instructions. |
| Project | suggest, profiles, restore, bootstrap, convert, graph, map, review, scaffold, project | Corrected suggest and restore instructions. Existing converter progress/error changes were preserved. Conversion was not rerun against the video's URL. |
| Session/work | session, session measure, clear, handoff, break, resume, diff, errors, prompt | Rejected empty measurements; preserved draft handoff protection, bounded prompts and read-before-clear behavior. |
| Maintenance | tools update | This updates packages and configuration; it is not a read-only display test. No remote update was performed. |

## Implemented improvements

- A shared table renderer wraps long cells, preserves evidence, aligns continuation columns and uses labeled records on small terminals. Audit severity groups retain the same column widths; options and document listings use the same renderer.
- Audit no longer calls the sum of instruction files for different tools a measured per-session token cost. Candidate-file estimates can include conditional rules and imports; they are not plan consumption.
- Status keeps four environment columns on wide terminals, two on medium terminals and separate sections on narrow terminals. Shared local utilities remain separate.
- Infra no longer infers a running/installed desktop IDE from its configuration path. A detected CLI and a configured path are reported separately.
- Infra requirements use the caller's environment. Cursor no longer borrows Claude's terse block or counts Claude-only LSP/statusline recommendations as Cursor readiness. Editor language services remain unverified.
- Base-tool readiness checks rg, jq and gh separately. Infra lists missing binaries, container persistence concerns and the need to check MCP connections in the remote editor.
- No recorded MCP call means no call was observed in the available seven-day logs; it does not prove a server was never used.
- Blank measurements, invalid numeric values and unspecified success are rejected before creating a CSV row. Older blank rows are not silently deleted.
- Self-tests now provide a file for weigh, quote shell expressions, and expect validation errors for missing MCP names. Presentation flags are labeled as review hints, separately from unexpected exit checks.
- `check --fix --dry-run` no longer creates scaffold/session files.
- tmux launch prints scroll/copy instructions and the direct-terminal alternative. Global tmux preferences are unchanged.
- Restore help accepts a backup timestamp, matching the command. Suggest distinguishes machine configuration from project initialization and uses explicit installation targets.

## Findings on the captured machine

### Cursor and MCP

Cursor's rules and project pack exist. Serena, Context7 and Headroom have configuration entries; the capture does not establish a live tool connection. The `cursor: 14` transcript count is not evidence of 14 Serena/Context7/Headroom calls.

Open the remote workspace's MCP settings and its MCP Logs output channel. Confirm the server starts, its executable exists in the execution environment, and the expected tools appear. Cursor supports project `.cursor/mcp.json` and global `~/.cursor/mcp.json`; project definitions override global entries with the same name. Do not copy registrations into both locations as a speculative fix.

The old Antigravity "Desktop IDE present" line came from a configured path, not desktop detection. Claude configuration files can also remain when its CLI is absent. Such files alone do not start an AI session.

### C/C++ navigation

The open compile-database todo is material for this firmware project. Configure the existing build system to export `compile_commands.json`, then point the remote language server at the matching build directory. Select the actual target, toolchain and generated includes; do not fabricate build flags or run a new build automatically from AskAI.

For a CMake build using Ninja or Makefiles, `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` is the relevant option. Other generators may ignore it; other build systems need their equivalent. A Claude LSP plugin is not a substitute for Cursor's remote C/C++ language service.

### Project guidance and review

The short router and a large searchable source index are appropriate. Do not load the 7,679-line source index wholesale into chat. Search for the relevant paths first. Zero checked official references and "invariants needs review" are evidence gaps, not successful AI verification.

The later review reports a much smaller indexed set and thousands of removed entries. Compare `askai review status --all --json` with the current index, ignore rules and scan limits before reviewing. A path absent from the new index does not by itself prove the source file was deleted. Do not mark review complete automatically.

The draft handoff needs an actual next step. Run `askai handoff "the actual next step"`; do not use the literal placeholder as evidence of completed planning.

### Usage and optional tools

No ccusage data is expected when Claude transcripts are absent. It cannot measure Cursor's subscription usage. An unavailable Headroom report is not zero usage or a demonstrated saving. Installed Graphify and a built graph do not prove the agent queried it.

Keep optional compression servers only when useful for actual tasks and supported by your own comparisons. To disable Headroom for Cursor, the existing command is `askai mcp off headroom --tool cursor`; do that between sessions if you choose. This review did not disable tools remotely or change model choices.

## Apply and verify in the Linux container

After this revision is available on your configured Git remote:

```bash
askai update
# Exit an old AskAI shell, then start a new one:
askai cli
```

Inside the AskAI shell:

```text
status cursor
infra
check --all
audit --tool cursor
todo
```

If infra identifies missing base utilities, review and run this in the shell:

```text
install --target cursor --only base-tools --yes
```

Package installation may require your administrator or an allowed package mirror. AskAI cannot change office proxy/network policy. Keep installation persistence in personal dotfiles or a reviewed devcontainer configuration; `askai bootstrap` explains the existing options.

For normal scrolling, use `askai cli` directly in the Cursor terminal. With tmux, use Ctrl+B then `[` for copy mode, Page Up to scroll and `q` to exit copy mode. Shift-selection typically bypasses tmux mouse capture; clipboard integration depends on the outer terminal. Do not assume that a container clipboard tool reaches the desktop clipboard.

The safe self-test uses disposable fixtures, but its presentation flags are heuristics. For live read-only configuration checks, use `askai test --real --json`; this does not verify accounts, run an AI task or measure net quota savings. Avoid pasting the entire help catalog and capture into each AI session.

## Remaining support gaps

- No universal end-to-end MCP health probe across the four desktop clients. Configured, connected, called and beneficial are different states.
- No Cursor/Antigravity quota counter or controlled automatic measurement of weekly subscription savings.
- No automatic inference of the correct firmware build target, generated headers, compile flags or security invariants.
- No reliable desktop clipboard access from every devcontainer/tmux combination.
- No guarantee that experimental compression plugins improve a particular workload.
- The entire captured 264-command matrix was not rerun on Linux during this Windows-side review. Focused regressions and reproduced self-test failures were verified locally.

## Primary references

- [Cursor MCP configuration and troubleshooting](https://prod.cursor.com/help/customization/mcp)
- [tmux getting started and copy mode](https://github.com/tmux/tmux/wiki/Getting-Started)
- [CMake compile database export](https://cmake.org/cmake/help/latest/variable/CMAKE_EXPORT_COMPILE_COMMANDS.html)
