# askai — token-optimization setup for Claude Code

**Status: lean by default.** The 7-day `/askai-report 168` ledger measured the askai hook
system as net negative on tokens: it cost 26.38M units against 248.6K computed savings
(NET -26.14M, -2.60% of the 940.15M spent; subagents were 69.2% of spend). So
`askai-setup.ps1` now installs **no hooks** unless you pass `-WithHooks`. It keeps only the
levers that cost nothing per turn: a caveman directive in `~/.claude/CLAUDE.md`, sonnet
subagents, `autoCompactWindow` and `skillOverrides`. The hook system is still in this repo
as an opt-in legacy install (see "Legacy hook system" below).

## What `askai-setup.ps1` installs

Default (lean, no hooks), under the current user's `~/.claude/`:

- `CLAUDE.md` — appends the caveman terse-output directive once (skipped if a `# Terse output (caveman` heading is already there).
- `settings.json` — merges `autoCompactEnabled: true`, `autoCompactWindow: 150000`, `env.CLAUDE_CODE_SUBAGENT_MODEL: sonnet` (only if unset; a per-call `model` still wins) and `skillOverrides` (rarely used bundled skills set to `name-only`; only adds ones not already set). Existing content and values are never overridden.
- Removes askai hook registrations that an earlier install left in `settings.json`; other tools' hooks stay.
- Installs the third-party caveman skill and CLI (see below).

Settings, `env` and `CLAUDE.md` are read at session start, so **start a new session** after running it. Sessions already open keep their old config.

`-WithHooks` (legacy, opt-in): additionally copies `hooks/askai.ps1`, `commands/askai.md`, `hooks/askai-report.js` and `commands/askai-report.md` into `~/.claude/`, registers the `UserPromptSubmit` / `PreToolUse` / `PreCompact` hooks, and writes `~/.claude/askai-caveman.txt` (the hook injects caveman, so `CLAUDE.md` is left alone). Use it only to re-measure.

## Contents

- `askai-setup.ps1` — portable installer (safe to re-run, won't duplicate entries or touch unrelated settings). It embeds its own copy of the legacy hook and command files.
- `hooks/askai.ps1` — the legacy unified hook script (UserPromptSubmit + PreToolUse + PreCompact); only installed with `-WithHooks`
- `commands/askai.md` — the legacy `/askai` slash command; only installed with `-WithHooks`
- `hooks/askai-report.js` + `commands/askai-report.md` — evidence report (`/askai-report [hours]`, or `node hooks/askai-report.js --hours 168 [--json]`); needs Node.js at run time. The installer copies them only with `-WithHooks`, but the script reads `~/.claude/projects/**/*.jsonl` and runs fine straight from this repo.

## Updating a deployed machine after editing this repo

```
powershell -ExecutionPolicy Bypass -File askai-setup.ps1 [-WithHooks] [-SkipCaveman] [-SkipCavemanProxy] [-CavemanMode off|lite|full|ultra]
```

### Caveman (third-party, installed by default)

`askai-setup.ps1` also installs [caveman](https://github.com/JuliusBrussee/caveman) after the settings merge:

- **Skill:** `npx skills add JuliusBrussee/caveman -g -a claude-code -s caveman caveman-commit caveman-compress caveman-review caveman-stats -y --copy`. Only these 5 of the repo's ~20 skills are installed; every installed skill adds its description to each turn's context. Use `/caveman` to toggle terse output.
- **CLI:** `npm install -g @caveman-ai/cli && caveman setup --install` (installs the companion binaries into `~/.caveman/bin`; needs Node 22.13+). In testing this did not modify `~/.claude/settings.json`.
- Skip either with `-SkipCaveman` / `-SkipCavemanProxy`. Failures only warn; needs Node/npm on PATH.
- The four secondary skills (`caveman-commit/-compress/-review/-stats`) are set to `name-only` in `skillOverrides`, so only `/caveman` itself carries a description in context.

### Caveman terse mode (always-on, no skill call needed)

The `/caveman` skill only takes effect once you invoke it, so the installer also makes terse output the default:

- **Lean default:** the directive is plain text in `~/.claude/CLAUDE.md` (~700 chars: drop filler/articles/hedging, no tool-call narration; code, commands, errors, numbers and negations stay exact; commit/PR text, code comments and file contents stay normal; security warnings and destructive-action confirmations stay in full sentences). It is loaded once at session start, with no hook and no per-prompt injection.
- Level: `-CavemanMode lite|full|ultra` (default `full`). `-CavemanMode off`, or `-SkipCaveman` on its own, writes none. An existing `# Terse output (caveman` block is never rewritten: edit `CLAUDE.md` by hand to change its level.
- Say "stop caveman" or "normal mode" to end it for the session, or `/caveman` for the skill's own levels.
- It only shortens the assistant's prose, not tool output. For that, the `caveman` CLI proxy above is the separate lever (not wired to Claude hooks here).
- **With `-WithHooks`:** the hook injects the directive once per session instead (`PreCompact` re-arms it; a `clear_session` starts a new session id, which re-injects it). The level lives in `~/.claude/askai-caveman.txt` (`-CavemanMode ultra` writes it; an existing file is kept otherwise, and `-SkipCaveman` defaults it to `off`). Per-project override: `<project>/.claude/askai/caveman.txt`.

## Legacy hook system (`-WithHooks` only)

Measured net negative in the ledger above. Kept for re-measuring and as reference. The subagent limit rule that its `PreToolUse` guard enforced belongs in `CLAUDE.md` instead (state a tool-call limit and a reply-size limit in every Agent prompt).

### What the hook does

- `UserPromptSubmit` — scoping rule for new/distinct tasks (state area,
  additional items, answer length in one line; no question is asked), injects
  the session's tracked feature summary, `#slug` tagging, and the checkpoint
  trigger (every N prompts or a wrap-up phrase). Checkpoints are filed
  silently -- no AskUserQuestion -- with ONE tool call (the hook appends the
  metrics row itself), and `clear_session` is only attempted when you say you
  are wrapping up.
  - **Context guard**: reads the real context size from the transcript's last
    usage block; past 120K tokens (`askai/context-guard.txt` overrides, 20K-2M)
    it nudges once per +40K to start a fresh session and delegate searches to
    Explore-on-haiku.
  - **Connector manager**: a prompt that mentions Claude Docs or
    visualize/mockup/interactive widgets gets a hint to enable that connector for
    the session (`set_session_connector_enabled`), and the next prompt gets a hint
    to switch it back off. Short replies never trigger it. (A hook cannot toggle
    connectors itself; it only tells the model to.)
- `PreToolUse` (`matcher: Agent|Task`) — subagent budget guard. Subagents were
  ~70% of measured spend, so an Agent launch whose prompt lacks a tool-call limit
  or a reply-size limit is denied once with the reason; an identical resend, or a
  prompt containing `!nolimit`, passes. No other tool pays a hook spawn.
- `PreCompact` — writes a brief safety-net note before context compaction and
  re-arms the once-per-session injections.

### `/askai <task>`

States three assumptions in one line before touching anything: area, extra
scope, and answer length (asks only if the task is genuinely ambiguous). Tasks
about creating/editing a Claude skill itself are routed to the
`skill-creator` skill instead of this scoping flow.

### Token-cost design: send once, not every prompt

Hook context persists in message history and is re-sent on every later turn, so anything injected per prompt compounds. The hook therefore:

- Sends the **feature summary once per session** (again after PreCompact, or when a `#slug` tag switches feature), capped to the most recent 6000 chars (override: `.claude/askai/summary-max-chars.txt`, 1000-200000) with a pointer to the full file. Previously a 40 KB summary was re-injected on every prompt.
- Sends the **full scoping rule and checkpoint steps once per session**; later prompts get nothing (scoping) or a ~200 char pointer (checkpoint). The pending-clear reminders, the volume-note and the PostToolUse volume tracker were removed (v2): they re-injected text every prompt or spawned PowerShell per tool call for little value. State lives in `sessions/<sid>.seen.txt` / `.summary.txt`, both cleared on PreCompact.
- Resolves one **project root** (nearest `.git`, else nearest existing `.claude/askai`, else cwd) so sessions started in subdirectories no longer create stray `.claude/askai/` folders.

Even with all of that, the 7-day ledger still came out net negative, which is why it is no longer the default.

Note: `askai-setup.ps1` embeds its own copy of `askai.ps1`/`askai.md`
content rather than reading `hooks/`/`commands/` at run time — if you edit the
scripts here, regenerate the installer's embedded copies to match (or just
copy `hooks/askai.ps1` and `commands/askai.md` directly to `~/.claude/hooks/`
and `~/.claude/commands/`, which is simpler for a single-machine update).

## Evidence report and A/B test

`askai-report.js` reads Claude Code transcripts (`~/.claude/projects/**/*.jsonl`, including subagents) and opens with a **token savings ledger**: tokens saved per feature (caveman, answer-length budget, scoping, feature summaries, skill name-only overrides, checkpoint + clear, compaction), askai's own cost, and NET. Each row is labelled MEASURED (A/B arms), COMPUTED (config arithmetic), OBSERVED (on/off comparison, correlation only) or unmeasurable (0 credited). `--hours 168` / `--hours 720` give a 7- or 30-day view. It then reports: where tokens went (main vs subagents), askai hook-injection overhead, scoping/answer-length compliance, trigger noise vs completed checkpoint cycles, caveman on/off comparison (observational only) and tool-output volume. Cost units are relative (input + 1.25*cache-create + 0.1*cache-read + 5*output), not billing.

Without a baseline, savings cannot be proven. To get one, put `on` in `<project>/.claude/askai/ab.txt` (or `~/.claude/askai-ab.txt`): each NEW session is randomly assigned `control` (no caveman directive, no scoping reminder) or `treatment` (normal askai), sticky in `sessions/<sid>.arm.txt`. Sessions already running are never assigned. Section 5 of the report compares cost/prompt between arms. Default is off; delete the file or set anything other than `on` to stop. The arms are assigned by the legacy hook, so they only exist with `-WithHooks`; with the lean install the "where tokens went" section is the useful part of the report.

## Per-project configuration (not in this repo)

Each project can carry its own tuning, checked into that project instead:
- `.claude/settings.json` (`bashOutputMaxChars`, `effortLevel`, `permissions.allow`)
- `CLAUDE.md` conventions (e.g. delegate broad multi-file exploration to the Explore subagent on haiku; give every Agent prompt a tool-call limit and a reply-size limit)
- Legacy, `-WithHooks` only: `.claude/askai/interval.txt`, `.claude/askai/context-guard.txt`
- Legacy, `-WithHooks` only: `.claude/askai/*.md` — accumulated feature summaries (project memory, not infrastructure)
- Legacy, `-WithHooks` only: `.claude/askai/metrics.jsonl` — append-only log of checkpoint/clear events (timestamp, session, feature slug, trigger, pre-clear tokens/percent used, and outcome: cleared/held/blocked/declined), appended by the hook itself when it fires a checkpoint (trigger, context tokens, outcome `held`); ask the agent to summarize it for a read on real token savings over time

See the full writeup for how the system works day to day.
