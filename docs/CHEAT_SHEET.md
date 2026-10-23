# AskAI cheat sheet

Printable page, every command once: [AskAI-commands-A3.png](AskAI-commands-A3.png) (A3 portrait, print at 100%). The same cards, one command at a time: [AskAI-commands.pdf](AskAI-commands.pdf).

Each command is listed once below. Flags and examples are on `help` for that command. Guide: [ASKAI_GUIDE.md](ASKAI_GUIDE.md).

## Daily

| Command | What it does |
|---|---|
| `askai next [dir]` | At most 3 things to do now and 2 for later |
| `askai prompt "ask" [--tier T] [--files a,b] [--done TEXT] [--copy]` | Turn a rough ask into a task |
| `askai run -- <command>` | Run a build or test and keep the log |
| `askai errors [log]` | First error lines of the last run |
| `askai check [dir] [--fix] [--env]` | Health and the fix for each gap. `askai doctor` prints the same rows |
| `askai diff [dir]` | Changes and a token-cost reminder |

## Session

| Command | What it does |
|---|---|
| `askai go <claude\|codex\|cursor\|agy> [--tier chore\|build\|lead] "task"` | Start that app on the cheapest tier that fits |
| `askai route "task"` | Print the tier. Does not launch an agent |
| `askai break` | Checklist before you step away |
| `askai resume [--copy]` | Back from a break |
| `askai handoff [dir] [--for claude\|codex\|cursor\|agy]` | Write `.ai-work/HANDOFF.md`. A `TODO(you)` draft is not safe to clear |
| `askai clear [--tool claude\|codex\|cursor\|agy]` | Whether a fresh chat is safe, and the command to type |
| `askai snapshot [dir]` | Save a patch. Does not commit |
| `askai start --tool T --task "task"` | Ledger entry for a task |
| `askai session init\|pause\|status\|finish\|measure\|report\|compact` | The rest of the ledger. `compact` rewrites old lines |
| `askai stop [--yes]` | List running agent CLIs. `--yes` stops them |
| `askai context <percent>` | What to do at that context level |

## Project

| Command | What it does |
|---|---|
| `askai cli [--prepare] [--launch]` | Prepare this folder from chat, then open the terminal |
| `askai init [dir] [--refresh]` | Write the project pack |
| `askai project list\|show\|refresh [--agents]\|hide-local [--undo]` | Registry, pack refresh, or local excludes. `--agents` rewrites agent files |
| `askai set project NAME` | Select the project for this terminal |
| `askai suggest [dir]` | Recommend a profile from the folder |
| `askai map [dir] [--dry-run] [--diff]` | Rebuild the project map. `--dry-run` is one summary line |
| `askai scaffold [dir] [--dry-run]` | Write starter files. Never overwrites |
| `askai review status\|done` | What changed since the review, or record that it is done |
| `askai weigh <path>` | Token estimate for one file |
| `askai graph [dir]` | Architecture diagram |
| `askai convert <file\|url\|scan>` | PDF or Office to Markdown. `scan` only lists the files |
| `askai bootstrap [dir]` | Devcontainer script that runs install and project refresh |
| `askai docs <name>\|--print` | Open one AskAI document |

## Cost

| Command | What it does |
|---|---|
| `askai usage [days] [--cache] [--plugins] [--import-cursor FILE.csv]` | Spend for Claude Code and Codex. The CSV counts tokens, not dollars |
| `askai report [days]` | The full spend report plus one line from check |
| `askai savings` | One savings line per installed plugin |
| `askai audit [dir]` | Where tokens leak |
| `askai models [set <tool>.<tier> <model>:<effort> \| verify]` | Model and effort per tier |
| `askai mcp on\|off <name>` | MCP servers between sessions |
| `askai plugins [ready \| info <id>]` | Evidence, state, and how to turn a tool off |
| `askai status` | Per-tool state for hosts that are installed |
| `askai statusline [--demo]` | Claude Code's one status line |

## Setup

| Command | What it does |
|---|---|
| `askai install [--yes] [--dry-run] [--profile lean\|code\|docs\|full\|experimental] [--target auto\|claude\|codex\|agy\|cursor\|all] [--project DIR]` | Install a profile. Default is lean |
| `askai profiles [show NAME \| migrate]` | The four profiles. `migrate` renames a recorded max to experimental |
| `askai update` | Fetch AskAI from GitHub and re-apply the recorded profile. `askai upgrade` is the same command |
| `askai tools update` | Upgrade the tools AskAI installed. This does not update AskAI |
| `askai setup [dir] [--yes] [--dry-run]` | Short check after install. `--yes` installs. A pipe continues |
| `askai infra [dir]` | Tools and repository files. `askai inventory` is the same command |
| `askai todo [dir \| done <id>]` | Steps only you can do |
| `askai shell init powershell\|bash\|zsh` | Remember the selected project in the shell |
| `askai restore [file]` | List backups, or put one file back |
| `askai uninstall [--dry-run]` | Remove only what AskAI added |
| `askai version [--all]` | The version. `--all` adds the machine |
| `askai test [--json] [--real] [--compare FILE]` | Run commands on a throwaway fixture. `--real` is read-only on this machine |

## Learn

| Command | What it does |
|---|---|
| `askai help [command \| all]` | The column list, one command, or every command |
| `askai guide [moment]` | Etiquette for this moment |
| `askai tips [claude\|codex\|agy\|cursor]` | Five habits, or one host |
| `askai ask <topic>` | One rule and why |
| `askai why <id>` | One finding from check |
| `askai chat [claude\|chatgpt\|gemini\|code] [--copy]` | Where to paste the short instruction |

Old names still work and are not separate commands: `work`, `etiquette`, `continue`, `checkpoint`, `peak`, `projects`. `hook` is retired.

## Once per repo, not an AskAI command

| Purpose | Command |
|---|---|
| Build or rebuild the code graph. No tokens | `graphify update .` |
| Ask how two parts connect. Read only the matching section | `graphify query "question"` |
| Index symbols for Serena | `serena project create --language LANG --index` |

Do not run `/graphify .` unless you also want docs and images in the graph. That spends tokens. `graphify-out/` and `.serena/` stay out of git.

`~/.claude/askai` is AskAI's own folder on every install, including Cursor-only. It is not Claude Code.

## Inside each coding app

| Purpose | Claude Code | Codex | Antigravity | Cursor |
|---|---|---|---|---|
| What fills the context | `/context` | `/status` | `/context` | `/context` |
| Usage | `/usage` | `/usage daily` | `/usage` | Dashboard, Usage |
| New task | `/clear` | `/new` | `/clear` | `/new` |
| Keep a long chat | `/compact keep: goal, files, test` | `/compact` | new chat plus a handoff | `/summarize` |
| Plan before editing | `/plan` | `/plan` | `/plan` | `/plan` |
| AskAI terminal | `/askai-cli` | `$askai-cli` | `/askai-cli` | `/askai-cli` |
| Plugins | `/askai-plugins` | `$askai-plugins` | `/askai-plugins` | `/askai-plugins` |

Claude chat, ChatGPT, and Gemini show usage in their own settings. AskAI cannot move a reset.

## Leave off unless you measured a gain

RTK and Context Mode cost more in the measured runs. Headroom's proxy can move Claude Code onto per-token billing. Claude LSP does not run in Cursor. ccusage only reports Claude Code transcripts.
