# askai — token-optimization infrastructure for Claude Code

Source of truth for the askai hook system. Deployed copies live under `~/.claude/`
(hooks/, commands/, settings.json) — this repo is what you edit and version;
re-run `askai-setup.ps1` (or manually copy) to push changes out to `~/.claude/`.

## Contents

- `hooks/askai.ps1` — the unified hook script (UserPromptSubmit + PostToolUse + PreCompact)
- `commands/askai.md` — the `/askai` slash command
- `hooks/askai-report.js` + `commands/askai-report.md` — evidence report (`/askai-report [hours]`, or `node ~/.claude/hooks/askai-report.js --hours 6 [--json]`); needs Node.js at run time
- `askai-setup.ps1` — portable installer; copies the four files above into
  `~/.claude/` and merges the hook registrations into `~/.claude/settings.json`
  on whatever machine it's run on (safe to re-run, won't duplicate entries or
  touch unrelated settings)

## What the hook does

- `UserPromptSubmit` — scoping rule for new/distinct tasks (state area,
  additional items, answer length in one line; no question is asked), injects
  the session's tracked feature summary, `#slug` tagging, and the checkpoint
  trigger (every N prompts, a wrap-up phrase, or accumulated tool-output
  volume; default volume threshold 150000 chars). Checkpoints are filed
  silently -- no AskUserQuestion -- and `clear_session` is only attempted when
  you say you are wrapping up.
- `PostToolUse` — accumulates tool-output volume per session; if volume alone
  crosses the threshold mid-turn, it fires a same-turn checkpoint
  instruction instead of waiting for the next prompt.
  Scoped via `matcher: Bash|Read|Grep|Agent|Task` so it skips the ~250ms
  powershell.exe spawn on cheap tools like Edit/Write (the `Agent`/`Task`
  pair covers the subagent-dispatch tool under both its CLI name `Task`
  and its SDK/desktop name `Agent` -- verified against real transcripts
  that only `Agent` actually appears in this environment).
- `PreCompact` — writes a brief safety-net note before context compaction.

## `/askai <task>`

States three assumptions in one line before touching anything: area, extra
scope, and answer length (asks only if the task is genuinely ambiguous). Tasks
about creating/editing a Claude skill itself are routed to the
`skill-creator` skill instead of this scoping flow.

## Updating a deployed machine after editing this repo

```
powershell -ExecutionPolicy Bypass -File askai-setup.ps1
```

### Caveman (third-party, installed by default)

`askai-setup.ps1` also installs [caveman](https://github.com/JuliusBrussee/caveman) after the askai settings merge:

- **Skill:** `npx skills add JuliusBrussee/caveman -g -a claude-code -s caveman caveman-commit caveman-compress caveman-review caveman-stats -y --copy`. Only these 5 of the repo's ~20 skills are installed; every installed skill adds its description to each turn's context. Use `/caveman` to toggle terse output.
- **CLI:** `npm install -g @caveman-ai/cli && caveman setup --install` (installs the companion binaries into `~/.caveman/bin`; needs Node 22.13+). In testing this did not modify `~/.claude/settings.json`.
- Skip either with `-SkipCaveman` / `-SkipCavemanProxy`. Failures only warn; needs Node/npm on PATH.
- The four secondary skills (`caveman-commit/-compress/-review/-stats`) are set to `name-only` in `skillOverrides`, so only `/caveman` itself carries a description in context.

### Caveman terse mode inside the askai hook (always-on)

The `/caveman` skill only takes effect once you invoke it. So the askai hook also applies terse output on its own, no skill call needed:

- On the first prompt of each session, `UserPromptSubmit` injects one ~700-char directive (drop filler/articles/hedging, no tool-call narration; code, commands, errors, numbers and negations stay exact; commit/PR text, code comments and file contents stay normal; security warnings and destructive-action confirmations stay in full sentences).
- It is injected **once per session**, not every prompt: hook context persists in history and is re-sent each turn, so per-prompt injection would pile up. `PreCompact` re-arms it so it comes back after a compaction, and a `clear_session` starts a new session id, which re-injects it too.
- Say "stop caveman" or "normal mode" to end it for the session, or `/caveman` for the skill's own levels.
- Level: `off | lite | full | ultra`, default `full`. Set globally in `~/.claude/askai-caveman.txt` (`askai-setup.ps1 -CavemanMode ultra` writes it; an existing file is kept otherwise, and `-SkipCaveman` defaults it to `off`). Per-project override: `<project>/.claude/askai/caveman.txt`. Changing the level re-injects the directive once; `off` sends a single "back to normal" note.
- It costs nothing when off, and it only shortens the assistant's prose, not tool output. For that, the `caveman` CLI proxy above is the separate lever (not wired to Claude hooks here).

### Token-cost design: send once, not every prompt

Hook context persists in message history and is re-sent on every later turn, so anything injected per prompt compounds. The hook therefore:

- Sends the **feature summary once per session** (again after PreCompact, or when a `#slug` tag switches feature), capped to the most recent 6000 chars (override: `.claude/askai/summary-max-chars.txt`, 1000-200000) with a pointer to the full file. Previously a 40 KB summary was re-injected on every prompt.
- Sends the **full scoping rule and checkpoint steps once per session**; later prompts get nothing (scoping) or a ~200 char pointer (checkpoint). The pending-clear reminders and volume-note were removed: they re-injected text every prompt for little value. State lives in `sessions/<sid>.seen.txt` / `.summary.txt`, both cleared on PreCompact.
- Resolves one **project root** (nearest `.git`, else nearest existing `.claude/askai`, else cwd) so sessions started in subdirectories no longer create stray `.claude/askai/` folders.

Note: `askai-setup.ps1` currently embeds its own copy of `askai.ps1`/`askai.md`
content rather than reading `hooks/`/`commands/` at run time — if you edit the
scripts here, regenerate the installer's embedded copies to match (or just
copy `hooks/askai.ps1` and `commands/askai.md` directly to `~/.claude/hooks/`
and `~/.claude/commands/`, which is simpler for a single-machine update).

## Evidence report and A/B test

`askai-report.js` reads Claude Code transcripts (`~/.claude/projects/**/*.jsonl`, including subagents) and opens with a **token savings ledger**: tokens saved per feature (caveman, answer-length budget, scoping, feature summaries, skill name-only overrides, checkpoint + clear, compaction), askai's own cost, and NET. Each row is labelled MEASURED (A/B arms), COMPUTED (config arithmetic), OBSERVED (on/off comparison, correlation only) or unmeasurable (0 credited). `--hours 168` / `--hours 720` give a 7- or 30-day view. It then reports: where tokens went (main vs subagents), askai hook-injection overhead, scoping/answer-length compliance, trigger noise vs completed checkpoint cycles, caveman on/off comparison (observational only) and tool-output volume. Cost units are relative (input + 1.25*cache-create + 0.1*cache-read + 5*output), not billing.

Without a baseline, savings cannot be proven. To get one, put `on` in `<project>/.claude/askai/ab.txt` (or `~/.claude/askai-ab.txt`): each NEW session is randomly assigned `control` (no caveman directive, no scoping reminder) or `treatment` (normal askai), sticky in `sessions/<sid>.arm.txt`. Sessions already running are never assigned. Section 5 of the report compares cost/prompt between arms. Default is off; delete the file or set anything other than `on` to stop.

## Per-project configuration (not in this repo)

Each project using askai has its own tuning, checked into that project instead:
- `.claude/askai/interval.txt`, `.claude/askai/volume-threshold.txt`
- `.claude/settings.json` (`bashOutputMaxChars`, `taskOutputMaxChars`, `effortLevel`, `permissions.allow`)
- `CLAUDE.md` conventions
- `.claude/askai/*.md` — accumulated feature summaries (project memory, not infrastructure)
- `.claude/askai/metrics.jsonl` — append-only log of checkpoint/clear events (timestamp, session, feature slug, trigger, pre-clear tokens/percent used, and outcome: cleared/held/blocked/declined), written by the agent per the checkpoint-closing instructions; ask the agent to summarize it for a read on real token savings over time

See the full writeup for how the system works day to day.
