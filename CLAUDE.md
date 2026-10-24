@AGENTS.md

<!-- askai:begin claude (askai init --refresh updates this block; write your own notes outside it) -->
## Claude Code
- Shared project rules stay in AGENTS.md. This file imports them with `@AGENTS.md` and adds only Claude Code behavior.
- Subagents (.claude/agents): architect (sonnet, xhigh), builder (sonnet, high), runner (haiku, xhigh). Delegate by name, only for bounded work.
- Start a session with `askai go claude --tier <lead|build|chore>`: it sets the model and effort once.
- Plan mode (Shift+Tab) for changes touching more than two files. Before /clear: write .ai-work/HANDOFF.md.
<!-- askai:end -->
