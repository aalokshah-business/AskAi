# Installing askai on a new laptop

Two files, one command. No manual path editing — the installer figures out
the new machine's username itself.

## 1. Copy these two files to the new laptop

- `askai-setup.ps1` — the installer (run this)
- `README.md` — optional, background reading

(`hooks/askai.ps1` and `commands/askai.md` are also in this folder for
reference/version control, but you don't need to copy them separately —
the installer has their content built in.)

## 2. Run it

Open PowerShell on the new laptop and run:

```powershell
powershell -ExecutionPolicy Bypass -File askai-setup.ps1
```

It installs, under that machine's own user profile:

- `~/.claude/hooks/askai.ps1` — the hook script
- `~/.claude/commands/askai.md` — the `/askai` slash command
- Merges into `~/.claude/settings.json` (creates it if missing, preserves
  anything already there):
  - hook registrations for `UserPromptSubmit`, `PostToolUse`, `PreCompact`
    (`PostToolUse` is scoped with a `matcher` to `Bash|Read|Grep|Agent|Task`
    only, to skip the process-spawn cost on cheap tools like Edit/Write;
    re-running the installer upgrades an older registration that lacks
    this matcher, or one still on the older `Task`-only tool name)
  - `autoCompactEnabled: true`, `autoCompactWindow: 150000`
  - `skillOverrides` trimming 11 skills unrelated to code/book-writing work
    to name-only (only adds ones not already set — never overrides a choice
    you've made for a specific skill)

Safe to re-run any time — it won't duplicate hooks or clobber unrelated
settings. Tested against: a fresh machine with no settings.json, re-running
on top of itself, running alongside pre-existing unrelated settings, and
running after you've manually customized one of the skillOverrides values.

## 3. Restart Claude Code

Or open `/hooks` once — either reloads the config so the new hooks actually
start firing. This one manual step can't be automated.

## 4. Per-project setup (do this inside each project you want askai active in)

This part isn't installed automatically — it's a judgment call per project,
not global infrastructure:

1. `.claude/askai/interval.txt` — a number 2-50 (checkpoint every N prompts;
   omit this file to just use the default of 5; heavier coding projects
   tend to want a higher number, e.g. 8, so hard-clears don't fire mid-task)
2. `.claude/askai/volume-threshold.txt` — optional, a character count
   (default 80000 if omitted; checkpoint fires early once accumulated tool
   output crosses this since the last checkpoint)
3. `.claude/settings.json` — optionally add:
   ```json
   { "bashOutputMaxChars": 15000, "taskOutputMaxChars": 15000, "effortLevel": "medium" }
   ```
4. `CLAUDE.md` — optionally note conventions like delegating broad
   multi-file exploration to the Explore subagent
5. If you want continuity from the old laptop's work to carry over, copy
   that project's `.claude/askai/` folder by hand (skip the `sessions/`
   subfolder — that's per-session counters/pointers, not memory)

## What this does day to day

- `/askai <task>` always confirms scope (area / extra items / answer length /
  effort level) before doing anything, with defaults pre-filled — or, for
  skill-authoring tasks (creating/editing a Claude skill itself), hands off
  straight to the `skill-creator` skill instead.
- Every prompt in every project gets the same scoping check automatically
  for new tasks — quietly, no interruption for follow-ups or short replies.
- Every N prompts (or a wrap-up phrase like "done for today", or a burst of
  tool output), Claude asks which feature the work belongs to, files a
  summary to disk, and clears the session — but only once you've confirmed
  it's a good stopping point, never mid-task.
- If tool-output volume alone crosses the threshold mid-turn, the checkpoint
  fires that same turn instead of waiting for your next prompt. If a clear
  is already pending when that happens again, it just files a silent note
  instead of asking, so nothing grows unbounded while a clear sits deferred.
- Tag a prompt with `#feature-slug` to switch context instantly; add
  `!noscope` to a throwaway prompt to skip all of the above for that one message.
