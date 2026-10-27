@AGENTS.md

<!-- askai:begin claude (askai init --refresh updates this block; write your own notes outside it) -->
## Claude Code
- Shared project rules stay in AGENTS.md. This file imports them with `@AGENTS.md` and adds only Claude Code behavior.
- Subagents (.claude/agents): architect (claude-sonnet-5-5, xhigh), builder (claude-sonnet-5-5, high), runner (claude-haiku-5-5, max). Delegate by name, only for bounded work.
- Start a session with `askai go claude --tier <lead|build|chore>`: it sets the model and effort once.
- When installed: Serena (activate_project once, then find_symbol/get_symbols_overview) before reading a whole source file; Context7 for current library docs; ctx_execute/ctx_batch_execute for long tool or test output. This is a project-level repeat of the same rule in your global askai-coding.md, since a rule stated only once at session start tends to fade from a long conversation. Read/Grep/Bash directly only when the plugin is not installed or does not apply.
- Plan mode (Shift+Tab) for changes touching more than two files. Before /clear: write .ai-work/HANDOFF.md.
<!-- askai:end -->
