# Model and effort per task

Tiers only. The current task stays in docs/ai/WORK_ORDER.md.

Choose the tier when the session starts (`askai go <tool> --tier <tier>`) and keep it for the session: a model switch rebuilds the prompt cache and re-reads the conversation at full price. Raise effort for one hard step if needed, then lower it again.

| Tier | Use for | Claude Code | Codex | Cursor | Antigravity |
| --- | --- | --- | --- | --- | --- |
| lead (`architect`) | Architecture and design, ambiguous debugging, security, cross-module integration | sonnet, max | gpt-6.1-sol, high | grok-4.7, xhigh | flash, high |
| build (`builder`) | Features, enhancements and bug fixes within the existing design | sonnet, high | gpt-6.1-sol, medium | grok-4.7, high | flash, high |
| chore (`runner`) | Cleanup, running scripts and tests, git, search, small docs edits | haiku, high | gpt-6-luna, high | grok-4.7, medium | flash, high |

- Routine work runs in the main session with no subagents. Delegate a bounded task to the tier's agent by name.
- Claude Code: subagent files set `model` and `effort`; for `max` in the main session AskAI sets `CLAUDE_CODE_EFFORT_LEVEL=max` (the settings key downgrades it).
- Codex: custom agents are never spawned automatically; ask for them by name. Check a worker's real model in its session log (`askai infra`): a known bug can make it inherit the parent model.
- Cursor: Grok 4.7 tiers (Sonnet needs Premium or above); effort is part of the model ID, so pick the matching variant from `agent models`.
- Antigravity: agent files take only a tier (`flash`, `pro`, `flash_lite`, `inherit`); set `/effort high` at the start of the session.

Change a preference: `askai models set <tool>.<tier> <model>[:<effort>]`, then `askai init --refresh` to rewrite the agent files.
