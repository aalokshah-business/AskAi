## Your screenshots and popular tips, checked

Your PDF has 20 pages: 11 slides from the AI Automation Society series, plus posts from @vaibhavsisinty, @charlieautomates, @techfren, @wdf\_ai and @agilesingh. Four of the five JPGs are copies of pages 8, 9, 10 and 12 (the fifth duplicates one of those). Every page was read again for this guide.

| Page | What it says | Verdict |
| --- | --- | --- |
| 1 | Batch prompts into one message; edit and regenerate instead of follow-ups | True: each turn re-reads the context |
| 2 | Plan mode first; "95% confidence, ask follow-up questions" in CLAUDE.md | True for planning; keep the questions to one round |
| 3 | `/context` and `/cost` | True; `/cost` now lives inside `/usage` |
| 4 | Set up a status line | True; ccusage or Claude Code's own fields show context and cache |
| 5 | Paste only the function or the last 10 log lines | True |
| 6 | Lean CLAUDE.md under 200 lines, used as an index | True, and Anthropic's own advice |
| 7 | Compact at about 60%; after 3–4 compacts, summarise and clear | Partly: compacting is itself a big request, so hand off and clear at a task boundary instead |
| 8 | Agent workflows use 7–10x tokens; Haiku subagents; teams very expensive | True: Anthropic cites about 7x for teams |
| 9 | Peak hours 8 AM–2 PM ET on weekdays | True for Claude (17:30–23:30 IST in US summer, 18:30–00:30 IST in winter); not documented for the other three |
| 10–11 | Headroom install (`pip install headroom-ai`, v0.24.0) | Works, but four studies put its median cost at +32% |
| 12 | `/doctor` audit; rule layers loaded by keyword; a cache-aware status line | `/doctor` is built in and worth a weekly run |
| 13 | Karpathy rules; a routing table using only Sonnet and Opus at high or max effort | Keep the rules; the routing table maximises quality, not usage |
| 14 | "3 hacks to save up to 50%": `/doctor`, an effort table in CLAUDE.md, manual effort | The habits are sound; the 50% figure is unverified |
| 15 | `/effort` and `/code-review` in Claude Code's picker | True; both are built in |
| 16 | A "Token Saver" panel toggling RTK, Headroom, Caveman, Ponytail | A router dashboard; of the four, only Caveman-style and Ponytail-style rules show savings |
| 17 | Caveman: 69 vs 19 tokens; terse commits; input compression | About 8% fewer tokens in agent work, not 65% |
| 18 | `headroom wrap claude` with Claude Code showing **API Usage Billing** | Real risk: a proxy can move you from your plan to per-token billing |
| 19 | `/clear` between unrelated tasks, the #1 habit | True, and free |
| 20 | Disconnect MCP servers (about 17,600 tokens each) and use CLIs | Direction right; the figure predates Claude Code deferring MCP tool definitions |

| Popular tip | Verdict |
| --- | --- |
| "RTK saves 60–90%" | False at task level: +7% median cost; the 60–90% is shell output only |
| "Caveman saves 65%" | About 8%, measured on agent tasks |
| "Cursor Auto is free and unlimited" | Outdated: Auto counts against your included usage, at low rates |
| "Delete old transcripts to save tokens" | False: they never enter the context; it only frees disk |
| "Idle Claude Code burns tokens" | Mostly false for a stopped session (background jobs cost under $0.04 per session); true for scheduled loops, goals and teams left running |
| "Use the 1M window as insurance, reset around 120K" | True: calls above 150K dominate cost |
| "Thinking is free" | False: thinking is billed as output |
| "Spend leftover quota before the 5-hour reset" (Antigravity community) | Only if your weekly cap is not the limit you hit |

