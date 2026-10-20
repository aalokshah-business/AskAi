---
description: Write a short session handoff to .ai-work/HANDOFF.md before /clear, a break, or switching to another coding agent.
disable-model-invocation: true
---

Stop after the current verified step; do not start anything new. Overwrite `.ai-work/HANDOFF.md` in the repository root (create the folder if needed; it is gitignored) in under 40 lines: goal and acceptance criteria; what is verified and what is not; branch, last commit and uncommitted files; exact test results; decisions with their reasons; ordered next steps, smallest first; and the 3-5 files with line ranges to read first next session. No code and no secrets. Then reply with one line: "Handoff written to .ai-work/HANDOFF.md".
