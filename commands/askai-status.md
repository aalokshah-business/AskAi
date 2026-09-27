---
description: Which token-saving tools are installed and wired (RTK, Context Mode, Serena, markitdown, Caveman, path rules), plus the savings the tools themselves measure.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run `{{ASKAI}} status` with the Bash tool and show its output verbatim in a fenced code block.

Then add at most 3 short bullets, only if the output supports them:
- any component whose state is not `ok` and the one command that fixes it (`askai install --only <id>`);
- RTK savings exactly as printed (tool-measured); for Context Mode point to `/context-mode:ctx-stats`, which reports per session;
- remind that Serena, markitdown, the path rules and Caveman have no counter, so no savings are claimed for them.

Do not estimate or add up savings yourself. Do not edit any files.
