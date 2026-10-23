# AskAI cheat sheet

Printable page, every command and its arguments: [AskAI-commands-A3.png](AskAI-commands-A3.png) (A3 portrait, print at 100%). The same list, one command at a time: [AskAI-commands.pdf](AskAI-commands.pdf).

Look up the command, then the purpose. Full detail: `askai help <command>`. Guide: [ASKAI_GUIDE.md](ASKAI_GUIDE.md).

## See what is set up

| Purpose | Command |
|---|---|
| One check after install | `askai setup <repo>` |
| Same rows as check | `askai doctor` |
| What is installed, per app | `askai infra <repo>` |
| What you still have to do | `askai todo <repo>` |
| Mark a to-do done | `askai todo done <id>` |
| Which plugins are waiting | `askai plugins ready <repo>` |
| What one plugin does, and how to turn it off | `askai plugins info <id>` |
| Audit this machine | `askai check <repo>` · `askai check --env` |
| Why one finding | `askai why <id>` |
| The next few actions | `askai next` |
| Seven-point token audit | `askai audit <repo>` |
| Every command | `askai help` |
| One command | `askai help <command>` |

## Install and keep current

| Purpose | Command |
|---|---|
| Preview, change nothing | `askai install --dry-run` |
| Default install (lean profile) | `askai install --yes --project <repo>` |
| Every optimiser, one host | `askai install --yes --profile experimental --target cursor --project <repo>` |
| Add another host later | `askai install --yes --target claude` (or `codex`, `agy`, `all`) |
| Fetch the latest AskAI and re-apply the recorded profile | `askai update` (same as `askai upgrade`) |
| Upgrade the tools AskAI installed | `askai tools update` |
| Run each safe command and write one capture | `askai test` |
| Cursor slash command missing | Reload the window. Open the project folder itself. Type `/` and choose `askai-cli` |
| Devcontainer, no window | `askai cli` in the Cursor terminal. `tmux attach -t askai` only resumes a session that `--launch` already started |

`~/.claude/askai` is AskAI's own folder on every install, including Cursor-only. It is not Claude Code.

## Coding session

| Purpose | Command |
|---|---|
| Set up the project from the chat | `/askai-cli` (Codex: `$askai-cli`) |
| Finish one-time plugin setup | `/askai-plugins` |
| Search, scripts, test runs | `askai go cursor --tier chore "task"` |
| A normal edit | `askai go cursor --tier build "task"` |
| Hard design or debugging | `askai go cursor --tier lead "task"` |
| Same, other app | Replace `cursor` with `claude`, `codex`, or `agy` |
| Turn a vague ask into a prompt | `askai prompt "ask" --tier build --files a,b --done "acceptance"` |
| See or change the model for a tier | `askai models` · `askai models verify cursor` · `askai models set cursor.build <model>:<effort>` |
| Write the project pack | `askai init <repo>` |
| Refresh generated docs after the tree changes | `askai init <repo> --refresh` |
| Refresh only the map | `askai map <repo>` |
| Before a break | `askai break` |
| Come back | `askai resume` |
| What to do at a context level | `askai context 70` |
| Whether a fresh chat is safe | `askai clear` |

Use `claude`, `codex`, `cursor`, or `agy` in `askai go`. One chat per task. A model switch mid-chat re-reads the whole thread.

## Code navigation, once per repo

| Purpose | Command |
|---|---|
| Build the graph from source, no tokens | `graphify update .` |
| Ask how two parts connect | `graphify query "question"` |
| Index symbols for Serena, no tokens | `serena project create --language cpp --index` |
| Rebuild the graph after code changes | `graphify update .` |
| Turn an MCP server off between sessions | `askai mcp off <name>` · `askai mcp on <name>` |

Do not run `/graphify .` unless you also want docs and images in the graph. That spends tokens. Leave Serena on for firmware work. Leave Headroom's proxy off.

`graphify-out/` and `.serena/` stay out of git. They are local caches.

## Chat that is not this code repo

A book or any other non-code project stays in Claude chat, ChatGPT, or Gemini. Do not open it in Claude Code, Cursor, or Codex. Those load the code repo.

| Purpose | Command |
|---|---|
| Where to paste the short instruction, and the project brief | `askai chat` |
| Claude chat and the Claude desktop app only | `askai chat claude` |
| ChatGPT web and desktop only | `askai chat chatgpt` |
| Gemini app only | `askai chat gemini` |
| The four coding apps | `askai chat code` |

The account instruction is sent on every chat, so it stays short. The book gets its own project and a brief under 150 words. Put the current chapter in that project, not the whole manuscript. Start a new chat for each chapter.

## Where usage shows

| App | Where to look |
|---|---|
| Claude Code and Codex | `askai usage 7` · `askai usage --cache` · `askai report` |
| Cursor | Export the usage CSV, then `askai usage --import-cursor FILE.csv`. In-plan rows are 0 USD, so this counts tokens. |
| Claude chat | claude.ai, Settings, Usage |
| ChatGPT | ChatGPT settings |
| Antigravity | `/usage` |

AskAI cannot move a reset.

## Inside each coding app

| Purpose | Claude Code | Codex | Antigravity | Cursor |
|---|---|---|---|---|
| What fills the context | `/context` | `/status` | `/context` | `/context` |
| Usage | `/usage` | `/usage daily` | `/usage` | Dashboard, Usage |
| New task | `/clear` | `/new` | `/clear` | `/clear` |
| Keep a long chat | `/compact keep: goal, files, test` | `/compact` | new chat plus a handoff | `/summarize` |
| Plan before editing | `/plan` | `/plan` | `/plan` | `/plan` |
| AskAI terminal | `/askai-cli` | `$askai-cli` | `/askai-cli` | `/askai-cli` |
| Plugins | `/askai-plugins` | `$askai-plugins` | `/askai-plugins` | `/askai-plugins` |

## Leave off unless you measured a gain

RTK and Context Mode cost more in the measured runs. Headroom's proxy can move Claude Code onto per-token billing. Claude LSP does not run in Cursor. ccusage only reports Claude Code transcripts.
