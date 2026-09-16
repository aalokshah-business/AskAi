---
description: Token-efficient task runner — scopes area, extra context, and caps answer length
argument-hint: <task description>
---

Handle this task in token-efficient mode. Before doing any exploration, always confirm three things with the user via one AskUserQuestion call — even when they're inferable or a default would obviously apply. Pre-fill each question's options with your best guess (including the relevant default) so confirming is one click, but still ask:

1. **Area** — the specific file(s), directory, or topic this task is scoped to (offer your best guess as an option, e.g. inferred from the task text or "no specific area — general question"). Stay inside the confirmed scope; do not explore the wider codebase/project unless answering truly requires it.
2. **Additional items** — anything extra to pull into scope beyond the area (e.g. "also the tests", "and the config file"). Offer "none" as the default option.
3. **Answer length** — max characters for your final reply. Offer "500 characters (default)" plus a couple of other sizes as options.

Only skip the question entirely if the user's request already explicitly pins down all three (e.g. they named the file, said what else to include, and gave a character limit) — in that case state what you're using in one line instead of asking.

Then do the task:
- Read/search only within area + additional items — no broader exploration.
- Keep the final answer at or under the character budget. If something has to give, cut explanation before cutting the direct answer.

Task: $ARGUMENTS
