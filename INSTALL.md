# Installing askai on a new laptop

One file, one command. No manual path editing — the installer figures out
the new machine's username itself.

The default install is **lean: it registers no hooks**. The 7-day
`/askai-report 168` ledger measured the hook system as net negative on tokens
(cost 26.38M units vs 248.6K computed savings, NET -26.14M, -2.60% of spend), so
the installer keeps only the settings and `CLAUDE.md` rules that cost nothing per
turn. The old hook system is still available with `-WithHooks`.

## 1. Copy this file to the new laptop

- `askai-setup.ps1` — the installer (run this)
- `README.md` — optional, background reading

(`hooks/askai.ps1`, `commands/askai.md` and the `askai-report` files are also in
this folder for reference/version control, but you don't need to copy them
separately — the installer has the hook and command content built in, and only
uses it with `-WithHooks`.)

## 2. Run it

Open PowerShell on the new laptop and run:

```powershell
powershell -ExecutionPolicy Bypass -File askai-setup.ps1
```

It installs, under that machine's own user profile:

- `~/.claude/CLAUDE.md` — appends the caveman terse-output directive once
  (skipped if a `# Terse output (caveman` block is already there; it is never
  rewritten, so edit the file by hand to change its level)
- Merges into `~/.claude/settings.json` (creates it if missing, preserves
  anything already there):
  - `autoCompactEnabled: true`, `autoCompactWindow: 150000`
  - `env.CLAUDE_CODE_SUBAGENT_MODEL: sonnet` (only if unset; a per-call `model` still wins)
  - `skillOverrides` setting rarely used bundled skills to name-only (plugin skills
    such as `anthropic-skills:*` ignore it; manage those with `/plugin`; only adds ones not already set — never overrides a choice
    you've made for a specific skill)
  - removes askai hook registrations an earlier install left behind (hooks from
    other tools stay; nothing is registered in their place)
- The third-party caveman skill and CLI, through `npx`/`npm` (needs Node.js; a
  failure only warns)

Options:

- `-CavemanMode lite|full|ultra` — level of the `CLAUDE.md` directive (default `full`)
- `-CavemanMode off`, or `-SkipCaveman` on its own — write no directive (`-SkipCaveman` also skips the caveman skill)
- `-SkipCavemanProxy` — skip the `caveman` CLI install
- `-WithHooks` — legacy install, below

Safe to re-run any time — it won't duplicate entries or clobber unrelated
settings. Tested against: a fresh machine with no settings.json, re-running
on top of itself, running alongside pre-existing unrelated settings, running over
an earlier hook install that also had another tool's hooks, and running after you've
manually customized one of the skillOverrides values.

### Legacy hook install (`-WithHooks`, opt-in)

```powershell
powershell -ExecutionPolicy Bypass -File askai-setup.ps1 -WithHooks
```

On top of the settings merge this also installs:

- `~/.claude/hooks/askai.ps1` — the hook script
- `~/.claude/commands/askai.md` — the `/askai` slash command
- `~/.claude/hooks/askai-report.js` + `~/.claude/commands/askai-report.md` —
  the `/askai-report [hours]` token savings report (needs Node.js when run)
- hook registrations for `UserPromptSubmit`, `PreToolUse`, `PreCompact`
  (`PreToolUse` is scoped with a `matcher` to `Agent|Task` only, so only
  subagent launches pay the process-spawn cost; the old `PostToolUse`
  registration is retired and re-running the installer removes it)
- `~/.claude/askai-caveman.txt` — caveman level for the hook, which injects it
  instead of `CLAUDE.md` (so `CLAUDE.md` is left alone in this mode)

Use it only if you want to re-measure the hooks; the ledger says they lose tokens.

## 3. Start a new session

Settings, `env` and `CLAUDE.md` are read once at session start, so a session
that is already open keeps its old config. Open a new one; no `/hooks` step is
needed for the lean install. (With `-WithHooks`, restart Claude Code or open
`/hooks` once so the new hooks start firing.)

## 4. Per-project setup (do this inside each project you want tuned)

This part isn't installed automatically — it's a judgment call per project,
not global infrastructure:

1. `.claude/settings.json` — optionally add:
   ```json
   { "bashOutputMaxChars": 15000, "effortLevel": "medium" }
   ```
2. `CLAUDE.md` — optionally note conventions like delegating broad
   multi-file exploration to the Explore subagent on haiku, and giving every
   Agent prompt a tool-call limit and a reply-size limit (subagents were ~70% of
   spend; the legacy `PreToolUse` guard used to enforce this)
3. `-WithHooks` only: `.claude/askai/interval.txt` — a number 2-50 (checkpoint
   every N prompts; omit this file to just use the default of 5; heavier coding
   projects tend to want a higher number, e.g. 8, so hard-clears don't fire
   mid-task)
4. `-WithHooks` only: `.claude/askai/context-guard.txt` — optional, a token
   count 20000-2000000 (default 120000 if omitted; past it the hook nudges you
   to start a fresh session, again every +40K)
5. `-WithHooks` only: if you want continuity from the old laptop's work to carry
   over, copy that project's `.claude/askai/` folder by hand (skip the
   `sessions/` subfolder — that's per-session counters/pointers, not memory)

## What this does day to day

Lean install (default):

- Replies are terse (caveman directive in `CLAUDE.md`), until you say "stop caveman" or "normal mode".
- Subagents default to sonnet unless a call names a model.
- Auto-compact fires at 150K tokens of context.
- About 20 rarely used bundled skills show only their name in context, not their description.
- Nothing runs per prompt, and nothing is injected into your prompts.

With `-WithHooks` (legacy):

- `/askai <task>` states scope (area / extra items / answer length) in one
  line before doing anything, with defaults, no question asked — or, for
  skill-authoring tasks (creating/editing a Claude skill itself), hands off
  straight to the `skill-creator` skill instead.
- Every prompt in every project gets the same scoping rule automatically
  for new tasks — quietly, no interruption for follow-ups or short replies.
- Every N prompts (or a wrap-up phrase like "done for today"), Claude
  silently picks the feature the work belongs to and files a summary to disk
  with one tool call. It only tries to clear the session when you say
  you're wrapping up (and you still approve the clear).
- An Agent launch without a tool-call limit and a reply-size limit is denied
  once (subagents were ~70% of spend); resend unchanged or add `!nolimit` to
  pass.
- Mentioning Claude Docs or visualize/mockups makes Claude enable that
  connector for the session and switch it back off on your next message.
- Tag a prompt with `#feature-slug` to switch context instantly; add
  `!noscope` to a throwaway prompt to skip all of the above for that one message.
