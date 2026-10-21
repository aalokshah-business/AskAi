# Installing AskAI

This guide takes you from the downloaded zip to a working setup on Windows, macOS, Linux or WSL: what to prepare, how to preview and install, how to check it worked, and every file AskAI creates. It takes about ten minutes. What each setting does and why: `docs/ARCHITECTURE.md`.

## The short version

AskAI installs straight from GitHub: nothing to download first. Run **one command per project**. It fetches AskAI into `~/.claude/askai/src` (so `askai upgrade` can refresh it later), installs or refreshes it for Claude Code, Codex, Antigravity and Cursor with every optimiser (the `max` profile), writes the project's knowledge pack, and ends with the remaining setup and review steps. Running it again for another project is safe: whatever is already set up is skipped.

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Workflow max -Project C:\code\myapp -Yes
```

macOS, Linux or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --profile max --project ~/code/myapp --yes
```

Then open a new terminal and run one check:

```bash
askai setup --project NAME
```

That runs status, the guideline audit, infra, which plugins are waiting, the to-do list, and the file validator. Infra separates a server that is only switched on from one the agent has called. The to-do list is what only you can finish (sign-in, restart, trust, model IDs). The project passed during install is registered under its folder name. The separate commands (`askai check`, `askai status`, `askai infra`, `askai plugins ready`, `askai todo`, `node scripts/validate-install.js`) still work when you want one section.

Restart Claude Code, Codex, Antigravity, and Cursor. In the project chat, `/askai-cli` (Codex: `$askai-cli`) reviews the knowledge pack and opens the terminal. `/askai-plugins` runs the ready report and does the one-time step still left, including `/graphify .` once when the graph is missing. That build spends tokens once. Add `-DryRun` / `--dry-run` for a preview, or leave out the `max` profile for the evidence-based default.

**Or ask your agent to do it.** Paste this into Claude Code, Codex, Antigravity or Cursor, opened in the project:

```text
Set up AskAI for this repository. From the repository root, run the one command for this OS and wait for it to finish (it asks no questions):
- macOS, Linux or WSL: curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --profile max --project . --yes
- Windows: powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Workflow max -Project . -Yes"
Then run, from the repository: askai setup .
(if askai is not found yet, use its full path: ~/.claude/askai/bin/askai, or askai.cmd on Windows)
Reply with what was installed, anything that failed, the plugin-ready report, and my to-do list. Change no other files. Remind me to restart this session, then run /askai-plugins once.
```

**Other ways to get it.** Clone it (`git clone https://github.com/aalokshah-business/AskAi ~/tools/AskAI`) or download the ZIP from GitHub (Code, Download ZIP), then run the installer in that folder with the same options: `bash ~/tools/AskAI/install.sh --target all --profile max --project ~/code/myapp --yes`, or on Windows `powershell -ExecutionPolicy Bypass -File C:\tools\AskAI\install.ps1 -Target all -Workflow max -Project C:\code\myapp -Yes`. With Node.js and git installed, `npx github:aalokshah-business/AskAi install --target all --profile max --project . --yes` works too.

**Keeping it current.** `askai upgrade` fetches the latest AskAI from GitHub and re-applies your profile; `askai update` upgrades the tools it installed. Before running a script from the internet you can read it first: [get.sh](../get.sh), [get.ps1](../get.ps1), and [SECURITY.md](../SECURITY.md) for what the installer changes.

The rest of this guide explains each step, every option and every file.

## 1. What you get

- The `askai` command in every new terminal (`askai check`, `askai ask`, `askai break`, `askai resume`, `askai usage` and the rest; `askai help <command>`).
- Token-saving settings and short rules in each tool you use: Claude Code, Codex, Antigravity and Cursor.
- Two entry points inside each tool: `/askai-cli` sets up the project and opens the terminal (Codex: `$askai-cli`). `/askai-plugins` finishes one-time plugin setup and says when each connected tool is called. Write a session handoff by asking your agent to update `.ai-work/HANDOFF.md`.
- For each repository you choose: shared instruction files, an ignore list for Cursor, and a local `.ai-work/` folder for handoffs and measurements.

Connected MCP servers do not read each prompt. The agent calls Serena, Context7, Headroom, or Context Mode only when the task matches. RTK, when its hook is installed, shortens shell output by itself. Settings you already chose are kept.

## 2. Before you start

| Need | Windows 10/11 | macOS | Linux and WSL |
| --- | --- | --- | --- |
| Node.js 18 or newer | `winget install OpenJS.NodeJS.LTS` (install.ps1 offers it) | `brew install node` (install.sh offers it) | nvm (`https://github.com/nvm-sh/nvm`) or your distribution's package |
| Package manager for tools | winget (built into Windows 11; "App Installer" from the Microsoft Store on 10) | Homebrew recommended | Homebrew optional; otherwise the vendors' installer scripts and cargo |
| Shell | PowerShell 5.1 or later | zsh or bash | bash |
| git | Recommended (the ledger records branch and commit) | Recommended | Recommended |
| Network | claude.ai, astral.sh (uv, for Serena and markitdown), github.com, registry.npmjs.org, pypi.org | same | same |

Install the AI tools you use first, or let AskAI install Claude Code. Codex: `npm i -g @openai/codex`. Antigravity: its installer from antigravity.google. Cursor: cursor.com/download. AskAI sets up every one it finds. Context Mode (opt-in only) needs Node 22.5 or newer.

AskAI never uses sudo or administrator rights; everything goes into your user folders.

## 3. Environment setup

**Sign in with your plan, not an API key.**

| Tool | Sign in | Confirm |
| --- | --- | --- |
| Claude Code | `claude`, then `/login` | `/status` shows your Pro, Max or Team plan |
| Codex | `codex`, then sign in with ChatGPT | `codex login status` |
| Antigravity | `agy`, then sign in with Google | `/usage` shows per-model quota |
| Cursor | Sign in in the editor | Dashboard, Usage |

**Remove billing variables** unless you mean to pay per token: an API key overrides your plan, and a base URL sends Claude Code through a proxy.

```powershell
# Windows (PowerShell): remove for your user, then for this window
foreach ($v in 'ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','OPENAI_API_KEY') {
  [Environment]::SetEnvironmentVariable($v, $null, 'User'); Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
```

```bash
# macOS, Linux, WSL: unset now, then delete any export lines for them from ~/.zshrc, ~/.bashrc or ~/.profile
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL OPENAI_API_KEY
env | grep -E 'ANTHROPIC|OPENAI'      # should print nothing
```

`askai check` and `askai doctor` flag these variables, including an `ANTHROPIC_API_KEY` set inside Claude Code's `settings.json`.

**Proxies.** `HTTPS_PROXY` and `HTTP_PROXY` are fine for downloads. Do not set `ANTHROPIC_BASE_URL` for a proxy unless you mean to leave your plan's billing.

**Custom config folders.** If you keep a tool's settings outside the default folder, pass it to AskAI: `--claude-home`, `--codex-home`, `--agy-home` or `--cursor-home` (PowerShell: `-ClaudeHome`, `-CodexHome`, `-AgyHome`, `-CursorHome`).

**Windows: unblock the download.** Files from a downloaded zip can be blocked from running. In the unzipped folder:

```powershell
Get-ChildItem -Recurse | Unblock-File
```

## 4. Get and verify the package

Unzip the AskAI ZIP (from GitHub: Code, Download ZIP) and open a terminal in its folder. Check that no file was changed:

```bash
sha256sum -c SHA256SUMS.txt --quiet          # Linux, WSL
shasum -a 256 -c SHA256SUMS.txt --quiet      # macOS
```

```powershell
# Windows: prints nothing when every file matches
Get-Content SHA256SUMS.txt | ForEach-Object { $h, $f = $_ -split '\s+', 2
  if ((Get-FileHash $f -Algorithm SHA256).Hash -ne $h.ToUpper()) { "MISMATCH $f" } }
```

Verify before opening files in an editor: re-saving can change line endings.

## 5. Preview

A preview shows every change and writes nothing.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun     # Windows
```

```bash
bash install.sh --dry-run                                         # macOS, Linux, WSL
```

Each line names a component, its state and what will happen. `ok` means already right and skipped. `partial` means some settings are missing and will be added. `missing` means it will be installed. `other` means it does not apply here, for example a tool that is not installed. Add `-Target all` / `--target all` to see all four tools even before they are installed.

## 6. Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1             # Windows
```

```bash
bash install.sh                                                   # macOS, Linux, WSL
```

AskAI asks once, then:

1. Copies itself to `~/.claude/askai/app` and writes the `askai` command to `~/.claude/askai/bin`. On Windows it adds that folder to your user PATH. On macOS and Linux, `install.sh` offers to add one line to `~/.zshrc` or `~/.bashrc`.
2. Installs each component in order: `token-kit` first, then the Claude Code and Cursor components, then Codex's and Antigravity's, then the handoff commands and the remaining Claude Code settings.
3. Backs up every file before its first change (`~/.claude/askai/backups/`) and records what it added (`~/.claude/askai/manifest.json`).
4. Prints a summary with next steps.

**Choose tools and work type.**

| Option (PowerShell / bash) | Effect |
| --- | --- |
| `-Target all` / `--target all` | Claude Code, Codex, Antigravity and Cursor. The default `auto` sets up Claude Code plus every other tool found |
| `-Target claude,codex` / `--target claude,codex` | Only those tools |
| `-Workflow minimal` / `--profile minimal` | Settings, rules, status line and handoff only |
| `-Workflow coding` / `--profile coding` | The default: adds Serena for code navigation |
| `-Workflow docs` / `--profile docs` | Adds markitdown for PDF and Office files |
| `-Workflow full` / `--profile full` | Both, plus ccusage |
| `-Workflow max` / `--profile max` | Everything: full plus RTK, Context Mode, Headroom (MCP mode), Graphify, Context7, the Caveman plugin, LSP plugins (ts, py) and the base tools, in all four tools |
| `-Yes` / `--yes` | Do not ask |

Re-running is safe: components already right are skipped.

## 7. Check it worked

Open a new terminal, so the PATH change applies, then:

```bash
askai setup ~/code/myapp
```

Then start a new session in each tool:

| Tool | Look for |
| --- | --- |
| Claude Code | `/status` shows your plan; `/model` shows Haiku if you had no default; `/context` shows CLAUDE.md with the askai block loaded |
| Codex | `/status`; `~/.codex/config.toml` has effort `medium` and verbosity `low` |
| Antigravity | `/usage`; `~/.gemini/GEMINI.md` has the askai block |
| Cursor | `~/.cursor/rules/` holds the `askai-*.mdc` files |

`askai setup` prints status, the guideline audit, infra, which plugins are waiting, the to-do list, and the file validator. Exit 1 means the audit or the file validator failed. It does not sign you in, and it does not prove a plugin saved tokens. `working` in the infra section is the call evidence. `askai version`, `askai doctor`, and `node scripts/validate-install.js <repo>` remain available when you want one section.

## 8. Set up each repository

```bash
askai init --name myapp --path ~/code/myapp  # writes the knowledge pack and registers the path
askai check --project myapp --fix            # check it, and fix what can be fixed
askai infra --project myapp                  # everything set up for this repository
```

Or during install: `bash install.sh --project ~/code/myapp` (PowerShell: `-Project C:\code\myapp`).

`askai init` scans README, manifests and every eligible first-party source file (up to 1 MiB per file; dependencies, build output and private files excluded). It records declarations, routes and static imports in `docs/ai/SOURCE_INDEX.md`, with short architecture and feature summaries. It checks page titles from up to four fixed official framework documentation sites and puts links in `docs/ai/REFERENCES.md`; only URLs are requested, and no repository content is uploaded. Results are cached for seven days. `--offline` skips web requests. No model or API token is used. Init also writes `AGENTS.md` (short router), `CLAUDE.md`, `GEMINI.md`, `PROJECT_MAP.md`, `ARCHITECTURE.md`, `FEATURES.md`, `WORK_ORDER.md`, `MODELS.md`, the `architect`, `builder` and `runner` agents for all four tools, four skills, `.cursorignore` and `.ai-work/`. Static findings are labeled as evidence, not proof of behavior. Current work and handoff state need user input.

Repeat `askai init --name NAME --path FOLDER --yes` for each repository. AskAI resolves `--project NAME` or `-p NAME` without another path; `askai cli` also keeps `set project NAME` active for later commands. For ordinary shells, enable `askai shell init` or opt into the installer's managed shell-profile integration (`-ShellIntegration` in PowerShell, `--shell-integration` in Bash). See [Project management](PROJECT_MANAGEMENT.md) for the selection order, moving folders, separate terminals and migration from earlier installs. Global tool settings are shared, while each repository keeps its own files and `.ai-work/` state. After changes to AskAI, run `npm run test:commands`, `npm test` and `askai docs check`. The command test does not run external agents, downloads or paid services.

| File | What to do |
| --- | --- |
| `AGENTS.md` | Short index: what the project is, commands, where detail lives, security pointer. Keep notes outside the managed block |
| `CLAUDE.md` | `@AGENTS.md` plus Claude-only notes (subagents, plan mode). Shared rules stay in AGENTS.md |
| `GEMINI.md` | Antigravity-only notes. Gemini CLI loads this file; add `AGENTS.md` to `context.fileName` to load the router too |
| `docs/ai/PROJECT_MAP.md` | Folder purposes from the README or a known folder name. A remaining “not stated” cell needs a purpose you know |
| `docs/ai/SOURCE_INDEX.md` | Folder counts, then one row per source file. Search it; do not load it whole |
| `docs/ai/ARCHITECTURE.md` | Evidenced flow, imports and README constraints. Add a decision only after it is made |
| `docs/ai/FEATURES.md` | Up to 12 rows: README bullets (`documented`) and routes or page modules (`detected`). Confirm behavior before calling one finished |
| `docs/ai/REFERENCES.md` | Official pages for frameworks AskAI can check. Other dependencies are omitted |
| `docs/ai/WORK_ORDER.md` | The current task. An empty goal is replaced on the next init; a written goal is kept |
| `docs/ai/MODELS.md` | Model and effort per tier. The task itself stays in the work order |
| `.cursorignore` | Dependencies, build output, secrets, and large media folders present in the repo. An edited file is kept. Terminal and MCP tools can still read ignored paths |
| `.ai-work/HANDOFF.md` | Written at the end of a session: goal, verified state, branch, decisions, next step, files to read. The shipped file means no session is recorded |

This layout keeps the always-loaded router short and puts source details behind task-specific lookup, following [OpenAI's guidance on AGENTS.md and skills](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra). [Claude Code](https://code.claude.com/docs/en/memory) expands the `@AGENTS.md` import once, [Cursor](https://cursor.com/docs/rules) supports scoped project rules, and [Antigravity](https://codelabs.developers.google.com/getting-started-agy-ide) distinguishes persistent rules from on-demand workflows. Generated notes are starting evidence; compare actual token use with `askai savings` before claiming savings.

For an existing initialized folder, run `askai init --project NAME --refresh --yes`. It updates AskAI-managed blocks and generated docs only when their content has not been edited. `askai infra --project NAME` reports folder-purpose and feature coverage; `askai todo --project NAME` lists evidence gaps still needing review.

## 8a. Daily commands

Use `/askai-cli` in Claude Code, Cursor or Antigravity (`$askai-cli` in Codex) from the project chat. It runs `askai cli --prepare`, which picks the project from the chat's folder (or the only registered project) and runs `askai init` when pack files are missing or source, README or build manifests changed. The host agent then checks the generated files against code and official docs, asks one question for facts the repository cannot establish, records `askai review done`, and opens the terminal. The review marker lives in the project's gitignored `.ai-work/ai-review.json`; a terminal-only `askai init` does not mark itself AI-reviewed. If more than 40 paths changed, use `askai review status --project NAME --all --json` to see every path before completing the review. If prepare cannot tell which project, it asks once. Add a refresh request to repeat the review. AI review costs model tokens; `askai init` in a terminal does not. In the opened terminal, type `infra`, `todo`, `audit` or another AskAI command without `askai`, `/` or `$`. Type `exit` to leave. Terminal commands use no model tokens unless they launch an AI agent.

| Moment | Command |
| --- | --- |
| Start a task | `askai go claude --tier build "fix the cart rounding in src/cart.ts"` (also codex, cursor, agy) |
| Shape a dictated ask | `askai prompt "..." --copy` |
| Remaining setup and review steps | `askai todo` (per tool and repository; `askai todo done <id>` marks one) |
| Every command in full | `askai help all`; one command: `askai help <command>` |
| Use the connected plugins | `/askai-plugins` (Codex: `$askai-plugins`). Terminal: `askai plugins ready` |
| How to use one plugin | `askai plugins info <id>`: commands in a terminal and inside the agent, how to check it, its savings, how to switch it off |
| What each plugin saved | `askai savings` (runs rtk gain, ccusage, headroom stats and the rest for you) |
| Check etiquette | `askai work`, `askai etiquette`, `askai guide <moment>`, `askai ask <words>` |
| Coming back | `askai continue` (same as `askai resume`) |
| Review before handing off | `askai diff`; architecture at a glance: `askai graph` |
| Before /clear or a break | Ask the agent to write `.ai-work/HANDOFF.md`, then run `askai clear` or `askai break` |
| Coming back | `askai resume --copy` |
| See waste | `askai audit`; usage: `askai usage 7` |
| Switch MCP servers | `askai mcp off <name>` before the next session |

## 9. Optional extras

| Option | Effect |
| --- | --- |
| `--lsp ts,py` (also kotlin, ruby, swift) | Claude Code's official code-intelligence plugins, plus the npm language servers for ts and py |
| `--main-model NAME` | Claude Code's default when you have none set. The default is `claude-sonnet-5-5` at high effort |
| `--codex-model NAME` | A cheaper default model for Codex |
| `--ccusage`, `--markitdown` | The usage reporter; the document converter |
| `--lean-git` | Also remove Claude Code's git instructions from every turn, if you never use it for commits |
| `--caveman lite\|full\|ultra\|off` | How terse the replies are (default full) |
| `--headroom`, `--graphify`, `--context7` (PowerShell `-Headroom`, `-Graphify`, `-Context7`) | One optimiser at a time, wired into every tool in play. Headroom is set up in MCP mode only; its proxy mode is never set up automatically because it can move Claude Code to API billing |
| `--base-tools` (PowerShell `-BaseTools`) | ripgrep, jq and gh where missing: agents search and inspect with them far more cheaply |
| `--rtk`, `--context-mode` | Opt-in only: independent benchmarks found they cost more |

## 10. Files AskAI creates

Paths are under your home folder (`%USERPROFILE%` on Windows).

| Tool | Files |
| --- | --- |
| AskAI | `.claude/askai/app/` (the program), `.claude/askai/bin/askai` (the command), `.claude/askai/manifest.json`, `.claude/askai/backups/`, `.claude/askai/sessions/` (status-line snapshots), `.claude/askai/cache/` |
| Claude Code | `.claude/settings.json` (added keys only), `.claude/CLAUDE.md` (a marked block), `.claude/rules/askai-*.md`, `.claude/commands/askai-cli.md`, `.claude/commands/askai-plugins.md` |
| Codex | `.codex/config.toml` (added keys only), `.codex/AGENTS.md` (a marked block), `.codex/prompts/askai-cli.md`, `.codex/prompts/askai-plugins.md`, `.agents/skills/askai-cli/`, `.agents/skills/askai-plugins/` |
| Antigravity | `.gemini/antigravity-cli/settings.json`, `.gemini/GEMINI.md` (a marked block), `.gemini/config/rules/askai-*.md`, the `askai-cli` and `askai-plugins` skills in `.gemini/antigravity-cli/skills/` and `.gemini/config/skills/` |
| Cursor | `.cursor/rules/askai-*.mdc`, `.cursor/commands/askai-cli.md`, `.cursor/commands/askai-plugins.md` |
| Coding profile | Serena as an MCP server in each tool (`.claude.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.gemini/config/mcp_config.json`) |

The full list, with every key and value: `docs/ARCHITECTURE.md`, sections 8 and 9.

## 11. AskAI and the standalone script

`standalone/token-setup.mjs` applies the same settings without AskAI, for a machine where you only want the configuration. Use one or the other, never both: running both would load the token rules twice.

- **token-setup ran first:** `askai install` takes over. Its `token-kit` step runs `token-setup --uninstall` (with backups), then AskAI applies the same settings under its own manifest. Your own text is kept.
- **AskAI is installed:** token-setup stops, points to `askai check`, and changes nothing (`--force` overrides).
- A test applies both in separate folders and confirms AskAI sets every setting token-setup sets, with the same values.

## 12. Update, uninstall, restore

```bash
askai update                  # upgrade the tools AskAI installed and refresh its rules
askai uninstall --dry-run     # see what would be removed
askai uninstall               # remove only what AskAI added (add --tools to remove installed tools too)
askai restore                 # list backups; askai restore <file> puts one back
```

## 13. Troubleshooting the install

| Symptom | Fix |
| --- | --- |
| `node` not found | Install Node.js 18+ (section 2), open a new terminal, re-run |
| `winget` not found (Windows 10) | Install "App Installer" from the Microsoft Store |
| No Homebrew on macOS | AskAI uses the vendors' installer scripts instead; ripgrep is then a manual step it names |
| "running scripts is disabled" or "not digitally signed" | Use `-ExecutionPolicy Bypass` as shown, and run `Get-ChildItem -Recurse \| Unblock-File` |
| `askai` not recognised | Open a new terminal; on macOS and Linux accept the PATH line, or add `~/.claude/askai/bin` to PATH |
| A component failed | Read its line in the summary, fix the cause, re-run; components already done are skipped |
| Permission denied | AskAI writes only in your home folder: check who owns it; never run it with sudo |
| `/status` in Claude Code shows API billing | Remove the billing variables (section 3), restart the terminal |
| Antigravity spent paid credits | `askai check`; in the app set AI Credit Overages to Never |

## 14. What was tested

- 204 automated tests in throwaway folders. Every component installs, detects and uninstalls; settings are never overridden; `install.ps1`'s options and actions match askai.js; AskAI applies every token-setup setting; a token-setup run is taken over cleanly; a full install followed by uninstall leaves nothing of AskAI in any of the four tools.
- A real run of `install.sh` on Linux into a throwaway home folder: install, the installed `askai` command, and uninstall.
- Previews of every OS and tool combination (`docs/PREVIEW_MATRIX.md`): Windows and macOS were simulated on Linux by making Node report those systems.
- Not yet run on real machines: `install.ps1` itself (PowerShell was not available where AskAI was built and tested) and live installs of each tool. On each new machine, run the preview first, then `askai check` after installing.

**Windows self-test.** One command runs the real `install.ps1` in a temporary folder (your own settings are never touched) and prints a summary to paste back:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-selftest.ps1
```

It checks the checksums, runs `install.ps1 -DryRun` (must write nothing), installs, runs `askai check`, uninstalls (must leave nothing), runs the automated tests, and deletes the temporary folder.
