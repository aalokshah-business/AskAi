# Token-saving tools: claimed vs measured

From the AskAI Guide, Part 3 (21 October 2026). Sources: docs/research/SOURCES.md. `askai plugins decisions` prints where each tool stands; `askai plugins info <id>` how to use it.


Of the 50-odd tools found, only a handful have an independent measurement showing a saving, and none comes close to its headline. "Measured" means a third-party paired benchmark (JetBrains, THOL, Dasein Labs, Stet.sh, Tura, Marmelab, Codepointer), as collected in the [cc.bruniaux.com catalogue](https://cc.bruniaux.com/token-savings/). Negative is cheaper; treat single studies as direction.

| Category | Tool | Claim | Measured by third parties | Verdict (and AskAI) |
| --- | --- | --- | --- | --- |
| Built in | `/usage`, `/context`, `/doctor`, plan mode, `/clear`, effort, skills, MCP tool deferral | — | Official guidance; `/doctor` flags large CLAUDE.md files, agent descriptions over 15K tokens and MCP tools over 25K | Use daily; `/doctor` weekly |
| Built in | Claude Code advisor (`/advisor opus`) | Opus judgment at Sonnet cost | About a third cheaper than Opus throughout (independent analyses) | Use instead of switching to Opus |
| Measurement | [ccusage](https://github.com/ryoppippi/ccusage); Claude-Code-Usage-Monitor; Cursor dashboard | Usage views | Reports only | ccusage in the `full` profile |
| Status lines and monitors | ccstatusline, CCometixLine, claude-powerline, claude-hud; Token Monitor (26+ tools incl. Codex, Cursor, Antigravity); a Claude/Codex quota bar for VS Code and Cursor; Antigravity Cockpit | Show context, quota and spend | Reports only | AskAI's own status line; `askai savings` |
| Budget guard | tokenlens | Warn or block against the weekly cap | Reports only; saves nothing per task | Optional |
| Behaviour rules | [Ponytail](https://github.com/DietrichGebert/ponytail) | −20% cost | **−10.3%** (JetBrains, p=0.004); −3.5% (THOL); −8.9% (Tura); +20% then −2% (Stet.sh) | Use; AskAI writes its rule |
| Behaviour rules | [Caveman](https://github.com/JuliusBrussee/caveman) | 65% fewer tokens | **Median −8%** over six studies, quality unchanged | Use; AskAI writes a terse block; its proxy is not installed |
| Behaviour rules | SuperClaude (`--uc` ultracompressed mode) | 30–50% fewer tokens | None independent; the framework loads several thousand tokens of instructions every session | Not installed; `askai ask superclaude` |
| Behaviour rules | [claude-token-efficient](https://github.com/drona23/claude-token-efficient); [Karpathy guidelines](https://github.com/forrestchang/andrej-karpathy-skills); Honey; Governor | 24–63% | −11.6% (THOL) for the first; none for the rest | Small rule files are fine |
| Audit tools | claude-config-doctor (an LLM skill); claude-doctor (offline transcript analysis that writes rules) | Find config problems and bad habits | Useful reviews; the LLM one spends tokens each run | `askai check` is deterministic and free |
| Plugin bundles | context\_guard (14 skills, hooks); token-saver (rules, cheap subagents, audit); TokenRoll scout | 30–83% | None independent; scout moves reads into subagents, which are still billed | Their sound parts are AskAI settings and rules |
| Code navigation | Claude Code [LSP plugins](https://code.claude.com/docs/en/plugins/code-intelligence.md) | Symbols instead of reads | **−13%** (Marmelab) | Use; `--lsp` |
| Code navigation | [Serena](https://github.com/oraios/serena) | Faster navigation | None | Optional; `coding` profile |
| Code navigation | CodeGraph; code-review-graph | 44% cheaper | −7.6%; −8.5% (agent rarely used it) | Optional |
| Code navigation | Graphify, Claude Context, Semble, Code Context Engine, codesight, Stacklit, tilth, grepai, Token Savior | 40–99% | None, \~0% when ignored, or claim withdrawn | Skip |
| Shell filters | [RTK](https://github.com/rtk-ai/rtk) | 60–90% | **Median +7%** over six studies (JetBrains +7.6%, p=0.004) | Not recommended; `--rtk` to test |
| Shell filters | snip, tokf, PandaFilter, Tokenade, squeez | 60–90% of output | None, except squeez −6.9% (THOL) | Skip |
| Context sandbox | [Context Mode](https://github.com/mksglu/context-mode) | 98% of output bytes | **+33% to +72%** (Stet.sh) | Not recommended; `--context-mode` to test |
| Proxies | [Headroom](https://github.com/headroomlabs-ai/headroom); lean-ctx; pxpipe; llmtrim; ClaudeSlim | 20–99% | **Median +32%** (Headroom, four studies); lean-ctx +10.3%; others none | Avoid; can switch you to API billing |
| Hosted or paid | Edgee, Fermat, Parsec, WOZCODE | 25–70% | −14.7%; −22%; none; −13% (single studies) | Only after a security review |
| Routers | 9Router, OmniRoute, claude-code-router, routatic-proxy, Weave Router | 40–70% | None comparable | Avoid on a subscription |
| Memory | claude-mem, ICM, Greplica, Magic Compact, Dynamic Context Pruning | 10x retrieval; 40–50% | None independent | Skip; use the handoff |
| MCP trimming | mcp2cli, Token Optimizer MCP | 96–99% of schema tokens | None independent | Only for MCP-heavy setups |
| Rules on demand | CARL / BASE | Keyword-loaded rules | None | AskAI uses path and glob rules instead |
| Documents | [markitdown](https://github.com/microsoft/markitdown) | PDF and Office to Markdown | Direct mechanism | Use; `docs` profile |
| Bundles | tokless, dotclaude | Wire several of the above | Inherit their tools' results; dotclaude publishes measured usage | Read dotclaude's evidence |
| Bundles | AskAI | Everything in Part 1 | Its own 7-day ledger found its earlier hooks net negative (−2.6%), so it adds none | This guide's tool |


### The ChatGPT conversations, checked

The three ChatGPT answers you shared recommend a phased stack. Each claim is checked below against the independent evidence above.

| Tool or advice | ChatGPT said | What the evidence says | In AskAI |
| --- | --- | --- | --- |
| RTK | Very high priority; automatic after `rtk init` | Median +7% task cost over six studies | Opt-in (`--rtk`), to measure only |
| Headroom | Very high; proxy or MCP mode | Median +32%; the proxy can move Claude Code to API billing | Not installed; `askai plugins info headroom` |
| Serena | Very high | No independent measurement | `coding` profile, all four tools |
| ccusage | Very high, measure first | Reports only; measuring first is right | `full` profile; `askai savings` |
| Context Mode | High | +33% to +72% in the one paired study | Opt-in (`--context-mode`) |
| Repomix | High, for context transfer | Snapshots are large; useful for handovers only | `askai plugins install repomix` |
| Context7 | High, for current docs | No saving measured; avoids guessing at APIs | `askai plugins install context7` |
| Claude-Mem, memory plugins | High; avoid several at once | No independent measurement | Not installed; the handoff file instead |
| Aider | High; separate sessions | A separate agent, not a plugin | `askai plugins info aider` |
| MCP Compressor, Tokenade, LeanCTX, SigMap, codebase-memory-mcp | Medium to high | None measured, or worse (lean-ctx +10.3%) | Not installed; `askai mcp off` for MCP sprawl |
| LLMLingua, LiteLLM, OpenRouter | Medium | For your own API apps; per-token billing | Not for subscriptions |
| Caveman | Medium | Median −8% cost | Terse block in every tool |
| A powerful orchestrator with cheap subagents | Often better than one model; measure | Agrees: fan-out costs about 7x when overused | `architect`, `builder`, `runner` tiers; no subagents for routine work |
| 80–90% automatic after setup | A target, not a guarantee | Settings, rules, hooks and files are automatic; prompting, model choice per session and clearing stay yours | Part 2 |

**What AskAI took from ChatGPT's toolkit.** Its Python CLI duplicated what AskAI already does, so AskAI did not adopt it. Its good ideas were merged into AskAI:

- the work order (`docs/ai/WORK_ORDER.md`)
- the context router (the pointer table in `AGENTS.md`)
- orchestration rules: stop after two failed attempts, bounded outputs, verify yourself
- the four on-demand skills
- the clear and compact gate (`askai clear`), and context advice for tools AskAI cannot read (`askai context`)
- its honesty rule: installed is not configured is not used (`askai infra`)

### ChatGPT's 18-tool list: what AskAI does with each

ChatGPT ranked these by priority. AskAI installs what it can install reliably, by default when the evidence supports it, and records why the rest are left out. `askai plugins decisions` prints the same table for every tool AskAI evaluated.

| Tool | ChatGPT's priority | In AskAI | Why |
| --- | --- | --- | --- |
| RTK | Very high | `max` or `--rtk`, all four tools | Median +7% cost in six independent studies |
| Headroom | Very high | `max` or `--headroom`, MCP mode in all four tools | Median +32% cost in four studies; proxy mode can move Claude Code to API billing, so AskAI never sets it up |
| Serena MCP | Very high | Default, all four tools | Reads symbols instead of whole files |
| ccusage | Very high | Default | Measures only; costs no tokens |
| Claude-Mem | High | `--claude-mem` only | Summarises sessions with Claude in the background, which uses your plan, and overlaps the handoff file |
| Repomix | High | `max` or `--repomix` | Command-line tool only, for handovers between tools; snapshots are large |
| Context Mode | High | `max` or `--context-mode`, Claude Code and Cursor | +33% to +72% cost in one study |
| MCP Compressor | High | Not installed | No verifiable package; Claude Code already loads MCP tool definitions on demand |
| Aider | High | Not installed | A separate agent that needs API keys, so it bills per token |
| Context7 MCP | High | `max` or `--context7`, all four tools | Current library docs; no measured saving |
| Tokenade | Medium–high | Not installed | No verifiable package; measured only on its author's leaderboard |
| Caveman | Medium | Default rules in all four tools; the plugin is in `max` | Median −8% cost in six studies |
| LeanCTX | Medium–high | Not installed | +10.3% cost in one study |
| SigMap | Medium–high | Not installed | No verifiable package; Serena, the LSP plugins and `askai map` cover file targeting |
| codebase-memory-mcp | Medium–high | `--codebase-memory`, all four tools; `askai init` indexes each repository | No independent measurement; overlaps Serena and Graphify |
| LLMLingua | Medium | Not installed | A library for your own applications, not for coding agents |
| LiteLLM | Medium | Not installed | An API gateway: API keys and per-token billing |
| OpenRouter | Medium | Not installed | API billing, and your code goes to a third party |

