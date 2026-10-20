<!-- token-kit:begin (managed by token-setup; --uninstall removes it) -->
## Token rules
- Read code by searching first (grep/rg), then read only the needed line ranges. Read a whole file only when editing most of it; do not re-read a file you just edited.
- Batch independent reads and searches into one message: one turn instead of several.
- Make the smallest change that solves the task: reuse existing code and the standard library; no speculative features, abstractions or unrequested refactors; keep validation, error handling and security intact.
- Answer tersely: no preamble, no restating the question, no tool-call narration. Keep code, commands, numbers and error text exact; use full sentences for warnings and destructive actions.
- Run the narrowest test or build command first and read only the failing lines of its output.
- Ask one round of clarifying questions when a requirement is truly ambiguous, then proceed.
- Subagents: only for broad searches or log reading; give them a tool-call limit (15) and a reply limit (under 1,500 characters); use model haiku for search.

# Compact instructions
Keep the goal, acceptance test, files changed, decisions and the failing test output; drop exploration and resolved errors.
<!-- token-kit:end -->
