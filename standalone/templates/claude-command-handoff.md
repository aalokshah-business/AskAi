---
description: Write a short session handoff to .ai-work/HANDOFF.md before /clear, a break, or switching tools.
disable-model-invocation: true
---

Stop after the current verified step; do not start anything new. Overwrite `.ai-work/HANDOFF.md` in the repository root (create the folder; it is gitignored) in under 40 lines: goal and acceptance criteria; what is verified and what is not; branch, last commit and uncommitted files; exact test results; decisions with reasons; ordered next steps, smallest first; and the 3-5 files with line ranges to read first next session. No code, no secrets. Then reply with one line: "Handoff written to .ai-work/HANDOFF.md".
