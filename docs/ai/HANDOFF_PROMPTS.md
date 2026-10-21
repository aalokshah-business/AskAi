# Copy-paste prompts for breaks, resumes and tool switches

## BEFORE A BREAK (any agent)
Stop after the current verified step; do not start anything new. Overwrite `.ai-work/HANDOFF.md`
using its template, under 40 lines: goal + acceptance criteria, what is verified vs not, branch / last
commit / uncommitted files, exact test results, decisions with reasons, ordered next steps (smallest
first), and the 3-5 files with line ranges to read first. No code, no secrets. Then stop.

## AFTER A BREAK or IN A DIFFERENT TOOL
Read `AGENTS.md`, then `.ai-work/HANDOFF.md`, then only the files it lists. Run `git status --short`
and `git log -1 --oneline` and check the handoff against reality; do not trust a previous agent's
claims blindly. Summarise the current state in <= 6 lines, confirm the next step in one sentence,
and wait for my go-ahead. Preserve uncommitted changes.

## NEW FEATURE
Goal: [one outcome]. Acceptance criteria: [testable bullets]. Scope: [paths allowed].
Out of scope: [list]. Inspect only relevant files, propose a short plan, wait for approval, then make
minimal changes, run focused checks and report in <= 12 lines.

## BUG FIX
Symptom: [steps, expected vs actual]. Environment: [OS/device/version]. Evidence: [small log excerpt].
Find the root cause with evidence, change only what is necessary, add a regression test, show the
verification and remaining risks. No unrelated refactors.

## DESIGN / REFACTOR PLANNING
Goal: [outcome]. Constraints: [what must not change]. Before any edit, map the relevant files and
list 3-5 steps as `1. [step] -> verify: [check]`. Ask only if a product decision blocks you.

## HIGH-RISK CHANGE (auth, payments, data, deploy scripts)
Do not touch production data, dependencies or deployment resources. Explain the change, rollback
path, preconditions and risks first. Run checks in a sandbox/worktree. Ask before anything irreversible.
