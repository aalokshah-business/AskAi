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

## Updating a deployed machine after editing this repo

```
powershell -ExecutionPolicy Bypass -File askai-setup.ps1
```

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

See the full writeup for how the system works day to day.
