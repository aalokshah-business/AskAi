# AskAI 1.1 cheat sheet: Claude Code, Codex, Antigravity, Cursor
Checked against vendor docs and independent benchmarks, 20 October 2026. Run `/help` after upgrades. Full guide: docs/ASKAI_GUIDE.md.

## AskAI commands

| When | Command |
|:--|:--|
| Once per machine | `askai install --dry-run`, then `askai install --project <repo>` (Windows: `install.ps1 -DryRun`, then `install.ps1 -Project <repo>`) |
| One command per project (from GitHub) | `curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh \| bash -s -- --target all --profile max --project <repo> --yes` · Windows: `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Workflow max -Project <repo> -Yes` · then `askai todo <repo>` · later `askai upgrade` |
| Things only you can do | `askai todo` (per tool and repository; `askai todo done <id>`) · every tool and why: `askai plugins decisions` |
| Every command, every plugin | `askai help all` · `askai plugins info <id>` (commands, checks, savings, off switch) · `askai savings` |
| Once per repo | `askai init <repo>`: AGENTS.md router, CLAUDE.md, GEMINI.md, docs/ai/*, subagents for all four tools |
| Start a task | `askai go claude --tier build "task"` (codex, cursor, agy; lead, build, chore) |
| Shape a dictated ask | `askai prompt "..." --copy`; noisy command: `askai prompt --output-safe "cmd"` |
| Unsure about a habit | `askai work`, `askai etiquette`, `askai guide <moment>`, `askai ask <words>` |
| Before /clear or a break | Ask the agent to write `.ai-work/HANDOFF.md`, then `askai clear` or `askai break` |
| Coming back | `askai continue --copy` (same as `askai resume`) |
| What is set up and used | `askai setup <repo>` (status, check, infra, plugins, to-do, files) |
| Fetch latest, then show `/askai-cli` | `askai upgrade --yes --target cursor --profile coding --project <repo>` (full path `~/.claude/askai/bin/askai` if needed). Reload Cursor, open that folder itself, type `/`, choose `askai-cli` |
| Use connected plugins in a chat | `/askai-plugins` (Codex: `$askai-plugins`) |
| Where tokens go | `askai audit`, `askai usage 7`, `askai report` |
| Housekeeping | `askai update`, `askai doctor`, `askai uninstall` |

## Commands to keep handy

| Need | Claude Code | Codex CLI | Antigravity CLI | Cursor |
|:--|:--|:--|:--|:--|
| What fills my context | `/context` | `/status` | `/context` | `/context` |
| Usage left, where it went | `/usage` (d/w) | `/usage daily` / `weekly` | `/usage`, `/credits` | Dashboard, Usage |
| New task, fresh chat | `/clear` | `/new` | `/clear` | `/clear` |
| Shrink a chat you must keep | `/compact keep: goal, files, test` | `/compact` | fresh chat + handoff | `/summarize` |
| Stop a wrong turn | `Esc`, `/rewind` | `Esc`, `Esc Esc` | `Esc`, `/rewind` | `Esc`, `/rewind` |
| Branch an idea | `/rewind`, retry | `/fork` | `/fork` | `/fork` |
| Plan before editing | `Shift+Tab`, `/plan` | `/plan` | `/plan` | `/plan`, `/ask` |
| Side question | `/btw` | `/side` | `/btw` | `/ask` |
| Lower thinking | `/effort medium` | `Alt+,` | `/effort low` | non-thinking model |
| Strong model only when needed | `/advisor opus` (Sonnet session) | Sol for the hard step | Pro for the hard step | frontier for the hard step |
| Unused tools off | `/mcp` | `/mcp` | `/mcp` | Settings, MCP |
| Handoff before a break | Ask the agent to write `.ai-work/HANDOFF.md` | Same | Same | Same |
| AskAI-only terminal | `/askai-cli` | `/prompts:askai-cli` or `$askai-cli` | `/askai-cli` | `/askai-cli` |
| Connected plugins | `/askai-plugins` | `$askai-plugins` | `/askai-plugins` | `/askai-plugins` |
| Resume later | `/resume`, `claude -c` | `codex resume --last` | `/resume` | `agent --continue` |

## Cheapest model first

| Task | Claude Code | Codex | Antigravity | Cursor |
|:--|:--|:--|:--|:--|
| Search, small edits, tests, docs | Haiku, low | Luna-class, low | Flash, low | Auto |
| Everyday features and fixes | Sonnet (Haiku if it copes), medium | Sol, medium | Flash or Pro, medium | Auto |
| Hard debugging, architecture | Sonnet + `/advisor opus`, high | Sol, high | Pro or Claude, high | frontier, no Max Mode |

## Habits that save the most
1. One task per chat; `/clear` between tasks. `/compact` is itself a big request.
2. One complete prompt (goal, files, how to verify) instead of drip-fed follow-ups. Edit and regenerate instead of correcting.
3. Name files with `@path`; search first, then read line ranges; batch independent reads in one message.
4. Plan first for multi-file work; give a test or command that proves it is done.
5. Ask for the smallest change that works; no unrequested refactors.
6. Paste only the failing function or the last 10–40 log lines.
7. Few subagents, on cheap models; no agent teams for routine work.
8. `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` under 200 lines; MCP servers off unless needed; CLIs (`gh`, `rg`, `jq`) instead.
9. No speed or big-context modes: Claude fast mode, Codex Fast/Ultrafast, Cursor Max Mode. Unset `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
10. Claude peak hours: weekdays 08:00–14:00 US Eastern (17:30–23:30 IST in US summer, 18:30–00:30 IST after early November).

## Before a break
Finish the verified step, then commit or stash, then ask the agent to write `.ai-work/HANDOFF.md`, then run `askai break`. Stop `/loop`, `/goal`, teams and background agents, and note your reset time.

**Coming back:** `askai resume --copy` says whether to continue or start fresh and copies the prompt. The prompt: "Read AGENTS.md, then .ai-work/HANDOFF.md, then only the files it lists. Check them against git status and git log -1. Summarise in 6 lines, confirm the next step, and wait."

## Not worth installing for savings
RTK (median +7% cost), Context Mode (+33% to +72%), Headroom (+32%), lean-ctx (+10%), proxies and routers (billing and data risk). AskAI installs what helps instead: Ponytail- and Caveman-style rules (−10% and −8%), LSP plugins with `--lsp` (−13%), ccusage for measurement.
