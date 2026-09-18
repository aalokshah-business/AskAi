---
description: Token savings report for askai + caveman + settings - tokens saved per feature vs askai's own cost, plus where tokens went, hook overhead, caveman on/off, A/B arms. Args: hours (default 6).
argument-hint: [hours]
allowed-tools: Bash(node:*)
---

Run `node "$HOME/.claude/hooks/askai-report.js" --hours <N>` with N = `$ARGUMENTS` (a number of hours; default 6 if empty). Use the Bash tool. On Windows use `node "%USERPROFILE%\.claude\hooks\askai-report.js"` if `$HOME` is not set.

The script's first block is the TOKEN SAVINGS LEDGER: tokens saved per feature (A), askai's own cost (B), overhead avoided by design (C) and NET. Every row carries an evidence label: MEASURED (A/B arms), COMPUTED (config arithmetic), OBSERVED (on/off comparison, correlation only), none (unmeasurable, 0 credited).

Then reply with:
1. The ledger's A/B/NET lines and the VERDICT block from the script output, verbatim.
2. At most 3 bullets of what to change next, ranked by measured cost share. Only claim savings the report actually supports; OBSERVED rows are correlation, not proof, and say so.
3. If the MEASURED A/B line says "none yet", add one line: put `on` in `<project>/.claude/askai/ab.txt` (or `~/.claude/askai-ab.txt`) to start a random per-session control/treatment split for NEW sessions.

Do not recompute or re-round the script's numbers. Do not edit any files. For a cumulative view, pass 168 (7 days) or 720 (30 days) as the hours argument.
