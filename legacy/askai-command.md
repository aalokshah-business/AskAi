---
description: Token-efficient task runner — scopes area, extra context, and caps answer length. Also handles skill authoring (create/edit/improve a Claude skill) by handing off to the skill-creator workflow.
argument-hint: <task description>
---

First check: is this task about creating, drafting, editing, or improving a Claude skill itself (a SKILL.md, its bundled scripts/references, or its triggering description) — as opposed to using an existing skill to do unrelated work? If so, skip everything below and instead invoke the `skill-creator` skill, giving it the task in `$ARGUMENTS` verbatim as its starting context. Skill authoring is a multi-step interview/draft/test loop that the area/length scoping below doesn't fit, so don't apply it here. Once skill-creator's process concludes (skill drafted, tested, or packaged per the user's request), stop — don't fall through to the steps below for the same task.

Otherwise, handle this task in token-efficient mode. Do not ask the user to confirm scope with AskUserQuestion; a round trip costs more than it saves. Before any exploration, state in ONE line the three things you are assuming, inferring each from the task text:

1. **Area** -- the specific file(s), directory, or topic this task is scoped to (or "no specific area" for a general question). Stay inside it; do not explore the wider codebase/project unless answering truly requires it.
2. **Additional items** -- anything extra pulled into scope beyond the area. Default: none.
3. **Answer length** -- max characters for your final reply. Default: 500 characters.

If the user's request already pins any of these down, use theirs. Ask (one short question) only if the task is genuinely ambiguous or expensive to get wrong.

Then do the task:
- Read/search only within area + additional items — no broader exploration.
- Keep the final answer at or under the character budget. If something has to give, cut explanation before cutting the direct answer.

Task: $ARGUMENTS
