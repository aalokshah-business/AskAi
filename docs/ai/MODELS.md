# Model and effort per task

Tiers only. The current task stays in docs/ai/WORK_ORDER.md.

Choose the tier when the session starts (`askai go <tool> --tier <tier>`) and keep it for the session: a model switch rebuilds the prompt cache and re-reads the conversation at full price. Effort is disputed the same way (Anthropic says no, three creator videos say yes), so treat a mid-session effort change as a reset too: for one hard step, start a fresh session at a higher effort instead of raising it in place.

| Tier | Use for | Claude Code | Codex | Cursor | Antigravity |
| --- | --- | --- | --- | --- | --- |
| lead (`architect`) | Architecture and design, ambiguous debugging, security, cross-module integration | claude-sonnet-5-5, xhigh | gpt-6.1-sol, xhigh | claude-sonnet-5-5, xhigh | flash, high |
| build (`builder`) | Features, enhancements and bug fixes within the existing design | claude-sonnet-5-5, high | gpt-6.1-sol, high | claude-sonnet-5-5, high | flash, high |
| chore (`runner`) | Cleanup, running scripts and tests, git, search, small docs edits | claude-haiku-5-5, max | gpt-6.1-terra, xhigh | claude-haiku-5-5, max | flash, high |

- For architecture design, detailed analysis, supervision or review, explicitly use Claude with the model Opus 5.5 (claude-opus-5-5) at Extra High effort (xhigh). Nothing here ever picks it automatically; keep it for bigger work or before a submission.
- Routine work runs in the main session with no subagents. Delegate a bounded task to the tier's agent by name.
- Claude Code: subagent files set `model` and `effort`; for `max` in the main session AskAI sets `CLAUDE_CODE_EFFORT_LEVEL=max` (the settings key downgrades it).
- Codex: custom agents are never spawned automatically; ask for them by name. Check a worker's real model in its session log (`askai infra`): a known bug can make it inherit the parent model.
- Cursor: Sonnet tiers (Premium plan or above); effort is part of the model ID, so pick the matching variant from `agent models`.
- Antigravity: agent files take only a tier (`flash`, `pro`, `flash_lite`, `inherit`); set `/effort high` at the start of the session.

Change a preference: `askai models set <tool>.<tier> <model>[:<effort>]`, then `askai init --refresh` to rewrite the agent files.
