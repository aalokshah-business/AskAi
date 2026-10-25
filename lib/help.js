'use strict';
// askai help <command>: one entry per command. Also the source of the command reference in docs/ARCHITECTURE.md
// (scripts/gen-docs.js), so the terminal help and the document never disagree.
const H = {
  cli: { usage: 'askai cli [--prepare] [--launch] [--review] [--path DIR] [--about TEXT]', summary: 'Prepare a project from the chat folder, then open an AskAI-only terminal. AI review is opt-in.',
    summaryParagraph: "Opens the dedicated interactive AskAI shell with project auto-detection and persistent terminal state. Use it when running multiple AskAI commands without repeatedly typing the askai prefix. It saves tokens by keeping routine diagnostics and session commands local; explicit AI reviews and launched AI agents still use model tokens.", detail: ['Default --prepare selects the project and returns action launch without source scans, installation, init, research, description questions, or review-marker changes. It does not claim the pack is reviewed. --refresh alone does not opt into review.', 'Use --prepare --review only when AI setup or analysis is explicitly requested. Review requires --about when the pack is new or stale; --yes does not bypass that question. First setup installs max; existing recorded profiles skip installation unless --refresh is also supplied. Missing or stale pack files are initialized for the host agent to review.', 'Only after an actual AI review should the host run askai review done. Normal launch works even when review is stale. Interactive terminals correct inherited TERM=dumb so Backspace works; exit and reopen old shells after an update to load current help. Windows requests a visible PowerShell window in the selected folder; if none appears, run askai cli manually. Uninitialized folders show askai init --path at startup without running it. On SSH or a devcontainer, --launch uses tmux, screen, or the current terminal. Terminal commands use no model tokens unless they launch AI; invoking the chat skill itself still uses tokens.'], examples: ['askai cli --prepare --json', 'askai cli --prepare --review --path C:\\work\\shop --about "A shop for members" --json', 'askai cli --launch', 'askai> exit'], exit: '0, or 2 when the project (or description during explicit review) must be supplied' },
  install: { usage: 'askai install [--profile P] [--target T] [--retry] [--dry-run] [--yes] [options]', summary: 'Install and wire the token-saving setup for Claude Code, Codex, Antigravity and Cursor.',
    summaryParagraph: "Installs and wires token-saving configurations, rule files, and baseline defaults across Claude Code, Cursor, Codex, and Antigravity. Use it when setting up a new development environment or switching profile tiers. It saves tokens by enforcing terse output rules, lower default reasoning tiers, prompt-caching configurations, and idle-drain protections across all AI hosts.",
    detail: ['Detects each component, shows the plan, asks once, installs what is missing or partial, and records what it added in a manifest.', 'Sandbox homes: ASKAI_CLAUDE_HOME, ASKAI_CURSOR_HOME, ASKAI_CODEX_HOME, ASKAI_AGY_HOME. Extra tools: askai install --add ID.', 'Adds settings only when you have not set them; backs up every file before its first change; never prompts for a password. On a headless Linux machine, install, update and setup install tmux when the user is root or sudo -n works, so askai cli --launch can open a session. If astral.sh is blocked, uv is installed with python3 -m pip install --user uv.', 'If the standalone token-setup script was run on this machine, AskAI first runs its --uninstall (component token-kit) and then applies the same settings itself, so the rules load once.', 'Step-by-step instructions for each OS, the environment setup and every file it creates: docs/INSTALL.md.'],
    options: [['--profile minimal|coding|docs|full|max|lean|code|experimental', 'tool set by kind of work (default lean; code = coding; experimental = max)'], ['--add ID,ID', 'add components to the profile'], ['--list', 'print component ids and stop'], ['--host cursor|claude|codex|agy', 'limit one command to that host'], ['--brief', 'shorter status'], ['--quiet', 'skip the once-a-day hints'], ['--no-color', 'plain text'], ['--target auto|claude|codex|agy|cursor|all|a,b', 'hosts to wire (default auto: Claude Code plus every tool found)'], ['--seed-only', 'write settings for a host that may not be installed yet (default target claude)'], ['--dry-run', 'show the plan, change nothing'], ['--only ID,ID / --skip ID,ID', 'limit or exclude components'], ['--main-model M / --subagent-model M', 'Claude Code models when unset (default claude-haiku-5-5, subagent haiku; keep leaves the main model alone)'], ['--codex-model M', 'Codex model when config.toml has none'], ['--caveman off|lite|full|ultra', 'terse-reply level (default full)'], ['--lsp ts,py,kotlin,ruby,swift', "Claude Code's official code-intelligence plugins"], ['--lean-git', "also drop Claude's git instructions from every turn"], ['--base-tools', 'also install ripgrep, jq and gh where missing'], ['--codebase-memory / --claude-mem', 'one flag each, not in max: another code-navigation server; a memory plugin that summarises sessions with your plan'], ['--force', 're-run components already healthy']],
    legacy: '--claude-home --cursor-home --codex-home --agy-home --rtk --context-mode --markitdown --ccusage --caveman-plugin --headroom --graphify --context7 --repomix',
    writes: 'settings.json, CLAUDE.md, rules, commands, skills, config.toml, AGENTS.md, GEMINI.md, Cursor rules, MCP configs; the manifest and backups under ~/.askai/ (legacy ~/.claude/askai/ remains supported)', examples: ['askai install --dry-run', 'askai install --target all --profile code --project ~/code/app', 'askai install --target all --profile full', 'askai install --target claude,codex --lsp ts,py'], exit: '0 when required items work; 1 on required failure; 3 when a required item needs you' },
  update: { usage: 'askai update [--dry-run] [--check] [--agents] [install options]', summary: 'Update AskAI itself from GitHub and re-apply the recorded profile.',
    summaryParagraph: "Fetches the latest AskAI release from GitHub and reapplies your recorded profile to ensure tools and rule blocks stay current. Use it regularly to keep your setup synchronized with upstream optimizations. It saves tokens by ensuring your prompt rules, model baselines, and integrations utilize the newest token-reduction strategies.", detail: ['Uses the stored source checkout (usually ~/.askai/src; existing ~/.claude/askai/src remains supported). Options after update go to install.', 'ASKAI_REPO (owner/name) or ASKAI_REPO_URL (a full git URL or path) point at a fork or a test copy.', 'askai tools update upgrades installed tools such as Serena and ccusage.', '--check tests whether a newer commit is available on the remote without updating.', '--agents opens Claude Code, Cursor and Codex in sequence for source-backed reviews. It uses model tokens.'], options: [['--check', 'check remote git for updates without applying'], ['--dry-run', 'show what it would fetch and run'], ['--agents', 'after install, review with Claude Code, Cursor and Codex']], examples: ['askai update', 'askai update --check', 'askai update --dry-run'], exit: '0, or 1 when install or the agent workflow fails' },
  tools: { usage: 'askai tools update [--target T]', summary: 'Upgrade the tools AskAI installed and refresh its rule blocks.',
    summaryParagraph: "Upgrades AskAI-managed external packages like Serena, MarkItDown, and ccusage while refreshing rule blocks. Use it when new tool releases are available. It saves tokens by keeping language indexers and document converters on fast, stable releases that avoid broken trampoline stubs and failed extraction attempts.", detail: ['Runs each component\'s update step (CLI upgrades, Serena, rule text) and keeps your own settings.'], examples: ['askai tools update'], exit: '0 or 1' },
  status: { usage: 'askai status [codex|antigravity|cursor|claude] [--host HOST] [--json]', summary: 'Status in four environment columns, or one selected environment.',
    summaryParagraph: "Reports real-time configuration health, MCP registrations, and tool states organized in environment columns. Use it to verify which hosts are ready and whether local optimizers are active. It saves tokens by surfacing misconfigurations offline so you never waste prompt turns discovering that a rule or server failed to load.", detail: ['Default columns: Codex, Antigravity, Cursor, Claude Code. Narrow terminals use two columns or stacked sections. Shared local utilities appear below the columns. Long text wraps without being omitted; widen the terminal for four-column readability.', 'Use a positional environment or --host; agy is an alias of antigravity. The same filter applies to JSON. Shared MCP registration states are projected onto the selected environment rather than reported as globally healthy.', 'Shows each component as ok, partial, missing or other. Installation and configuration checks do not prove live usage or measured net savings.'], examples: ['askai status', 'askai status codex', 'askai status --host antigravity', 'askai status --host cursor --json'], exit: '0; invalid environments fail' },
  setup: { usage: 'askai setup [dir] [--yes]', summary: 'Short check after install: which hosts are present, check counts, and whether the file validator passed.',
    summaryParagraph: "Runs a rapid post-install validation checking host presence, rule counts, and file integrity. Use it immediately after install or project init to confirm your environment is sound. It saves tokens by ensuring required short rule files are active and preventing broken setups that cause models to fall back to verbose defaults.", detail: ['Does not reprint status, infra, plugins, or the to-do list. Those stay on askai status, askai infra, askai plugins ready, and askai todo.', 'A finding that needs a fix now is listed, up to three. The file validator prints only its failures.', 'Sign-in, restart, and model checks stay in the to-do list.', '--yes runs install, then init. --yes --dry-run prints those two commands and changes nothing.'], examples: ['askai setup', 'askai setup ~/code/shop', 'askai setup --yes'], exit: '1 when a finding needs a fix now or the file validator fails, else 0' },
  check: { usage: 'askai check [dir] [--fix] [--json] [--env]', summary: 'Audit this machine and a repository against the token-saving guidelines.',
    summaryParagraph: "Audits your machine and repository against token-saving guidelines, identifying leaks, oversized rules, and unneeded billable keys. Use it after installation, weekly, or whenever AI usage spikes. It saves tokens by catching high-severity configuration leaks like unneeded API keys, oversized instruction files, and inactive prompt caching.", detail: ['Machine: billing variables, default and subagent models, effort, idle drains, CLAUDE.md size, MCP counts, RTK and Context Mode, Codex keys and AGENTS.md size, Antigravity paid credits and GEMINI.md size, Cursor rules, peak hours.', 'Repo: AGENTS.md and CLAUDE.md (present, size, import), .cursorignore, .ai-work/ gitignored, age of the last handoff.', 'Each gap is printed with the command that fixes it. All four hosts have a coverage summary; passing details are hidden unless --all. Unavailable or unselected hosts are labeled. doctor is retired; use check.', 'askai check --env prints the platform block only: OS, shell, Node, TTY, git, package manager, container, HOME, clipboard.', 'askai setup prints the counts. This command prints each row.'], options: [['--fix', 'scaffold the repo and create .ai-work (never overwrites)'], ['--json', 'machine-readable rows'], ['--env', 'platform block only']], examples: ['askai check', 'askai check . --fix', 'askai check --env'], exit: '1 when a finding is severity now (bills outside your plan), else 0' },
  why: { usage: 'askai why <finding-id>', summary: 'The message and fix for one finding from askai check.',
    summaryParagraph: "Explains the technical reasoning and exact fix command for any diagnostic finding reported by askai check. Use it whenever a health check flag needs explanation or remediation. It saves tokens by providing instant offline guidance and copy-paste fixes, eliminating the need to ask an AI agent how to resolve configuration warnings.", detail: ['An unknown id is one line.'], examples: ['askai why repo.agents-missing'], exit: '1 when the id is unknown, else 0' },
  next: { usage: 'askai next [dir]', summary: 'The top actions from askai check: at most 3 to do now and 2 for later.',
    summaryParagraph: "Surfaces the top 3 immediate actions and 2 upcoming steps from your latest health checks. Use it at the start of a session, after breaks, or whenever you need direction on what to tackle next. It saves tokens by directing you to the highest-leverage task immediately, eliminating exploratory queries and trial-and-error prompts.", examples: ['askai next'], exit: '0' },
  handoff: { usage: 'askai handoff [dir] [--for claude|codex|cursor|agy] [--fill]', summary: 'Write .ai-work/HANDOFF.md from git facts. Judgment fields stay as TODO(you).',
    summaryParagraph: "Generates a structured note in .ai-work/HANDOFF.md capturing git changes, touched files, and open decisions. Use it before concluding a session or clearing context. It saves tokens by transferring essential project state to the next agent session in under 30 lines, avoiding costly full-codebase rescans.", detail: ['--for prints a short resume prompt for that host. --fill prints a prompt that asks the agent to complete only the TODO lines.'], examples: ['askai handoff', 'askai handoff --for codex'], exit: '0' },
  weigh: { usage: 'askai weigh <path> [--threshold N]', summary: 'Offline token estimate (chars/4), labeled estimate. Flags a file over the threshold.',
    summaryParagraph: "Calculates fast offline character-based token estimates for files or directories and flags items exceeding safe thresholds. Use it before asking an agent to read a large document or log. It saves tokens by preventing accidental injection of massive files into the prompt window that would inflate context costs.", examples: ['askai weigh docs/ai/SOURCE_INDEX.md'], exit: '1 when the path cannot be read, else 0' },
  run: { usage: 'askai run -- <command>', summary: 'Run a command, keep the full log in .ai-work/last.log, and print the exit code plus the last lines.',
    summaryParagraph: "Executes build, test, or lint commands while capturing full output to .ai-work/last.log and displaying only the exit code and trailing lines. Use it for all terminal commands in an AI workflow. It saves tokens by preventing noisy compiler logs, test progress bars, and stack traces from consuming the context window.", detail: ['A command that looks like flash, reboot, or copy_dut waits for --yes.'], examples: ['askai run -- npm test'], exit: 'the command exit code, or 1 when a risky command has no --yes' },
  errors: { usage: 'askai errors [log]', summary: 'Print error lines from a log, with two lines of context, de-duplicated.',
    summaryParagraph: "Extracts and deduplicates the primary failure lines from .ai-work/last.log with 2 lines of context. Use it immediately following a failed askai run command. It saves tokens by distilling thousands of lines of terminal noise down to the exact 5 to 15 failure lines an agent needs to fix the issue.", examples: ['askai errors .ai-work/last.log'], exit: '0' },
  snapshot: { usage: 'askai snapshot [dir] [--include-untracked]', summary: 'Write a git diff patch and an untracked-file list under .ai-work/snapshots. Does not stash or commit.',
    summaryParagraph: "Saves current staged, unstaged, and untracked work into a standalone patch file under .ai-work/snapshots without altering git branches. Use it before risky agent refactors or exploratory edits. It saves tokens by providing an instant offline baseline to revert bad changes, avoiding lengthy AI-driven debugging and rollback chats.", detail: ['--include-untracked copies untracked work files under 1 MB, skipping tool directories.'], examples: ['askai snapshot'], exit: '0' },
  route: { usage: 'askai route "task"', summary: 'Pick a tier from the task words and print the cheaper-first escalation rule. Does not launch an agent.',
    summaryParagraph: "Analyzes task wording to recommend the cheapest appropriate model tier (chore, build, or lead) and escalation rules. Use it before assigning a task to an agent to select the most economical tier. It saves tokens by preventing simple chores from running on costly frontier models, cutting routine execution costs significantly.", examples: ['askai route "rename the helper"'], exit: '0' },
  stop: { usage: 'askai stop [--yes]', summary: 'List running agent CLIs. --yes terminates them.',
    summaryParagraph: "Scans for and terminates lingering background agent CLI processes and orphaned sessions. Use it when agent processes hang, loop continuously, or remain active after terminal closure. It saves tokens by immediately halting unattended processes and retry loops that silently consume background API quotas.", examples: ['askai stop'], exit: '0' },
  bootstrap: { usage: 'askai bootstrap [dir] [--profile P] [--repo]', summary: 'Show a personal devcontainer setup; --repo writes a post-create script into this project.',
    summaryParagraph: "Configures devcontainer dotfiles and post-create scripts to wire AskAI inside containerized environments. Use it when setting up Docker containers, Codespaces, or remote dev environments. It saves tokens by automating rule enforcement and terse modes in containers so agents operate efficiently from the first turn.", examples: ['askai bootstrap', 'askai bootstrap --repo'], exit: '0' },
  ask: { usage: 'askai ask <words>', summary: 'Offline answers on etiquette and the research: the rule, why, the command in each tool, and what AskAI automates.',
    summaryParagraph: "Searches AskAI built-in knowledge base offline to answer questions on token habits, research, and tool etiquette. Use it whenever you need clarification on best practices or optimization strategies. It saves tokens by providing immediate answers locally with zero model calls or network queries.", detail: ['Keyword search over the built-in knowledge base; no model call, no network.'], examples: ['askai ask compact', 'askai ask coming back after a break', 'askai ask is rtk worth it', 'askai ask superclaude'], exit: '0 when something matches, 1 otherwise' },
  start: { usage: 'askai start --tool T --task "..." [--repo DIR]', summary: 'Start a task: ledger entry with tool, task, branch and last commit.',
    summaryParagraph: "Records an initial task entry in the session ledger tracking tool, task summary, branch, and commit. Use it when beginning any distinct unit of work. It saves tokens by keeping task goals explicit and bounded, preventing scope creep and unnecessary file exploration by the agent.", examples: ['askai start --tool claude --task "Fix mobile nav"'], exit: '0' },
  break: { usage: 'askai break [--summary "..."] [--next "..."] [--repo DIR] [--dry-run]', summary: 'Before a break: checklist, running agent CLIs, handoff reminder, a ledger entry and the break time.',
    summaryParagraph: "Displays a pre-break checklist, verifies agent process states, reminds you to save a handoff, and logs a pause. Use it whenever stepping away from the keyboard for more than 15 minutes. It saves tokens by encouraging clean context boundaries so you do not resume with expired prompt caches or stale mental context.", examples: ['askai break --summary "menu closes, tests green" --next "check 320px"'], exit: '0' },
  resume: { usage: 'askai resume [--copy] [--repo DIR]', summary: 'Coming back: time away, continue-or-fresh advice from the cache lifetime, the handoff, git state, the resume prompt.',
    summaryParagraph: "Inspects elapsed time, cache lifetime, git status, and the handoff file to generate a copy-ready resume prompt. Use it upon returning from a break or starting a fresh session. It saves tokens by advising whether to continue or restart and producing a focused prompt that loads only the files required.", options: [['--copy', 'copy the prompt with pbcopy, clip, wl-copy, xclip or xsel']], examples: ['askai resume --copy'], exit: '0' },
  report: { hidden: true, usage: 'askai report (retired)', summary: 'Retired. askai report is retired. Run askai savings (plugin savings) or askai check (health checks).', exit: '0' },
  session: { usage: 'askai session init|pause|status|finish|measure|report [--repo DIR] [...]', summary: 'The per-repo ledger in .ai-work/: entries, handoff, measurements, report. askai start, askai break and askai resume are the daily names for those three actions.',
    summaryParagraph: "Manages the per-repository ledger in .ai-work/ for tracking entries, measurements, difficulties, and time spent. Use it to log work milestones, evaluate productivity, and inspect token expenditure. It saves tokens by providing offline metrics and history without requiring conversational recaps or AI auditing.", detail: ['measure requires --tool, --task and --success (0 or 1); blank or invalid measurements are not saved. Optional: --model --effort --task --difficulty --minutes --input-tokens --output-tokens --cached-tokens --success 0|1 --rework-minutes --usage-source --notes', 'report [dirs...]: accepted tasks and tokens per tool and difficulty.', 'session pause records a task boundary without the break checklist. session start, session break and session resume still run the same actions as the short commands.'], examples: ['askai session measure --tool codex --task "completed task" --difficulty simple --minutes 12 --input-tokens 8000 --output-tokens 1500 --success 1', 'askai session report ~/code/app1 ~/code/app2'], exit: '0' },
  scaffold: { usage: 'askai scaffold [dir] [--dry-run]', summary: 'Write the files every agent reads: AGENTS.md, CLAUDE.md, docs/ai/PROJECT_PROFILE.md, .cursorignore, .ai-work/. Never overwrites.',
    summaryParagraph: "Generates essential starter guidance files including AGENTS.md, CLAUDE.md, and .cursorignore without overwriting existing files. Use it when setting up a new repository or subproject. It saves tokens by installing clean ignore rules and short routers early, preventing models from ingesting untracked or binary assets.", examples: ['askai scaffold ~/code/myapp'], exit: '0' },
  suggest: { usage: 'askai suggest [dir]', summary: 'Recommend a profile from the files in a folder.',
    summaryParagraph: "Analyzes repository structure, file extensions, and dependencies to recommend the most suitable AskAI profile. Use it when onboarding a new project and deciding on configuration depth. It saves tokens by recommending lean setups tailored to actual needs, avoiding unused tools that add schema overhead.", examples: ['askai suggest .'], exit: '0' },
  profiles: { usage: 'askai profiles', summary: 'What each profile installs.',
    summaryParagraph: "Lists all available AskAI profiles (lean, code, docs, full, experimental) and the components each profile installs. Use it to evaluate which profile matches your workflow requirements. It saves tokens by making profile trade-offs transparent so you choose minimal configurations that avoid unnecessary background tools.", examples: ['askai profiles'], exit: '0' },
  project: { usage: 'askai project [dir] [--print|--remove] | list | show | rename OLD NEW | path NAME NEW_PATH | remove NAME | switch [NAME] | refresh [dir] | hide-local [dir] [--personal|--shared|--undo]', summary: 'Manage registered projects, or copy Cursor rules into a repository for teammates.',
    summaryParagraph: "Manages registered project folders, refreshes knowledge packs, and configures local git exclusions. Use it when switching between projects or updating shared team rules. It saves tokens by keeping project router files synchronized and excluding local AI state from version control and workspace indexing.", detail: ['list prints every registered name and path. show reports the selected project. rename, path and remove change only the registry; remove never deletes project files.', 'refresh creates only missing init files, then rewrites the project map and prints the review state. At most 8 lines. A current review skips the map rewrite. It also hides local AI paths.', 'hide-local adds AskAI paths to the local git exclude list. --personal is that default. --shared prints the team checklist and writes nothing. --undo removes that block.', 'Without a subcommand, the existing Cursor rules behavior is preserved.'], examples: ['askai project list', 'askai project show', 'askai project rename old new', 'askai project path app C:\\code\\app', 'askai project .', 'askai project refresh .', 'askai project hide-local', 'askai project hide-local --shared'], exit: '0' },
  set: { usage: 'askai set project NAME | project --clear | default NAME | default --clear', summary: 'Select a project for this terminal or set a persistent fallback.',
    summaryParagraph: "Selects the active project for the current terminal or designates a persistent default fallback. Use it when working across multiple repositories or shells. It saves tokens by ensuring commands resolve against the correct project paths, preventing mistaken reads against unrelated codebases.", detail: ['Project selection stays in askai cli, or in a shell after enabling askai shell init. The persistent default is used when no project is active or detected from the current directory.'], examples: ['askai set project digimanova', 'askai set project --clear', 'askai set default digimanova'], exit: '0, or 1 for an unknown project' },
  shell: { usage: 'askai shell init powershell|bash|zsh | install SHELL --path PROFILE | uninstall', summary: 'Enable terminal-scoped project selection in a shell.',
    summaryParagraph: "Generates shell integration hooks for PowerShell, bash, or zsh to maintain terminal-scoped active projects. Use it during initial setup to enable seamless shell navigation. It saves tokens by tracking active project context automatically, eliminating path errors and redundant directory discovery.", detail: ['Install adds one managed block to a shell profile; uninstall removes only blocks AskAI installed. The installers offer this with -ShellIntegration or --shell-integration.'], examples: ['Invoke-Expression (& askai shell init powershell)', 'eval "$(askai shell init bash)"'], exit: '0' },
  tips: { usage: 'askai tips [claude|codex|agy|cursor|session|habits|peak]', summary: 'The cheat sheet, offline, per tool. peak says whether Claude is in peak hours now.',
    summaryParagraph: "Displays offline cheat sheets, keyboard commands, and peak pricing hours tailored to each AI tool. Use it when starting work in Cursor, Claude Code, Codex, or Antigravity. It saves tokens by reminding you of native context commands and warning against expensive provider peak hours.", examples: ['askai tips codex', 'askai tips peak'], exit: '0' },
  test: { usage: 'askai test [--out FILE] [--json] [--real] [--notty] [--compare FILE]', summary: 'Run the safe commands one by one, print a short status, and write one capture file.',
    summaryParagraph: "Executes safe AskAI commands on disposable fixtures to verify response formats, line budgets, and timing. Use it to validate AskAI operation on your platform without modifying real files. It saves tokens by verifying that output budgets remain concise, guaranteeing terminal outputs stay within token-friendly bounds.", detail: ['Default: sandbox homes and a throwaway fixture repo. The status says which commands finished and which are over their line budget.', 'askai test --real runs read-only commands against the real homes and this repo. It does not write.', '--json writes one object per command: cmd, exit, ms, lines, maxWidth, flags.'], options: [['--out FILE', 'capture path (default .ai-work/askai-test.txt in the current folder)'], ['--json', 'write {cmd, exit, ms, lines, maxWidth, flags} per command'], ['--real', 'read-only commands against the real homes; no writes'], ['--notty', 'rerun a short subset with stdin closed'], ['--compare FILE', 'print line and time regressions against a previous --json file']], examples: ['askai test', 'askai test --out askai-test.txt', 'askai test --real', 'askai test --json --compare previous.json'], exit: '0 when every command finished, 1 when one did not run' },
  statusline: { usage: 'askai statusline [--demo]', summary: "Claude Code's status line command (reads the session JSON on stdin): model, context, cache; records snapshots for askai savings.",
    summaryParagraph: "Outputs Claude Code status line showing model, context percentage, and cache status while recording snapshots. Use it configured as Claude Code status line command. It saves tokens by providing continuous visibility into context growth so you can compact or hand off before token costs escalate.", detail: ['On a terminal with no JSON, it prints how to try it. Claude Code pipes the session JSON; that path still prints one status line.'], exit: '0' },
  restore: { usage: 'askai restore [stamp] [--dry-run] [--yes]', summary: 'List backup timestamps, or restore supported configuration files from one backup.',
    summaryParagraph: "Lists automatic configuration backups and restores supported configuration files from a selected timestamp. Current files are backed up before restoration. This is a local recovery operation and does not call AI.", examples: ['askai restore', 'askai restore 2026-10-24T14-13-19-996Z --dry-run'], exit: '0 or 1' },
  uninstall: { usage: 'askai uninstall [--only ID,ID] [--dry-run]', summary: "Remove only what AskAI added: keys still holding AskAI's value, its marked blocks, its own files and registrations.",
    summaryParagraph: "Removes AskAI-managed settings, rule blocks, and registrations while preserving your custom configurations and backups. Use it when removing AskAI from a machine. It saves tokens by executing cleanly offline from recorded manifests without requiring AI guidance or complex cleanup prompts.", examples: ['askai uninstall --dry-run', 'askai uninstall --only rtk'], exit: '0 or 1' },
  version: { usage: 'askai version', summary: 'Print the AskAI version.',
    summaryParagraph: "Prints current AskAI version, and with the all option, details system, shell, Node, and git environments. Use it when verifying updates or collecting environment diagnostics. It saves tokens by providing complete system diagnostics in one command without asking an AI model to inspect your machine.", exit: '0' },
  init: { usage: 'askai init [dir] [--name NAME] [--path DIR] [--about "..."] [--type T] [--yes] [--refresh] [--offline] [--dry-run] [--build "cmd"] [--test "cmd"]', summary: 'Scan eligible first-party source files, consult detected frameworks\' official docs, write a compact project knowledge pack and register its path.',
    summaryParagraph: "Scans source files, consults official framework documentation, and generates a compact project knowledge pack. Use it once per repository to establish AI guidance files. It saves tokens by replacing broad whole-repo indexing with a concise under-333-line router, saving up to 70% of startup prompt overhead.",
    detail: ['Reads README, manifests and every eligible first-party source file up to 1 MiB each. Excludes dependencies, build output and private files. Static imports, declarations and routes are evidence, not runtime proof. Fetches page titles from up to four fixed official documentation sites; no repository text is uploaded and no model is called. Network failures are marked in REFERENCES.md.', '  AGENTS.md (short router), CLAUDE.md, GEMINI.md', '  docs/ai/PROJECT_MAP.md, SOURCE_INDEX.md, ARCHITECTURE.md, FEATURES.md, REFERENCES.md, WORK_ORDER.md, MODELS.md', '  architect, builder and runner agents for all four tools; four skills; .cursorignore; .ai-work/ (gitignored)', 'Current task and session handoff cannot be inferred from source. Existing user text is preserved. --refresh updates generated files only when unedited.', 'askai project refresh runs init for missing files, then the map and the review.'],
    options: [['--name NAME / --path DIR', 'register a short name and project folder'], ['--project NAME / -p NAME', 'use a registered project'], ['--about TEXT / --type T', 'override detection'], ['--build "cmd" / --test "cmd"', 'override detected checks'], ['--offline', 'skip official-doc lookup (cached results remain available)'], ['--yes', 'no questions; use what was detected'], ['--refresh', 'update AskAI blocks and unedited generated files'], ['--dry-run', 'show the plan without network or writes']], examples: ['askai init .', 'askai init --name shop --path ~/code/shop --yes', 'askai init --project shop --refresh --yes'], exit: '0' },
  review: { usage: 'askai review [status|done] [--project NAME] [--json] [--all]', summary: 'Show which project inputs changed since host AI review; record completion after review.',
    summaryParagraph: "Compares source hashes and manifests against the last AI review to highlight what inputs changed. Use it before launching an AI CLI or after major pull requests. It saves tokens by pinpointing modified files so agents only review changed components rather than re-reading the entire repository.", detail: ['askai-cli checks status before its AI review. It calls done only after the agent has checked and enriched the project pack. Status compares local hashes of source, README and build manifests; JSON lists changed and removed paths. The default path list is capped at 40; --all returns every path. The marker lives in the project\'s gitignored .ai-work folder; it never proves behavior or replaces tests.'], examples: ['askai review status --project shop --json', 'askai review status --project shop --all --json', 'askai review done --project shop'], exit: '0' },
  map: { usage: 'askai map [dir] [--dry-run] [--diff]', summary: 'Regenerate docs/ai/PROJECT_MAP.md from README folder descriptions and conventional names; preserve purposes you edited.',
    summaryParagraph: "Regenerates docs/ai/PROJECT_MAP.md from folder structures and README descriptions while preserving custom notes. Use it when files or directories are restructured. It saves tokens by providing agents with a compact architectural index, eliminating costly broad directory listings and recursive file searches.", examples: ['askai map', 'askai map --dry-run --diff'], exit: '0' },
  models: { usage: 'askai models [set <tool>.<tier> <model>[:<effort>] | verify [tool]]', summary: 'Model and effort per task tier (lead, build, chore) for each tool; used by askai go and the agent files.',
    summaryParagraph: "Displays and configures model selections and reasoning effort levels across task tiers for each tool. Use it to customize model assignments or verify subscription IDs. It saves tokens by routing routine chores to fast, inexpensive models (like Haiku or Flash) and preserving premium frontier models for lead tasks.", detail: ['Defaults: Claude Code sonnet/high, sonnet/high, haiku/medium; Codex gpt-6.1-sol/high, gpt-6.1-sol/medium, gpt-6-luna/medium (there is no gpt-6.1-luna); Cursor grok-4.7 xhigh/high/medium (Sonnet tiers with cursor.useSonnet true); Antigravity flash, effort high.', 'Antigravity agent files accept only a tier (flash, pro, flash_lite, inherit). verify lists the IDs your Cursor and Antigravity accounts offer. Lead effort max is opt-in: askai go --effort is not a flag; set the tier with askai models set.'], examples: ['askai models', 'askai models set codex.chore gpt-6-luna:high', 'askai models set cursor.useSonnet true', 'askai models verify cursor'], exit: '0' },
  go: { usage: 'askai go <claude|codex|cursor|agy|task> [--tier lead|build|chore] ["task"] [--files a,b] [--done "..."] [--resume] [--dry-run]', summary: 'Start a session with the tier\'s model and effort fixed for the whole session, a structured first prompt, and a ledger entry.',
    summaryParagraph: "Starts an agent session in Claude Code, Cursor, Codex, or Antigravity with fixed tier models and a structured prompt. Use it when launching a focused coding session. It saves tokens by locking in the appropriate model and effort at the start, preventing mid-session tier drift and expensive model over-provisioning.", detail: ['A task with no host name uses Claude Code and a tier chosen from the words. Cheaper first: chore, then build, then lead.', 'Claude Code: --model and CLAUDE_CODE_EFFORT_LEVEL; Codex: -m and model_reasoning_effort; Cursor: --model (effort is part of the ID); Antigravity: prints /model and /effort to type first.', 'Shows peak hours and active MCP servers first: switch MCP servers before a session, not during it.', 'When the agent exits, AskAI writes a snapshot and a handoff draft. A container, CI job, or piped command has no keyboard. askai go then prints the command and returns, instead of waiting on the agent. Run it in the Cursor terminal.'], examples: ['askai go claude --tier build "fix the cart total rounding in src/cart.ts"', 'askai go "rename the helper"', 'askai go codex --tier chore "clean up unused imports"', 'askai go agy --resume'], exit: 'the agent\'s exit code, or 0 when there is no terminal to hand over' },
  prompt: { usage: 'askai prompt "ask" [--tier T] [--kind bug|feature|design|risky|commit|firmware] [--files a,b] [--done "..."] [--mode blunt,brutal,assume,counter,contrast] [--copy] | --output-safe "cmd" | --resume', summary: 'Turn a rough or dictated ask into a structured prompt: goal, files, done-when, constraints, output limit, tier.',
    summaryParagraph: "Transforms rough or dictated tasks into structured prompts with goals, files, done criteria, and token constraints. Use it before submitting any task to an agent. It saves tokens by removing conversational fluff and instructing the agent to return diffs and line-bounded outputs, slashing multi-turn banter.", detail: ['Removes dictation fillers, finds file names, picks a tier from the words (file names do not count). --output-safe asks the agent to plan a noisy command before running it. --resume prints the fresh-session prompt from the handoff.'], options: [["--output diff|brief|full", "diff: only the diff and one line per check; brief (default); full: with reasoning"], ["--kind bug|feature|design|risky|commit|firmware", "the pattern for that kind of task"]], examples: ['askai prompt "um so fix the login bug in src/auth.ts"', 'askai prompt --output-safe "npm run build"', 'askai prompt --resume --copy'], exit: '0' },
  mcp: { usage: 'askai mcp [list | on <name> | off <name>] [--tool claude|codex|cursor|agy] [--dry-run]', summary: 'Every MCP server in the four tools, and a switch: Antigravity\'s disabled flag, Codex\'s enabled key, parking for Claude Code and Cursor.',
    summaryParagraph: "Lists, toggles, or parks Model Context Protocol servers across Claude Code, Cursor, Codex, and Antigravity. Use it between sessions to enable only relevant tools. It saves tokens by disabling unneeded MCP servers, directly reducing prompt overhead since tool schemas are injected on every turn.", detail: ['Parking moves the entry into the AskAI data folder (usually ~/.askai/mcp-parked.json) after a backup; on puts it back. Switch between sessions: the tool list is part of the cached prompt.'], examples: ['askai mcp', 'askai mcp off playwright', 'askai mcp on serena --tool codex'], exit: '0, or 1 for an unknown server' },
  audit: { usage: 'askai audit [dir] [--tool claude|codex|cursor|agy] [--project name|dir] [--json]', summary: 'The seven-point token audit: memory files, tools and proxies, model and effort, hooks, subagents, scheduled work, cache reuse.',
    summaryParagraph: "Performs a comprehensive 7-point audit of memory rules, proxies, models, subagents, and prompt cache reuse. Use it when analyzing token spend or investigating unexpected costs. It saves tokens by uncovering hidden leaks such as unneeded subagent frontier models, bloated rule files, and poor cache hit rates.", detail: ['Reads the newest Claude Code session log: cache read share, model switches, compactions, and the model each subagent really used. Codex: cached share and models used.'], examples: ['askai audit', 'askai audit --tool claude', 'askai audit --project AskAi', 'askai audit --json'], exit: '1 when a high-severity finding exists' },
  infra: { usage: 'askai infra [dir] [--json]', summary: 'Tools and repository files.',
    summaryParagraph: "Provides a complete inventory of installed tools, hosts, MCP servers, plugins, skills, and project analysis. Use it to inspect your overall AI infrastructure offline. It saves tokens by providing a full diagnostic summary in one command, eliminating exploratory prompts about what tools are available.", detail: ['Tools and repository files: installed hosts, MCP servers, plugins, skills, and project analysis. Container diagnostics distinguish configuration paths from verified desktop presence and list missing rg/jq/gh. Caller-specific requirements do not borrow settings from other hosts.'], examples: ['askai infra', 'askai infra ~/code/shop --json'], exit: '0' },
  guide: { usage: 'askai guide [install|start|work|break|resume|clear|compact|cache|models|subagents|mcp|output|prompts|docs|plugins|peak|all]', summary: 'The etiquette for each moment of work, offline.',
    summaryParagraph: "Displays offline workflow etiquette for specific moments like starting, taking breaks, clearing, or compacting context. Use it whenever unsure of the best workflow step. It saves tokens by guiding you to clear and hand off context at the 60% threshold, preventing quadratic context growth.", examples: ['askai guide resume', 'askai guide cache'], exit: '0' },
  docs: { usage: 'askai docs [install|architecture|projects|guide|cheatsheet|changelog|preview|container|support|check] [--print]', summary: 'Find AskAI documents or check generated command documentation for drift.',
    summaryParagraph: "Opens AskAI documentation guides or verifies generated reference documents against source code. Use it to read manuals or ensure documentation consistency in CI. It saves tokens by providing complete offline documentation locally, eliminating questions to AI models about tool usage.", examples: ['askai docs', 'askai docs projects --print', 'askai docs check'], exit: '0 when current; 1 when generated docs differ' },
  plugins: { usage: 'askai plugins [list | ready [dir] | info <id> | install <id> | decisions]', summary: 'Every token tool researched: evidence, what runs on its own versus by command, installed or not. ready says which connected tools wait for a matching task, and the one-time steps still left.',
    summaryParagraph: "Lists evaluated token-saving plugins, evidence, usage guides, and installation commands. Use it to review and manage tools like Serena, Context7, and Graphify. It saves tokens by providing empirical evidence for each tool so you adopt only plugins that measurably reduce net token spend.", options: [["ready [dir]", "Serena, Context7, Headroom, Context Mode, Graphify and RTK: connected or not, when the agent should call each, and any one-time step left"], ["info <id>", "what it is, the evidence, its commands in a terminal and inside the agent, how to check it works, where to see its savings, how to switch it off"], ["install <id>", "verified installs for Context7, Repomix and Graphify"], ["decisions", "every tool AskAI evaluated, where it stands and why"]], examples: ['askai plugins', 'askai plugins ready', 'askai plugins info headroom', 'askai plugins install context7 --dry-run'], exit: '0' },
  convert: { usage: 'askai convert <file|url> [--out file.md] | askai convert scan [dir] [--yes] [--ignore-originals]', summary: 'Convert a PDF, Office file, web page or YouTube URL to Markdown with Microsoft MarkItDown, locally; never overwrites.',
    summaryParagraph: "Converts PDFs, Office files, web pages, or transcripts to clean Markdown using Microsoft MarkItDown locally. Use it before providing external documents to an AI agent. It saves tokens by stripping binary formatting, images, and styling, reducing document token footprint by up to 90%.", detail: ['scan lists PDF and Office files and an offline token estimate. --yes converts when markitdown is installed and caches under .ai-work/converted/. --ignore-originals writes the originals into .cursorignore.'], examples: ['askai convert spec.pdf', 'askai convert scan', 'askai convert scan --yes --ignore-originals'], exit: '0, or 1 when MarkItDown is missing' },
  clear: { usage: 'askai clear [compact] [--tool claude|codex|cursor|agy] [--repo DIR]', summary: 'Gate before /clear or /compact: is the handoff fresh (under 30 minutes)? Prints the native command; AskAI cannot type into a running agent.',
    summaryParagraph: "Checks whether your session handoff is fresh and safe before running clear or compact in your AI editor. Use it when context reaches 60% capacity. It saves tokens by enforcing clean handoffs before clearing, preventing the loss of critical context that leads to expensive recovery queries.", examples: ['askai clear', 'askai clear compact --tool codex'], exit: '0 when safe, 1 when a handoff is needed first' },
  context: { usage: 'askai context <percent> | --used N --window M', summary: 'What to do at this context level: continue, hand off, clear. 60% is a warning, not an order to compact.',
    summaryParagraph: "Evaluates current token usage percentage against model limits and recommends whether to continue, hand off, or clear. Use it regularly during long sessions to monitor context health. It saves tokens by alerting you before context enters high-cost quadratic attention zones, prompting timely handoffs.", examples: ['askai context 63', 'askai context --used 124000 --window 200000'], exit: '0' },
  savings: { usage: 'askai savings [days] [--cache] [--full] [--week] [--plugins] [--import-cursor FILE]', summary: 'Token savings reported by installed plugins, cache hits, and spend.',
    summaryParagraph: "Aggregates token savings, spend estimates, cache hit ratios, and plugin gains across recent sessions. Use it weekly or daily to review token efficiency. It saves tokens by tracking actual cache and plugin savings, helping you identify wasteful habits and optimize your ongoing development workflow.", detail: ['Runs each installed plugin\'s own report (rtk gain, ccusage daily, headroom perf, codebase-memory, Graphify).', '--cache prints cache hit per session from status-line snapshots.', '--full prints the session summary, then the cache section, then the plugin lines.', '--week prints the 7-day summary plus the top three findings.'], options: [['--cache', 'status-line snapshot cache hits'], ['--full', 'session summary, cache section, and plugin lines'], ['--week', '7-day summary and top findings'], ['--import-cursor FILE', 'import Cursor usage CSV']], examples: ['askai savings', 'askai savings 7', 'askai savings --week', 'askai savings --cache', 'askai savings --full'], exit: '0' },
  todo: { usage: 'askai todo [dir] [--all] | askai todo done <id> | askai todo undo <id>', summary: 'Remaining setup and project-review steps: sign-ins, restarts, app settings, model IDs, one-time plugin steps, and repository facts that need confirmation. Checkable items clear themselves.',
    summaryParagraph: "Lists pending manual setup and review steps like tool sign-ins, restarts, or model ID confirmations. Use it after installation or project review to see remaining human steps. It saves tokens by tracking action items outside the agent context window, avoiding repetitive agent reminders.", exit: '0' },
  diff: { usage: 'askai diff [dir] [--review]', summary: 'git diff --stat, staged changes and the whitespace check, so you review a change before handing off; the agent gets only the files it needs.',
    summaryParagraph: "Summarizes git diff stats, staged files, and whitespace checks before an agent review or handoff. Use it before asking an agent to review your work or create a commit. It saves tokens by giving the agent exact changed file paths and line ranges so it never reads entire unchanged files.", detail: ['--review prints a short prompt that names only the changed files.'], exit: '1 when the whitespace check finds problems' },
  graph: { usage: 'askai graph [dir]', summary: 'Print the Mermaid architecture diagram from docs/ai/ARCHITECTURE.md and open it in the browser when the terminal is interactive.',
    summaryParagraph: "Prints the Mermaid architecture diagram from docs/ai/ARCHITECTURE.md and opens it in your browser. Use it to inspect project relationships and service boundaries. It saves tokens by enabling full architectural inspection visually and locally without using model tokens for codebase exploration.", detail: ['Writes .ai-work/architecture.html and opens it. The page loads Mermaid from the network. A piped or non-interactive run only writes the file.'], exit: '0, or 1 when there is none yet' },
  hook: { hidden: true, usage: 'askai hook prompt|session (retired)', summary: 'Retired. Hooks no longer run. askai break and askai resume cover the session boundary. A piped call still reads hook JSON so an old registration does not crash.', exit: '0 always' },
  work: { hidden: true, usage: 'askai guide work', summary: 'Now askai guide work.', exit: '0' },
  etiquette: { hidden: true, usage: 'askai guide all', summary: 'Now askai guide all.', exit: '0' },
  continue: { hidden: true, usage: 'askai resume', summary: 'Now askai resume.', exit: '0' },
  checkpoint: { hidden: true, usage: 'askai session pause', summary: 'Now askai session pause.', exit: '0' },
  peak: { hidden: true, usage: 'askai tips peak', summary: 'Now askai tips peak.', exit: '0' },
  projects: { hidden: true, usage: 'askai project list', summary: 'Now askai project list.', exit: '0' },
  chat: { usage: 'askai chat [claude|chatgpt|gemini|code] [--copy]', summary: 'Where to paste a short standing instruction in Claude chat, ChatGPT, and Gemini, and how the four coding apps are set up instead.',
    summaryParagraph: "Displays recommended standing instructions and setup guides for browser chats like Claude.ai, ChatGPT, and Gemini. Use it when setting up web or desktop AI chats for coding. It saves tokens by providing concise, high-impact instructions that fit within platform custom instruction limits.", detail: ['Claude chat (claude.ai and the Claude desktop app), ChatGPT web and desktop, and Gemini Apps have no settings file AskAI can write. The instruction is sent again on every turn, so it stays short.', 'claude.ai and the Claude desktop app share Instructions for Claude. ChatGPT web and desktop share Custom instructions. Gemini Apps uses Instructions for Gemini. A project instruction replaces or adds to that only inside the project.', 'Claude Code, Cursor, Codex, and Antigravity are not configured by this paste. askai install writes their rules. AskAI cannot read the chat apps\' usage counters or move a plan reset.'], examples: ['askai chat', 'askai chat claude', 'askai chat chatgpt'], exit: '0, or 1 for an unknown name' },
  cheat: { hidden: true, usage: 'askai direction', summary: 'Now askai direction.', exit: '0' },
  direction: { usage: 'askai direction', summary: 'Print the one-screen working loop and the most useful command choices.',
    summaryParagraph: "Prints the complete one-screen working loop and top command choices covering an entire productive day. Use it as a quick visual reference for daily AI workflows. It saves tokens by keeping developers aligned with the proven minimal loop, avoiding aimless prompting and unnecessary tool usage.", examples: ['askai direction'], exit: '0' },
  help: { usage: 'askai help [category|command|all] | category NAME | command NAME', summary: 'List categories, show commands with one-line descriptions, or show detailed command help.',
    summaryParagraph: "Displays categorized command lists, detailed command manuals, option flags, and usage examples. Use it whenever you need syntax or guidance on any AskAI feature. It saves tokens by providing complete command documentation locally in your terminal, avoiding questions to AI models.", detail: ['help work lists one category. help check shows detailed command help. When a category and command share a name, use help category setup or help command setup. Category aliases also work with help category NAME. --list prints every command name.'], examples: ['askai help', 'askai help work', 'askai help check', 'askai help command setup', 'askai help category check'], exit: '0' },
};
H.mcp.usage = 'askai mcp [list | verify [NAME] | on NAME | off NAME] [--tool claude|codex|cursor|agy] [--json]';
H.mcp.detail = [...(H.mcp.detail || []), 'verify explicitly starts configured stdio server processes, sends initialize and tools/list, then stops them. It never sends tools/call or an AI request. Startup commands may themselves invoke package managers. Each server has an 8-second timeout.', 'Checks global registrations for all four hosts, plus Claude/Cursor project overrides. HTTP/OAuth, complex TOML and Windows .cmd launchers require native-client verification. A responding server does not prove that the editor is connected or that the tool saves tokens. verify is never run automatically by check, infra or the self-test.'];
H.init.detail.push('Works with any project folder, including unknown languages: use --type other --build "your command" --test "your command" when detection cannot establish the toolchain. Explicit choices persist locally across map and refresh; repeat init with replacement flags to change them. Commands are recorded, never run by init. Symbol/import extraction is heuristic and not a semantic parser for every language.');
H.project.usage += ' | build [select NAME] [--json] [--dry-run]';
H.plugins.detail = [...(H.plugins.detail || []), 'ready checks configured entries, not live connections. Use mcp verify for a bounded server probe and the native client MCP view for attachment.'];
H.savings.detail = [...(H.savings.detail || []), 'Headroom reports use its durable savings command when supported, not proxy perf data. Missing logs, broken launchers and incomplete model pricing are unavailable evidence, not zero usage or proven savings.'];
H.project.detail = [...(H.project.detail || []), 'build discovers an existing ./mk.sh wrapper, local CMake presets, PlatformIO environments and compile databases without executing builds. build select NAME records one explicit choice in .ai-work/build-selection.json and prints command argv. Conditions, inheritance and toolchain compatibility remain unverified; Zephyr board names are never guessed.'];
H.session.usage = 'askai session init|pause|status|finish|measure|report|quota [report] [options]';
H.session.detail = [...(H.session.detail || []), 'quota records manual dashboard observations: --tool cursor|antigravity --used N --window 100 --window-id ID --usage-source dashboard. Use a new window ID after a reset. quota report [--tool T] [--json] shows observed deltas; AskAI does not read account quota APIs.', 'For an observational comparison, record two readings per --variant baseline|askai with the same --name experiment, --task workload, --model ID and --effort level. Account, accepted work and other activity must be controlled by you. A difference is not proven net savings.'];
H.resume.detail = [...(H.resume.detail || []), '--copy always saves .ai-work/RESUME_PROMPT.md. OSC 52 is a clipboard request, not confirmation of a desktop paste; tmux and the outer terminal must allow it. check --env explains the available clipboard route.'];
H.version.usage='askai version [--all] [--json]';
H.version.detail=[...(H.version.detail || []),'--json reports runtime revision, content hash, installation integrity and known app copies. --all shows paths and content differences as well as platform support. The plain version remains script-compatible. Unknown revision is not presented as current.'];
H.status.usage+=' [--brief]';
H.status.detail.push('--brief reads configuration only, with no version processes, usage-log scans or live probes. It labels connection state not checked. Use it for routine terminal checks.');
H.install.options.push(['--python PATH','choose a compatible existing Python for uv tools (or ASKAI_PYTHON); no OS security settings changed']);
H.install.detail.push('Broken uv launchers are repairable even when an executable exists. Python startup failures identify --python PATH as a recovery route. Recheck startup after installation.');
H.mcp.usage+=' | telemetry [--json] | import FILE --tool T [--dry-run]';
H.mcp.usage+=' | connections [--tool T] [--json] | confirm NAME --tool T --success 1|0 --notes TEXT [--test-tool NAME] [--dry-run]';
H.mcp.detail.push('connections lists outstanding native-client checks. confirm records a user-reported result only after inspecting the native MCP view; optionally name a successfully called tool. These reports expire after 24 hours or config-file changes, remain distinct from server probes, and never set clientConnectionVerified true. No client is restarted and no AI request is made.');
H.mcp.detail.push('verify --record saves a dated server-process-only result locally. It never claims native-client attachment. telemetry reads bounded structured Codex MCP calls and normalized exports, reporting partial coverage. import accepts JSONL rows with timestamp, server, tool, eventId and status success|failure|unknown; it deduplicates IDs and discards arguments, outputs and auth fields. Antigravity opaque logs are not guessed.');
H.graph.usage+=' | query "question" [--timeout 10] [--budget 600] | status [--json]';
H.graph.detail=[...(H.graph.detail || []),'query runs the local Graphify CLI with a 1–60 second deadline and 100–4000 token budget; failures return an rg fallback. It never rebuilds or launches AI. status checks modification-time freshness against the Git source inventory; this is a heuristic. Refresh explicitly with graphify update .'];
H.session.usage='askai session init|pause|status|finish|measure|report|quota [plan|report] [options]';
H.session.detail.push('quota plan --name NAME --tool T --task TEXT --model ID --effort LEVEL --account-label LABEL --acceptance TEXT saves a local experiment plan, not a fabricated baseline. Later --name NAME readings inherit that metadata. Matched comparisons require the same account/window/task/model/effort/acceptance, --phase before|after, --isolated on both readings and --success 1 on the after reading. Legacy blank measurements are excluded from reports.');
H.savings.detail=H.savings.detail.map(line=>line.replace('headroom perf','headroom savings'));
H.desktop={usage:'askai desktop [open|install|remove|catalog] [--project NAME|--repo PATH] [--dry-run]',summary:'Open the Ask AI Windows/Linux desktop app for Markdown conversion and command output.',detail:['Windows installs add native Desktop/Start Menu shortcuts. Graphical Linux installs add Python/Tkinter launchers and Tesseract OCR; Docker/container and headless environments skip the GUI. Document/YouTube dependencies are included. --no-desktop skips this addition. macOS keeps the CLI. Custom-home test installs do not touch desktop shortcuts.', 'desktop install (or setup-desktop.ps1 -Yes / bash setup-desktop.sh --yes) installs the GUI and converter separately. desktop remove removes only managed shortcuts. catalog prints all public commands as JSON.', 'Select a file or YouTube URL and output folder. Local files default to their own folder; URLs default to the project folder. Name collisions receive a numeric suffix. Local Windows OCR or Linux Tesseract extracts image text without a model; captions and network access are required for YouTube. Scanned PDFs require OCR elsewhere; diagrams, formulas and complex layouts need review.', 'Commands use the same CLI and selected project. No commands run automatically on startup. Noninteractive commands display captured output; use Open terminal for prompts and interactive sessions. AI-launching commands may use your subscription.'],examples:['askai desktop','askai desktop install --yes','askai desktop catalog'],exit:'0 on success; 1 on unsupported platforms or setup failure'};
H.install.detail.push('Windows and graphical Linux also install the Ask AI desktop launcher and MarkItDown document/YouTube dependencies. Use --no-desktop to skip this addition. Linux Docker/container and headless sessions skip the GUI. macOS keeps the CLI. Linux uses Python/Tkinter and Tesseract; missing packages install only with existing root/passwordless sudo access, otherwise an actionable error names prerequisites. Windows uses native .NET and Windows OCR without changing PowerShell policy. Existing unrelated shortcuts are preserved.');
H.desktop.detail.push('Both GUIs offer command/action dropdowns, required fields marked *, and add/remove option rows with typed values. Values are validated before execution. Copy output copies all displayed lines, including Markdown previews. Local file mode provides Choose file; URL mode accepts YouTube captions and web pages. Other video services still require a supported transcript first.');
H.desktop.detail.push('Ask AI Help shows full advanced CLI help for the selected command without launching AI. Buttons and display headings use Title Case; command identifiers, paths, code and JSON data retain their original case. Open Markdown and Open Folder controls appear only on Convert To Markdown.');
H.desktop.detail.push('Tabs size to content. Command, Action and Environment share equal columns; Arguments stays aligned beneath Command. The environment picker uses only supported CLI flags and shows Project Scope for other commands. Windows/Linux share desktop-theme.json. Windows signing-policy blocks are reported; core CLI install remains usable, while explicit desktop install returns failure.');
H.desktop.detail.push("Windows installation prepares the native executable before chat launches and reuses it in an existing, matching legacy PATH installation. If compilation reports access denied, run `askai desktop install --yes` from a terminal permitted to write to the installation. AskAI does not change sandbox permissions or application-control policy. A launch succeeds only after the window reports ready and survives a short startup check; this does not guarantee it remains open indefinitely.");
H.gui = { hidden: true, usage: 'askai gui [--project NAME|--repo PATH] [--dry-run]', summary: 'Shortcut for askai desktop open.', exit: '0 on success; 1 on unsupported platforms or setup failure' };
H.desktop.detail.push('A navy header band with the Ask AI mark opens every window. The Output group title and panel heading use the accent teal from desktop-theme.json. The Command dropdown (both tabs) is grouped under its askai help category (Work, Project, Setup, Health, Cost & Levers, Learn, System) with a heading row between groups; selecting a heading reverts to the last real command.');
H.desktop.detail.push('Tab captions have enough padding that no letter is clipped. The status line (Ready, Output copied, Finished: exit N) sits at the right edge of the result row, in teal, clear of the result buttons.');
const names = (opts = {}) => Object.keys(H).filter(n => opts.hidden || !H[n].hidden);
const has = n => Object.prototype.hasOwnProperty.call(H, n);
function render(n, opts = {}) {
  const h = H[n]; if (!h) return null;
  const clip = opts.advanced ? null : require('./surface').clip(n, h, false);
  const usage = clip ? clip.usage : h.usage;
  const options = clip ? clip.options : h.options;
  const out = [`askai ${n}: ${h.summary}`, '', `Usage: ${usage}`];
  if (h.summaryParagraph) out.push('', 'Summary:', `  ${h.summaryParagraph}`);
  if (!clip && h.detail) out.push('', ...h.detail);
  else if (clip) out.push('', `Use when: ${(require('./surface').visible(n) || {}).useWhen || h.summary}`);
  if (options && options.length) out.push('', 'Options:', ...require('./columns').table(['Option', 'Meaning'], options.filter(([f]) => f)));
  if (!clip && h.writes) out.push('', `Writes: ${h.writes}`);
  if (!clip && h.examples) { out.push('', 'Examples:'); for (const e of h.examples) out.push(`  ${e}`); }
  if (h.exit) out.push('', `Exit: ${h.exit}`);
  const width = Math.max(40, Math.min(Number(opts.width || process.stdout.columns) || 120, 120));
  return out.flatMap(line => {
    // Keep command examples intact for copying; wrap explanatory prose only.
    if (/^(?:\s*askai |Usage:)/.test(line)) return [line];
    const indent = /^\s*/.exec(line)[0];
    return require('./columns').wrap(line.trimStart(), width - indent.length).map(part => indent + part);
  }).join('\n');
}
const VERSION = require('../package.json').version;
const CATEGORIES = {
  work: {
    title: 'Work (active coding & session flow)',
    aliases: ['work', 'active', 'daily', 'tasks'],
    commands: [
      ['next', 'what to do now'],
      ['go', 'start coding on a task'],
      ['prompt', 'turn ask into a task'],
      ['run', 'build/test with filter'],
      ['errors', 'first errors from run'],
      ['diff', 'changes and token cost'],
      ['break', 'before stepping away'],
      ['resume', 'back from a break'],
      ['handoff', 'write HANDOFF.md note'],
      ['clear', 'safe to /clear now?'],
      ['snapshot', 'save patch, no commit'],
      ['start', 'start background item'],
      ['stop', 'stop running agent CLI'],
    ],
  },
  project: {
    title: 'Project (repository, pack & architecture)',
    aliases: ['project', 'repo', 'pack', 'arch'],
    commands: [
      ['project', 'manage project pack'],
      ['init', 'init project guidance'],
      ['scaffold', 'generate templates'],
      ['review', 'AI review of pack'],
      ['map', 'map files and entries'],
      ['graph', 'architecture diagram'],
      ['convert', 'PDF/Office to Markdown'],
      ['context', 'check context size'],
      ['weigh', 'token size of files'],
      ['bootstrap', 'devcontainer setup'],
    ],
  },
  setup: {
    title: 'Setup (installation & maintenance)',
    aliases: ['setup', 'install', 'config', 'maintenance'],
    commands: [
      ['install', 'install a profile'],
      ['update', 'update AskAI itself'],
      ['tools', 'update installed tools'],
      ['restore', 'roll back a backup'],
      ['uninstall', 'remove AskAI changes'],
      ['profiles', 'lean|code|docs|full'],
      ['suggest', 'recommend profile'],
    ],
  },
  health: {
    title: 'Health (diagnostics, audit & checks)',
    aliases: ['health', 'check', 'diag', 'diagnostics'],
    commands: [
      ['check', 'health check + fixes'],
      ['setup', 'configure machine/repo'],
      ['status', 'health & status report'],
      ['why', 'explain a finding id'],
      ['todo', 'remaining setup steps'],
      ['test', 'run command tests'],
    ],
  },
  cost: {
    title: 'Cost & Levers (spend, tokens & levers)',
    aliases: ['cost', 'spend', 'savings', 'levers', 'tokens'],
    commands: [
      ['savings', 'token savings and spend'],
      ['session', 'session token ledger'],
      ['audit', 'where tokens leak'],
      ['models', 'model + effort per tier'],
      ['route', 'tier for a task'],
      ['mcp', 'MCP servers on/off'],
      ['plugins', 'evidence per tool'],
      ['infra', 'tools and repo files'],
    ],
  },
  learn: {
    title: 'Learn (guides, habits & etiquette)',
    aliases: ['learn', 'guide', 'tips', 'lookup', 'info', 'docs'],
    commands: [
      ['ask', 'one rule + the why'],
      ['guide', 'etiquette for now'],
      ['tips', '5 habits for now'],
      ['direction', 'working loop of habits'],
      ['docs', 'open or check docs'],
      ['chat', 'chat-app setup'],
    ],
  },
  system: {
    title: 'System (shell, CLI & environment)',
    aliases: ['system', 'shell', 'cli', 'env', 'terminal'],
    commands: [
      ['cli', 'AskAI CLI shell'],
      ['desktop', 'Windows app and Markdown conversion'],
      ['shell', 'shell integration'],
      ['set', 'set project or model'],
      ['statusline', 'statusline display'],
      ['version', 'versions (--all)'],
      ['help', 'show command help'],
    ],
  },
};
const GROUPS = Object.entries(CATEGORIES).map(([k, v]) => [k.toUpperCase(), v.commands]);
function findCategory(name) {
  const key = String(name || '').toLowerCase().trim();
  for (const [id, cat] of Object.entries(CATEGORIES)) {
    if (id === key || (cat.aliases && cat.aliases.includes(key))) return [id, cat];
  }
  return null;
}
function categoryText(id, cat) {
  const lines = [
    `AskAI ${VERSION} · ${cat.title}`,
    '',
  ];
  for (const [cmd, desc] of cat.commands) {
    lines.push(`  ${cmd.padEnd(12)} ${desc}`);
  }
  lines.push('', `askai help <category> (work|project|setup|health|cost|learn|system) · askai help ${cat.commands[0][0]}`);
  return lines.join('\n');
}
function allCategoriesText() {
  const lines = [
    `AskAI ${VERSION} · all commands by category`,
    'Cursor · Claude Code · Codex · Antigravity',
    '',
  ];
  for (const [, cat] of Object.entries(CATEGORIES)) {
    lines.push(`${cat.title}`);
    for (const [cmd, desc] of cat.commands) {
      const summary = (H[cmd] && H[cmd].summary) ? H[cmd].summary : desc;
      lines.push(`  ${cmd.padEnd(12)} ${summary}`);
    }
    lines.push('');
  }
  lines.push('askai help <category> · askai help <command> · askai direction');
  return lines.join('\n');
}
function groupOf(name) {
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const hit = cat.commands.find(r => r[0] === name);
    if (hit) return { group: key, desc: hit[1].slice(0, 25) };
  }
  const summary = (H[name] && H[name].summary) || name;
  return { group: 'more', desc: String(summary).replace(/\s+/g, ' ').slice(0, 25) };
}
const columns = require('./columns');
const layout = columns.layout;
const zip = columns.zip;
function index() {
  const lines = [`AskAI ${VERSION} · help by category`, 'Cursor · Claude Code · Codex · Antigravity', ''];
  for (const [id, cat] of Object.entries(CATEGORIES)) {
    lines.push(`  ${id.padEnd(9)} ${String(cat.commands.length).padStart(2)} commands · ${cat.title}`);
  }
  lines.push('', 'help work                 Commands with one-line descriptions',
    'help check                Detailed command help',
    'help category setup       Category or alias explicitly',
    'help command setup        Command explicitly',
    'help categories · askai help all');
  return lines.join('\n');
}
function groupText(name) {
  const key = String(name || '').toLowerCase().trim();
  if (key === 'categories' || key === 'all-categories') return allCategoriesText();
  if (has(key) && !Object.prototype.hasOwnProperty.call(CATEGORIES, key)) return null;
  const found = findCategory(key);
  if (!found) return null;
  return categoryText(found[0], found[1]);
}
module.exports = { H, names, has, render, index, groupOf, groupText, layout, CATEGORIES, findCategory, allCategoriesText };
