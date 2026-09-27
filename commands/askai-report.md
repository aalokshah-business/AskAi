---
description: Full askai report - tool status and measured savings, health checks, cache and context per session, usage report, and where tokens went. Args: hours (default 6).
argument-hint: [hours]
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run `{{ASKAI}} report <N>` with N = `$ARGUMENTS` (a number of hours; default 6 if empty). Use the Bash tool.

The output has these sections, numbered as printed (the ccusage section appears only when ccusage is installed):
1. TOOLS AND MEASURED SAVINGS: state and wiring of RTK, Context Mode, Serena, markitdown, ccusage, Caveman, the path-scoped rules and the status line for the profile in effect, with the savings each tool measures itself.
2. HEALTH: the `askai doctor` checks (ok / warn / FAIL).
3. CACHE AND CONTEXT PER SESSION: what Claude Code last reported to the askai status line for each session (context use, prompt-cache hit, re-cache tokens, last miss cause). Claude Code only.
4. USAGE AND COST BY DAY (optional): ccusage's own output, first lines only.
5. SPEND FROM TRANSCRIPTS: where tokens went, then the TOKEN SAVINGS LEDGER. Every ledger row carries an evidence label: MEASURED (A/B arms, historic), COMPUTED (config arithmetic), OBSERVED (on/off comparison, correlation only), none (unmeasurable, 0 credited).

Then reply with:
1. The tools section verbatim (the tool lines and any measured savings it prints), then the health summary line and every warn/FAIL line from the health section.
2. From the cache section: any session with a low cache hit or a large re-cache figure, and its last miss cause. Skip this if there are no snapshots yet.
3. The ledger's A/B/NET lines and the VERDICT block from the spend section, verbatim.
4. At most 3 bullets of what to change next: first anything not `ok` in the tools and health sections with its fix command (`askai install --only <id>`), then what the cache and spend data support, ranked by measured cost share. Only claim savings the report supports; OBSERVED rows are correlation, not proof, and say so. Serena, markitdown, the path rules and Caveman have no counter, so no savings are claimed for them. ccusage saves nothing itself; it only reports spend.

Do not recompute or re-round the script's numbers. Do not edit any files. For a cumulative view, pass 168 (7 days) or 720 (30 days) as the hours argument.
