---
description: Full askai report - tool status and measured savings, health checks, and where tokens went (transcript ledger). Args: hours (default 6).
argument-hint: [hours]
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run `{{ASKAI}} report <N>` with N = `$ARGUMENTS` (a number of hours; default 6 if empty). Use the Bash tool.

The output has three sections:
1. TOOLS AND MEASURED SAVINGS: state and wiring of RTK, Context Mode, Serena, Caveman and the status line, with the savings each tool measures itself.
2. HEALTH: the `askai doctor` checks (ok / warn / FAIL).
3. SPEND FROM TRANSCRIPTS: where tokens went, then the TOKEN SAVINGS LEDGER. Every ledger row carries an evidence label: MEASURED (A/B arms), COMPUTED (config arithmetic), OBSERVED (on/off comparison, correlation only), none (unmeasurable, 0 credited).

Then reply with:
1. Section 1 verbatim (the tool lines and any measured savings it prints), then the health summary line and every warn/FAIL line from section 2.
2. The ledger's A/B/NET lines and the VERDICT block from section 3, verbatim.
3. At most 3 bullets of what to change next: first anything not `ok` in sections 1 and 2 with its fix command (`askai install --only <id>`), then what the spend data supports, ranked by measured cost share. Only claim savings the report supports; OBSERVED rows are correlation, not proof, and say so. Serena and Caveman have no counter, so no savings are claimed for them.
4. If the MEASURED A/B line says "none yet", add one line: put `on` in `<project>/.claude/askai/ab.txt` (or `~/.claude/askai-ab.txt`) to start a random per-session control/treatment split for NEW sessions.

Do not recompute or re-round the script's numbers. Do not edit any files. For a cumulative view, pass 168 (7 days) or 720 (30 days) as the hours argument.
