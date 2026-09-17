---
description: Token-efficient task runner — scopes area, extra context, caps answer length, and recommends an effort level. Also handles skill authoring (create/edit/improve a Claude skill) by handing off to the skill-creator workflow.
argument-hint: <task description>
---

First check: is this task about creating, drafting, editing, or improving a Claude skill itself (a SKILL.md, its bundled scripts/references, or its triggering description) — as opposed to using an existing skill to do unrelated work? If so, skip everything below and instead invoke the `skill-creator` skill, giving it the task in `$ARGUMENTS` verbatim as its starting context. Skill authoring is a multi-step interview/draft/test loop that the area/length scoping below doesn't fit, so don't apply it here. Once skill-creator's process concludes (skill drafted, tested, or packaged per the user's request), stop — don't fall through to the steps below for the same task.

Otherwise, handle this task in token-efficient mode. Before doing any exploration, always confirm four things with the user via one AskUserQuestion call — even when they're inferable or a default would obviously apply. Pre-fill each question's options with your best guess (including the relevant default) so confirming is one click, but still ask:

1. **Area** — the specific file(s), directory, or topic this task is scoped to (offer your best guess as an option, e.g. inferred from the task text or "no specific area — general question"). Stay inside the confirmed scope; do not explore the wider codebase/project unless answering truly requires it.
2. **Additional items** — anything extra to pull into scope beyond the area (e.g. "also the tests", "and the config file"). Offer "none" as the default option.
3. **Answer length** — max characters for your final reply. Offer "500 characters (default)" plus a couple of other sizes as options.
4. **Effort level** — judge how demanding the task actually is from the prompt, and pre-fill your recommendation as the default option: `medium` for a straightforward ask (lookup, one-line answer, obvious mechanical edit), `xhigh` for genuine complexity (deep multi-file reasoning, tricky architecture/design tradeoffs, high-stakes correctness), and `high` for everything typical in between — lean toward `high` for most real work. Offer exactly these three options (`medium`, `high`, `xhigh`); never offer or recommend `max` — only propose it if the user has separately, explicitly said this specific task calls for it.

Only skip the question entirely if the user's request already explicitly pins down all four (e.g. they named the file, said what else to include, gave a character limit, and stated an effort level) — in that case state what you're using in one line instead of asking.

Then do the task:
- Read/search only within area + additional items — no broader exploration.
- Keep the final answer at or under the character budget. If something has to give, cut explanation before cutting the direct answer.
- This session cannot change its own effort level (self-effort changes are refused by design, so the session doesn't silently re-price its own turns). If the confirmed effort level differs from the session's current one, say so in one line and tell the user to apply it themselves via the app's effort-level selector — don't claim to have applied it.

Task: $ARGUMENTS
