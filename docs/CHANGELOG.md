# Changelog

AskAI follows semantic versioning from 1.0.0 (see [RELEASING.md](RELEASING.md)). Installs always take the latest version on `main`.

## Unreleased

- Checked against a sixth video ("18 Claude Code Token Hacks in 18 Minutes"), all three tiers: 15 of 18 were already covered (`clear`, `mcp`, `one-prompt`/`edit-regenerate`, `plan`, `statusline`, `paste`, `stop-early`, `reads`/`smallest`, `compact`'s 60% threshold, `resume`'s cache-timeout rule, `instruction-files`, `peak`). Three genuine gaps closed:
  - `/cost` (session spend estimate) was never mentioned anywhere in `askai tips`; it now sits next to `/usage`.
  - `knowledge/tool-output.yaml`: capping or filtering output was the only lever documented; it now also says to deny a command outright in `permissions.deny` (the mechanism `askai install --lean` already writes) when you know it is noisy and never needed in this project — zero tokens instead of up-to-the-cap tokens.
  - `knowledge/peak.yaml`: the off-peak-hours rule had no guidance on pacing against the reset itself; it now says to spend remaining budget before a reset you are close to, and to stop and preserve a full window when the opposite is true (little budget, hours still on the clock).
  - `knowledge/advisor.yaml`: a second, independent creator now describes the same cross-tool idea (build in Claude Code, review with the official Codex plugin) as the previous video's Codex-advisor mention; noted as claims only, since neither measures it — consistent with how Graphify's and Caveman's own claims are already labelled.
- Checked against a fifth video ("Never hit Claudes Usage Limit Again"), claude.ai-chat-focused: don't-follow-up, fresh-chat-every-15-messages, batch prompts, track usage locally, upload recurring files once, memory/preferences, turn off unused features, Haiku for simple tasks and off-peak hours were all already covered (`edit-regenerate`, `clear`/`compact`, `one-prompt`, `savings`/`askai audit` — which already parses the same local session JSONL the video's recommended third-party dashboard does — `project-files`, `instruction-files`, `mcp`/`effort`, `model-claude`, `peak`). `knowledge/limit.yaml` gets one real addition: Claude's own extra-usage/overage toggle as a deliberate, capped safety net for a session you cannot afford to lose — explicitly not the same call as Antigravity's paid-credits setting, which askai leaves off. Declined to add the video's "cron-ping Claude at 6am to start your 5-hour window early" trick: a rolling window ages out usage by when it was incurred, not by a single early ping, so the claimed effect ("hit your limit at 10, reset lands at 11") doesn't follow from how the mechanism actually works; adding it as a rule would repeat an unverified, likely-incorrect claim.
- Checked against a fourth video ("I Gave CLAUDE CODE 1.6 Billion Free Tokens Every Day"): it is a walkthrough of OmniRoute, a local proxy that points `ANTHROPIC_BASE_URL` at free-tier third-party models relabelled as a fake Claude model name. `knowledge/proxies.yaml` already told you to avoid proxies on a subscription and `askai audit`/`askai check` already flag `ANTHROPIC_BASE_URL` as `PROXY IN THE REQUEST PATH`; the rule is unchanged, but `why` now names the specific mechanism (model-identity spoofing, a swapped `ANTHROPIC_AUTH_TOKEN`, no SLA on model availability, a likely terms violation with Anthropic and with each free-tier provider) instead of a generic "risk" — concrete enough that someone who just watched that video understands exactly what askai is warning them against, not just that it is.
- Cross-tool pass over the edits above and the existing `cache-breakers`/`effort` topics: `askai go` supports Cursor (`askai go cursor --tier <tier>`), so `knowledge/cache-breakers.yaml` and `knowledge/effort.yaml` were Claude/Codex/Antigravity-only by omission; both now also state Cursor's mechanism (effort is baked into the model ID picker, not a separate toggle) and action.
- Cache-breaker claim for effort changes, revised against a third review video ("You're Paying Anthropic 20x MORE Than You Need To"): Anthropic's docs say an effort change keeps the prompt cache, but this is now the third independent creator claim that it resets it ("straight from the Claude Code documentation", per that video). Unresolved against the primary source, so every place that told you it was safe (`knowledge/cache-breakers.yaml`, `knowledge/effort.yaml`, `lib/guide.js`, `docs/ASKAI_GUIDE.md`) now treats an effort change as a cache risk too, and the templates `askai` writes into a project (`lib/models.js` → `docs/ai/MODELS.md`, `lib/project.js` → `AGENTS.md`) no longer tell you to raise effort mid-session for a hard step; they tell you to finish that step in a fresh session instead. `lib/audit.js` now tracks effort switches the same way it already tracked model switches (`r.effortSwitches`), so `askai audit` reports evidence instead of leaving this as an opinion — "Effort switches in that session" is a new, medium-severity finding.
- `knowledge/output-size.yaml` and `askai tips` habit 9: Caveman advertises 65% fewer output tokens; the six-study measured median askai already cited (about 8%) is now stated explicitly as the number to trust instead, next to the vendor claim.
- `askai audit` scheduled-work check was a no-op on Windows (`if (process.platform !== 'win32')` guarded the whole crontab lookup, with nothing in its place): it now queries Task Scheduler (`schtasks /query`) for AskAI/Claude/Codex/Antigravity/Cursor jobs, matching the existing cron behavior on macOS/Linux. Found against two further token-saving review videos ("How To Never Run Out Of Codex and Claude Usage Limits", "Paste This Into Claude Code, Never Run Out Of Tokens Again"); everything else both videos raised (model/effort lock-in, MCP tool deferral and the proxy check, the Advisor, `bashOutputMaxChars`, unused-skill pruning) was already covered and is unchanged.
- `knowledge/subagents.yaml`: the rule only said "use subagents sparingly"; it now states the actual three-condition test (high-volume output, detail not needed again, many turns left in the session) and adds Anthropic's multi-agent research post figures (~4x a single subagent, ~15x a multi-agent run) alongside the existing ~7x team figure.
- `askai tips`: two new cross-tool habits (15, 16) make the cache-breaker and scheduled-task rules quotable from the tips command itself, not only from `docs/ARCHITECTURE.md`.
- Knowledge base: close gaps found by checking AskAI against a 18-tactic token-saving video. `askai ask resume` now names the explicit trigger to restart after 2-3 failed tries at the same issue, instead of only the generic cache-expiry rule. New topic `askai ask reuse`: link or resume an earlier thread that already solved a similar problem (deep link in Codex, `--resume`/`/resume`/History in Claude Code, Antigravity and Cursor) instead of re-deriving it. `docs/ai/WORK_ORDER.md` gets a "Stop conditions / turn budget" field for long-running tasks. The `prompt-refiner` skill now also returns a one-line recommended run setup (model/effort, plan mode, subagents, stop condition) for multi-step tasks instead of just a tier.
- Desktop GUI: Convert To Markdown gets a third input type, Local Folder, alongside Local File and YouTube/Web URL. Selecting a folder converts every supported file directly inside it (PDF, Word, PowerPoint, Excel, HTML, text, images; not subfolders) into the chosen output folder, one at a time, and reports how many of how many succeeded plus a per-file reason for any failure. A bad file in the batch does not stop the rest. The per-file result lines are grouped (every `OK` line before any `FAIL` line) and tagged, so a batch with mixed outcomes doesn't read as one undifferentiated block; a failure line names only the file, not its full path repeated from the underlying error message.
- Desktop GUI: Markdown Preview no longer re-cases a converted document's own content. `titleHeadings()` (used for command-output headings) was also applied to the saved Markdown file's preview, title-casing a YouTube video's actual title and body text (and mangling contractions, e.g. `I'll` to `I'Ll`, since the casing regex ran inside the word). The preview now shows the saved file verbatim; `titleHeadings()` stays for command stdout only, and its contraction handling is fixed with a lookbehind so a leading apostrophe no longer gets capitalized.
- `convert`: fix YouTube conversions losing the transcript on Windows. Isolated to the uv-generated trampoline exe `uv tool dir --bin` resolves (what askai always invoked): the same markitdown version, same arguments, succeed through the tool's own venv python (`<venv>/Scripts/python.exe -m markitdown`) but drop the transcript through the trampoline, silently (exit 0, no error). `askai convert` now resolves and prefers that venv python when one exists; the trampoline is only a fallback. The missing-transcript warning added just before this fix stays as a safety net for the cases it doesn't cover.
- Desktop GUI: the row auto-shown for a command's first optional argument no longer defaults a boolean flag to "true". Selecting `update` (whose first optional flag is `--dry-run`) was silently adding `--dry-run` enabled, so Run Command only ever previewed the update and never actually ran it. The auto-shown row now defaults booleans to "false"; explicitly adding an option via Add Option is unaffected.
- `convert`: treat MarkItDown output that is mostly raw `(cid:N)` glyph IDs as a failure instead of writing it. This happens when a PDF's embedded font has no usable ToUnicode map; no retry or re-conversion fixes it, so report it like the existing empty-output case instead of leaving an unreadable file.
- `askai cli --launch` no longer also opens the desktop app. `/askai-cli` and `/askai-gui` are independent again: each opens only what it says.
- Desktop GUI: show the first optional argument's dropdown as soon as a command is picked instead of only after clicking Add Option, so selecting a command reveals whether it has optional arguments at all. Add Option now disables itself when a command has no optional arguments, or once every one has been added, and re-enables if one is removed. Bold the Command/Action/Environment labels (Commands and Help tabs) and the Input type/File URL/Output Folder labels (Convert tab).
- In Codex workspace-write sessions, the GUI skill requests normal approval for the desktop launch only; preparation stays sandboxed. Explain that sandboxed process listings may not see external desktop windows.

- Prepare the GUI build in matching legacy PATH installations during Windows setup. Report build permission failures with the installation folder and recovery command; do not retry access-denied compilation. Detect process exits before readiness and during a short startup check, reporting exit status instead of claiming launch success.

- `/askai-gui` now runs the same project-prepare flow as `/askai-cli` (select or ask for the project, run `askai init` and setup/review only when `--review` is explicitly requested) before opening the desktop app, instead of opening it against whatever folder happened to be current. `askai cli --prepare --for gui` returns `askai gui` in its `instruction` field instead of `askai cli --launch`.
- Delete earlier compiled desktop-bin exes once a new one is built, so `askai update`/`install` (which already rebuilds the desktop app from the latest source on every run, through the shortcut-install step) always leaves exactly the current build on disk instead of accumulating one file per past compile.
- Retry transient native resource-generation failures up to three times; access-denied failures are reported immediately because their cause may be permissions or policy.
- Desktop GUI: pad tab captions so no letter is clipped, move the status line ("Output copied.", "Ready") to the right of the result buttons instead of flush against them, color it teal, and remove the redundant "Select a command..." line from the Help tab (both apps).
- Fix `askai`/`askai cli`/`askai gui` not resolving on Windows from a non-interactive shell (the kind an agent's shell tool runs, including Antigravity, Codex and Cursor): Git Bash does not do PATHEXT resolution for bare `askai` (only `askai.cmd`), and the `~/.bashrc` alias that worked around it only applies to interactive shells. Windows installs now also get an extensionless `askai` POSIX shim next to `askai.cmd`, the same file already written on macOS/Linux, so bare `askai` resolves everywhere without depending on the alias.
- Give the Windows and Linux desktop app a navy header band with a drawn Ask AI mark, a teal-accented Output panel heading, and group the Command dropdown (both tabs) by its `askai help` category with a heading row between groups. Add `navy` and `teal` to `desktop-theme.json`.
- Add `askai gui` (alias for `askai desktop open`) and the matching `/askai-gui` command/skill for Claude Code, Cursor, Codex and Antigravity, alongside `/askai-cli` and `/askai-plugins`. `askai cli --launch` now also opens the desktop app, best-effort, when the platform supports it.
- Split the single command-reference poster/PDF into two: `docs/AskAI-setup-A3.png`/`.pdf` (start here, install, shell) and `docs/AskAI-working-A3.png`/`.pdf` (session, project, health, cost, learn) so the daily-use reference no longer carries one-time setup content. Replaces `docs/AskAI-commands-A3.png` and `docs/AskAI-commands.pdf`.
- Fail `convert` with one clean "not found" line for a missing local file instead of spawning MarkItDown; truncate any MarkItDown failure to its last line instead of the full traceback. Fix flaky `check`/`project`/`infra` tests on a machine with `ANTHROPIC_BASE_URL` set. Stop the desktop Help tab's command picker from stretching across unused width.

- Generate integrity hashes from clean-checkout line endings declared by Git attributes, preserving binary bytes and avoiding false Windows checksum failures.

- Keep Node 20 upgrade notices read-only during diagnostics and dry runs, and avoid creating a legacy data directory before first install.

- Use content-sized desktop tabs, aligned Command/Action/Environment columns and a permanent Arguments section. Windows/Linux share a blue-and-white palette. Environment selections map only to supported CLI arguments; unsupported commands show Project Scope.
- Keep optional desktop setup failures separate from core CLI installation. Explicit desktop setup still reports failure when Windows signing policy blocks the executable.

- Align desktop command/action selectors, use Title Case for UI captions and display headings, show Markdown controls only on conversion, and add an Ask AI Help tab with full command help on Windows/Linux.
- Repair cross-platform command argument handling and keep npm diagnostics from writing logs; make host fixtures and release/skip assertions independent of the developer laptop.

- Replace raw desktop command arguments with shared command/action forms, mandatory fields and add/remove option dropdowns on Windows and Linux. Preserve multiline output, pretty-print JSON, preview converted Markdown, add Copy output and explicit Local file/URL modes, and add native/Ubuntu GUI regression checks.

- Add the Ask AI Windows/Linux desktop app: local file/image and YouTube-to-Markdown conversion, collision-safe output names, project selection, command picker, command help, output viewer and cancellable child processes. Windows installs add managed Desktop/Start Menu shortcuts and native .NET/Windows OCR; graphical Linux installs use Tkinter/Tesseract and desktop entries. Docker/container and headless Linux skip the GUI. Provide separate setup-desktop.ps1/setup-desktop.sh and askai desktop install/remove commands.
- Track dated native-client MCP observations separately from server probes; expose missing/stale checks in todo and brief status without launching servers or AI.

- Add runtime content/revision stamps, duplicate-copy visibility, CLI runtime identification and a fast configuration-only status mode.
- Repair orphaned uv launchers through shared installer logic, accept and remember an explicit Python interpreter, and identify startup failures without changing OS security settings.
- Add bounded direct Codex MCP observations and normalized client exports, with deduplication, redaction, unknown-outcome and scope/coverage labels; optionally record server probe evidence.
- Add explicit quota plans and stricter matched before/after comparisons; ignore invalid legacy measurements and never invent baseline evidence.
- Bound Graphify queries with deadlines/output budgets, freshness hints and targeted-search fallback. Preserve edited guidance visibly during refresh.
- Preserve scan-cache object identity while isolating init overrides; invalidate cached source evidence after repeated edits to an already-dirty nested file.

- Correct live-audit diagnostics: preserve early MCP exit failures instead of false cleanup failures, resolve Windows npm launchers before probing, and label plugin readiness as configuration rather than connection.
- Show cross-client registrations independently of the last installation target. Wrap detailed help prose and avoid mistaking indentation/table separators for Git output or duplicated evidence.
- Use Headroom's durable savings report instead of proxy performance output; document runtime drift, orphaned uv launchers, missing telemetry and the limits of quota comparisons.

- Make project inventory, review scans and profile suggestions share broader language coverage. Broaden terminal root discovery and review manifest tracking without adding launch-time source analysis.
- Stop classifying generic CMake/mk.sh projects as firmware or Swift packages as iOS. Keep unknown stacks usable, label inference limits, and preserve explicit init type/description/build/test choices across map and refresh.

- Discover an existing mk.sh firmware wrapper and preserve ./mk.sh as the explicitly selected build argv, without executing it or guessing target arguments.

- Add explicit MCP stdio verification across four host configurations, with project overrides, bounded protocol checks, redacted logs and subprocess cleanup. Distinguish server responsiveness from editor attachment.
- Add manual session quota observations and matched-workload observational comparisons, with reset detection and no quota-to-token conversion.
- Add project build discovery and explicit preset selection; never guess firmware boards or execute builds.
- Always save resume clipboard fallback text, bound OSC 52 payloads, describe missing paste acknowledgement and report tmux clipboard limitations.

- Linux-container command review: shared wrapping tables for audit/help/docs, responsive status columns, scoped infra requirements and honest MCP/desktop evidence labels. List missing base tools and remote editor checks; clarify plugin interface types and restore timestamps.
- Reject blank/invalid session measurements; make check --fix --dry-run non-mutating. Fix self-test weigh input, shell-expression quoting and expected validation exits; distinguish presentation flags from failed checks. Add tmux scroll/copy guidance and askai docs container with remaining support limits.

- Added real-time progress indicator, elapsed timer, and heartbeat status to `askai convert` for YouTube URLs and long document conversions.
- Added comprehensive Summary sections to all 56 commands in `askai help <command>` and `askai help all`, explaining command purpose, when to use it, and how it delivers token savings.
- Updated command reference poster and PDF (AskAI-commands-A3.png and AskAI-commands.pdf) to organize commands across 8 sections matching the 7 help categories plus Start here.
- Removed duplicate `askai inventory` (use `askai infra`).
- Removed duplicate `askai upgrade` (use `askai update`). Consolidated `--check`, `--dry-run`, and `--agents` into `askai update`.
- Hardened Serena and MarkItDown tool detection and upgrades against broken uv trampoline stubs (`isBrokenTrampoline`); safe skip when Serena is absent from `uv tool list`.
- Added AskAI launcher detection (`isAskaiLauncher`) and CRLF/LF line ending normalization to command installation and removal on Windows.
- Formatted `askai plugins` output in aligned tabular columns.
- Enhanced `askai audit` reporting with host/scope attribution, column alignment, and support for Antigravity, Cursor, and Codex checks.

- Group status into four environment columns, wrapping long text, with shared local utilities below. Support status HOST and status --host HOST (including antigravity/agy), also for JSON. Shared MCP and Graphify registration states are reported per host.

- Retire duplicate doctor from command help and self-test; old invocations show a migration hint only. check shows coverage for Claude Code, Codex, Antigravity and Cursor, including unavailable or unselected hosts; --all shows passing details.

- Renamed `askai cheat` to `askai direction`. `askai cheat` is retained as a backwards-compatible alias that runs `askai direction`. Updated generated documentation and command index.

- Restore interactive readline editing under inherited TERM=dumb; Windows launch sets a terminal type that supports editing. Add regression checks for Backspace, DEL and all explicit help categories.

- Windows CLI launch requests a visible PowerShell window directly, preserves the project folder and propagates launch errors. Startup shows an explicit init command for uninitialized folders.

- `/askai-cli` now opens the terminal by default, without source scans, installation, init, research, or AI review. `--review` explicitly enables the existing AI setup/review workflow. A stale or missing review does not block normal launch and is never marked current automatically. Terminal `askai init` and all other commands remain available.
- Codex usage labels raw tokens, shows uncached input and cache share, and distinguishes them from weekly plan usage and measured savings. `askai cli --prepare` keeps an existing installation's profile and skips reinstalling tools; first setup and explicit `--refresh` still configure the machine.
- Installs and upgrades also refresh an existing managed legacy `~/.claude/askai/app`, so an old PATH entry cannot run stale help or to-do checks. A registry-only `~/.askai` folder no longer switches installation state away from an existing legacy install. Configuration and completion records are preserved.
- `help` lists seven categories with command counts. `help work` lists short command descriptions; `help check` shows full command instructions. `help category NAME` and `help command NAME` resolve shared names and category aliases explicitly.
- Command help takes priority over category aliases: `askai help check` and `askai help cli` show their command instructions.

- Removed `askai usage` command support across the codebase in favor of `askai savings` (with `--full`, `--cache`, `--week`, `--import-cursor`) and `askai report`. Seven category-based help views (`askai help work|project|setup|health|cost|learn|system`) organize all 60 commands. Dynamic host and asset detection in `askai infra`: active caller session detection, desktop IDE and standalone CLI resolution for Codex, Antigravity, and Cursor, MCP server sub-table parsing fix, and dynamic reporting of Required, Recommended, and Optional token-saving assets. MarkItDown installation hardened against broken uv trampolines with automatic recovery.

## 1.3.0 (24 October 2026): compact command surface and project setup

- The generated Markdown and searchable PDF command sheets now show the framework, working loop, and every command in `askai help --list`. `askai docs check` catches sheet drift. The installer validator reads the active AskAI data directory and accepts `.git/info/exclude` for local handoffs.
- Cycle 5: twelve home commands, four global flags, and at most four flags on a command's normal help. `askai` with no command is `askai next`. Old names stay as hidden aliases. `askai cheat` and `docs/CHEAT_SHEET.md` are the working loop (machine, project, task, break, week).
- `askai run -- <command>` treats `--` as the end of options and returns the command's exit code. Prompts inside `askai cli` read one line from that prompt. Hosts are detected by the CLI on PATH. AskAI's data directory is `~/.askai` when that folder exists; an existing `~/.claude/askai` is still read. Local ignores go to `.git/info/exclude`, never a tracked `.gitignore`.
- Install does not try to install the Claude Code CLI unless `--install-host claude`. A dry run exits 0. Required failures exit 1, or 3 when the message is `needs you`. A recorded max profile is not applied in a pipe unless `--add` names a tool. Routine effort for the Haiku default is medium. The tests that locked high effort, a Claude-by-default host, and writing `.gitignore` were updated.
- The command sheet lists every current command once. Cursor's fresh-chat command on the sheet is `/new`.
- `askai test` runs write commands on a throwaway fixture and can judge line budgets, width, repeated text, and time. `--real` is read-only. `--json` and `--compare` report regressions. `askai inventory` is the tools-and-repo report (`infra` is the same command). Status hides tools for a host that is not installed. Plugin savings reports run in parallel with a 3 second timeout on headroom and graphify. A map scan is cached under `.ai-work/cache`.
- `askai help` is a column list. A handoff that still has `TODO(you)` is not safe to clear. Peak hours stay out of `askai check`. `say hi` routes to chore. The map skips ThirdParty, `_out`, and Build and tells you to use `graphify query`. The Node 20 line prints at most once per day. The status header is three short lines. The test that required the old profile sentence was updated.
- The command reference poster and PDF name the lean default, `claude-haiku-5-5`, `askai update` for AskAI itself, and `askai test` for a command-by-command capture. `askai doctor` is shown as the same rows as `askai check`.
- `askai doctor` is an alias of `askai check`. The short help and `askai help install` no longer list the home-directory flags or the nine install booleans (`--rtk`, `--context-mode`, `--markitdown`, `--ccusage`, `--caveman-plugin`, `--headroom`, `--graphify`, `--context7`, `--repomix`). Those flags still parse. Sandbox homes also read `ASKAI_CLAUDE_HOME`, `ASKAI_CURSOR_HOME`, `ASKAI_CODEX_HOME`, and `ASKAI_AGY_HOME`. `askai route` and `askai go` stay on Sonnet until two Sonnet runs exit non-zero. That count is `.ai-work/sonnet-failures`. A later Sonnet exit of 0 clears it. Opus does not add to the count. A chore stays on Haiku.
- Resume for Claude Code reads `expires_at` and `recache_tokens_if_cold` from the newest status-line snapshot. `askai usage --cache` prints those fields. `ask cache` names the legacy cache env vars and does not recommend them. A recorded `max` profile is a finding; `askai profiles migrate` renames it to `experimental` and does not change tools. `askai check` and the file validator share `validateFiles()`. `askai stop` will not signal this process, tmux, sshd, or the Cursor server.
- `askai version --all` prints the Windows, Linux, and container support matrix. `askai check --env` prints OS, shell, Node, TTY, git, package manager, container, HOME, and the clipboard method. Node 20 prints one end-of-life line and does not crash. `engines` is `>=20`. `askai test` records that header and uses a sandbox home under the working tree.
- `askai report` is now `askai usage --full` plus one `askai check --brief` line. `askai savings` is `askai usage --plugins`. The tests that required the numbered report sections were updated. `askai guide` with no topic prints only the current moment. `askai usage --import-cursor FILE.csv` sums tokens from a Cursor usage export and refuses an unknown layout.
- The default help banner is grouped and stays within 30 lines. `askai help all` still lists every command. The banner names profiles `code` and `experimental`; `coding` and `max` stay aliases. A machine with no Claude Code install prints one hint, `askai install --target claude --seed-only`, and does not ask a question. The tests that required the long banner and a silent missing host were updated.
- Routine Claude Code installs now set `claude-haiku-5-5` when no model is set. The tests that locked `claude-sonnet-5-5` were updated. Sonnet stays the build and lead tier. A short name `haiku` already in settings is rewritten to `claude-haiku-5-5`.
- Resume states the verified Claude Code cache rules only when `--host claude` is passed. Other hosts get the 60-minute rule and no cache claim. Switching model is described as a full re-read.
- The default profile is lean. `askai install --add` adds components and `--list` prints ids. `askai check` on a folder also reports the project pack. A devcontainer home is a finding. `askai break` writes a snapshot and a handoff draft. `askai convert scan --yes` converts when markitdown is installed and caches the Markdown. `models.ladder.json` stores the model order.
- A repeated project scan is reused until a file's size or time changes. `askai setup --yes` runs install, then init. `askai usage` with sessions prints one row per tool. `askai go` keeps the preflight to six lines. Profiles `lean`, `code`, and `experimental` sit beside the existing names. A firmware tree asks for `compile_commands.json`. Prompt hooks stay available with `--only` and are no longer in the default set.
- `askai todo` reuses its item list for the same context and folder until a watched file or the done-list changes. The printed list stays the same.
- `askai status` reads `.ai-work/profile.json` for the project profile and still prints a suggestion. `askai init` records that file once. `askai install` prints how many components it will install and skip. `askai setup` adds a preflight line. Chore effort defaults to medium, and Claude lead effort defaults to high. `askai go` with a task and no host uses Claude Code. When the agent exits, go writes a snapshot and a handoff draft. `askai bootstrap` writes a devcontainer post-create script. `askai convert scan` lists PDF and Office files.
- `askai test` runs the safe commands, prints a short status and action items, and writes the full output to one capture file. Install, update, and commands that launch an agent are skipped.
- `askai check` collects each finding once (`id`, area, host, severity, fix) and prints that list. The same context and folder are not scanned again in one run.
- `askai doctor` prints the same rows as `askai check`.
- `askai audit` prints the cost findings from that same list. The rest of the seven-point audit stays.
- `askai setup` prints which hosts are present, the check counts, and the file-validator result. Status, infra, plugins, and the to-do list stay on their own commands.
- `askai usage` with no Claude Code or Codex sessions prints one reason and where to read Cursor usage. It does not print a table of zeros.
- `askai report` with no transcripts prints that same two-line message in the spend section. It does not print a zero ledger.
- `askai usage --cache` prints cache hit per session from status-line snapshots. An empty window is one line, not a table of zeros.
- `askai usage --plugins` prints one savings line for each installed plugin. None installed is one line. A missing plugin is omitted, including its usage text.
- `askai usage --full` prints the session summary, the cache section, and the plugin lines. Empty sessions, snapshots, and plugins stay the short lines. No zero tables.
- `askai project refresh` creates only missing init files, then rewrites the project map and prints the review state. The summary is at most 8 lines.
- `askai why <finding-id>` prints that finding's message and fix. An unknown id is one line.
- `askai ask` reads every topic from `knowledge/*.yaml`. Printed answers are unchanged.
- `askai status` reuses the component scan already stored for that context. A later status or doctor in the same run does not detect each tool again. The printed rows stay the same.
- `askai update` updates AskAI itself. `askai tools update` upgrades installed tools. `askai upgrade` still works and says so at most once a day.
- `askai project` with no arguments shows the current project. `askai project rules` copies Cursor rules. Init prints created and changed files only. A review stays current when the only change is a small number of deletions.
- Check skips a host that is not installed. Status hides retired handoff, token-kit and prompt-hook rows and shows how much of the requested profile is actually in effect. Sign-in and model confirmations are habits, not open to-dos.
- The session ledger stores one JSON event per line (branch, commit, tracked, untracked) and the readable note is rendered from those events. A template handoff is one line in check, clear, and resume.
- `askai ask` with no topic lists topics by group. A topic prints the best match and a Related line.
- `askai break` names running agent processes with pids, or says none are running. `askai diff` counts untracked files that are not in the diff. Doctor skips "not applicable" rows.
- Unknown commands suggest a close name and stop. `askai sesion` no longer prints the whole banner. The banner's first sentence is one line again.
- `askai savings` calls `headroom perf`. A plugin report that fails is one line and the vendor text goes to `.ai-work/askai.log`.
- MCP and Graphify registration is one mark per host (`Cursor ✔ · Claude Code –`), not a joined sentence.
- `askai statusline` on a terminal explains that it reads Claude Code's JSON. `askai hook` on a terminal says the hooks are retired. `askai graph` prints the file path when Linux has no display.
- `askai go` no longer starts Claude Code, Codex, Cursor, or Antigravity when the process has no terminal. A container or a piped command used to wait forever. It prints the command and returns. Run it in the Cursor terminal.
- Removed command names that only repeated another command: `continue` is `resume`, `etiquette` is `guide all`, `work` is `guide work`, `checkpoint` is `session pause`, `peak` is `tips peak`, and `projects` is `project list`. Typing an old name prints the command that replaced it.
- `askai cli --prepare` installs the `max` profile for the recorded target and records that profile. `/askai-cli` then inits the project in the same run. Components already healthy are skipped.
- When `astral.sh` is blocked, uv is installed with `python3 -m pip install --user uv` and the blocked host is not retried. Serena, Headroom, Graphify, and MarkItDown then continue. Context Mode stays off on Node older than 22.5 instead of asking for a Node replacement. `gh` without Homebrew names `sudo apt-get install -y gh`.
- The one-time Graphify build is `graphify update .` (source only, no tokens). `/graphify .` stays available when docs and images should be in the graph. `askai init` gitignores `graphify-out/` and turns off Graphify's always-on Cursor rule.
- `askai chat` prints a short instruction for every Claude, ChatGPT, and Gemini chat, plus a brief for a separate project such as a book. Claude Code, Cursor, Codex, and Antigravity stay on `askai install`.
- `docs/CHEAT_SHEET.md` lists each command with the job it does, including chat apps, Graphify, and Serena. `docs/AskAI-commands-A3.png` is that reference as an A3 portrait page. `docs/AskAI-commands.pdf` is the same list, one command at a time.
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
