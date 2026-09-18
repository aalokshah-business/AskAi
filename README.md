# askai — token-optimization infrastructure for Claude Code

Source of truth for the askai hook system. Deployed copies live under `~/.claude/`
(hooks/, commands/, settings.json) — this repo is what you edit and version;
re-run `askai-setup.ps1` (or manually copy) to push changes out to `~/.claude/`.

## Contents

- `hooks/askai.ps1` — the unified hook script (UserPromptSubmit + PostToolUse + PreCompact)
- `commands/askai.md` — the `/askai` slash command
- `askai-setup.ps1` — portable installer; copies the two files above into
  `~/.claude/` and merges the hook registrations into `~/.claude/settings.json`
  on whatever machine it's run on (safe to re-run, won't duplicate entries or
  touch unrelated settings)

## What the hook does

- `UserPromptSubmit` — scoping reminder for new/distinct tasks (area,
  additional items, answer length, and a recommended effort level), injects
  the session's tracked feature summary, `#slug` tagging, a pending-clear
  reminder, and the checkpoint trigger (every N prompts, a wrap-up phrase,
  or accumulated tool-output volume).
- `PostToolUse` — accumulates tool-output volume per session; if volume alone
  crosses the threshold mid-turn, it now fires a same-turn checkpoint
  instruction instead of waiting for the next prompt. If a clear is already
  pending when volume crosses again, it files a lightweight silent note
  instead, so bytes don't grow unbounded while the clear is deferred.
  Scoped via `matcher: Bash|Read|Grep|Agent|Task` so it skips the ~250ms
  powershell.exe spawn on cheap tools like Edit/Write (the `Agent`/`Task`
  pair covers the subagent-dispatch tool under both its CLI name `Task`
  and its SDK/desktop name `Agent` -- verified against real transcripts
  that only `Agent` actually appears in this environment).
- `PreCompact` — writes a brief safety-net note before context compaction.

## `/askai <task>`

Confirms four things before touching anything: area, extra scope, answer
length, and a recommended effort level (`medium`/`high`/`xhigh` —
never `max` unless you've separately said this task calls for it). Tasks
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
- Sends the **full scoping rules, pending-clear text and checkpoint steps once per session**; later prompts get a ~150-350 char pointer. State lives in `sessions/<sid>.seen.txt` / `.summary.txt`, both cleared on PreCompact.
- Resolves one **project root** (nearest `.git`, else nearest existing `.claude/askai`, else cwd) so sessions started in subdirectories no longer create stray `.claude/askai/` folders.

Note: `askai-setup.ps1` currently embeds its own copy of `askai.ps1`/`askai.md`
content rather than reading `hooks/`/`commands/` at run time — if you edit the
scripts here, regenerate the installer's embedded copies to match (or just
copy `hooks/askai.ps1` and `commands/askai.md` directly to `~/.claude/hooks/`
and `~/.claude/commands/`, which is simpler for a single-machine update).

## Per-project configuration (not in this repo)

Each project using askai has its own tuning, checked into that project instead:
- `.claude/askai/interval.txt`, `.claude/askai/volume-threshold.txt`
- `.claude/settings.json` (`bashOutputMaxChars`, `taskOutputMaxChars`, `effortLevel`, `permissions.allow`)
- `CLAUDE.md` conventions
- `.claude/askai/*.md` — accumulated feature summaries (project memory, not infrastructure)
- `.claude/askai/metrics.jsonl` — append-only log of checkpoint/clear events (timestamp, session, feature slug, trigger, pre-clear tokens/percent used, and outcome: cleared/held/blocked/declined), written by the agent per the checkpoint-closing instructions; ask the agent to summarize it for a read on real token savings over time

See the full writeup for how the system works day to day.
