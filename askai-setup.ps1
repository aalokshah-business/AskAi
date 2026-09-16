<#
Portable installer for the "askai" token-optimization hook system (Claude Code / Desktop app).

Installs, under the CURRENT user's home directory (works regardless of Windows username):
  - ~/.claude/hooks/askai.ps1        the unified hook script (UserPromptSubmit + PostToolUse + PreCompact)
  - ~/.claude/commands/askai.md      the /askai slash command
  - merges hook registrations + autoCompactEnabled/autoCompactWindow into ~/.claude/settings.json
    (existing content is preserved; safe to re-run -- it will not duplicate entries)

NOT installed by this script (these are per-project, not global infrastructure):
  - .claude/askai/interval.txt, volume-threshold.txt (checkpoint tuning for a specific project)
  - .claude/settings.json's bashOutputMaxChars / taskOutputMaxChars / effortLevel
  - CLAUDE.md conventions (e.g. delegate exploration to the Explore subagent)
  - the accumulated .claude/askai/*.md feature-summary content itself (that's project work
    history, not infrastructure -- copy the project's .claude/askai folder by hand if you want
    that continuity to carry over too)
  See the "PER-PROJECT SETUP" comment block at the bottom of this file for those steps.

Usage: copy this file to the new laptop and run it (PowerShell 5.1+, Windows):
  powershell -ExecutionPolicy Bypass -File askai-setup.ps1
#>

$ErrorActionPreference = 'Stop'

$homeDir      = $env:USERPROFILE
$hooksDir     = Join-Path $homeDir '.claude\hooks'
$commandsDir  = Join-Path $homeDir '.claude\commands'
$settingsPath = Join-Path $homeDir '.claude\settings.json'

New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
New-Item -ItemType Directory -Path $commandsDir -Force | Out-Null

# ============================================================================
# 1. askai.ps1 -- the hook script (no machine-specific paths inside it)
# ============================================================================
$askaiPs1Content = @'
param([string]$Event = '')

$ErrorActionPreference = 'Stop'

function Read-IntFile([string]$path, [int]$default, [int]$min, [int]$max) {
    if (-not (Test-Path $path)) { return $default }
    $raw = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if (-not $raw) { return $default }
    $parsed = 0
    if ([int]::TryParse($raw.Trim(), [ref]$parsed) -and $parsed -ge $min -and $parsed -le $max) { return $parsed }
    return $default
}

function Emit-Context([string]$eventName, [string]$context) {
    $output = [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName     = $eventName
            additionalContext = $context
        }
    }
    Write-Output ($output | ConvertTo-Json -Depth 6 -Compress)
}

try {
    $stdin = [Console]::In.ReadToEnd()
    $data = $null
    if ($stdin) { $data = $stdin | ConvertFrom-Json }

    if (-not $Event -and $data -and $data.hook_event_name) { $Event = [string]$data.hook_event_name }
    if (-not $Event) {
        if ($data.tool_response) { $Event = 'PostToolUse' }
        elseif ($data.trigger)   { $Event = 'PreCompact' }
        else                     { $Event = 'UserPromptSubmit' }
    }

    $cwd = $null
    if ($data -and $data.cwd) { $cwd = $data.cwd }
    if (-not $cwd) { $cwd = (Get-Location).Path }

    $sessionId = 'unknown-session'
    if ($data -and $data.session_id) { $sessionId = [string]$data.session_id }
    $safeSessionId = ($sessionId -replace '[^a-zA-Z0-9_-]', '_')

    $claudeDir   = Join-Path $cwd '.claude'
    $askaiDir    = Join-Path $claudeDir 'askai'
    $sessionsDir = Join-Path $askaiDir 'sessions'
    if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }

    # per-session state -- concurrent sessions in the same project never clobber each other
    $counterFile        = Join-Path $sessionsDir "$safeSessionId.counter.txt"
    $currentFeatureFile = Join-Path $sessionsDir "$safeSessionId.current-feature.txt"
    $bytesFile          = Join-Path $sessionsDir "$safeSessionId.bytes.txt"
    $pendingClearFile   = Join-Path $sessionsDir "$safeSessionId.pending-clear.txt"
    # project-wide config/registry
    $featuresFile        = Join-Path $askaiDir 'features.json'
    $intervalFile        = Join-Path $askaiDir 'interval.txt'
    $volumeThresholdFile = Join-Path $askaiDir 'volume-threshold.txt'

    $features = $null
    if (Test-Path $featuresFile) {
        try { $features = Get-Content $featuresFile -Raw | ConvertFrom-Json } catch {}
    }

    $currentSlug = $null
    if (Test-Path $currentFeatureFile) {
        $currentSlug = (Get-Content $currentFeatureFile -Raw -ErrorAction SilentlyContinue)
        if ($currentSlug) { $currentSlug = $currentSlug.Trim() }
    }

    # ================= PostToolUse: accumulate tool-output volume =================
    if ($Event -eq 'PostToolUse') {
        $responseLength = 0
        if ($data.tool_response) {
            try { $responseLength = ($data.tool_response | ConvertTo-Json -Depth 10 -Compress).Length }
            catch { $responseLength = ([string]$data.tool_response).Length }
        }
        $current = Read-IntFile $bytesFile 0 0 2147483647
        Set-Content -Path $bytesFile -Value ($current + $responseLength) -NoNewline -Encoding utf8
        exit 0
    }

    # ================= PreCompact: low-friction safety-net note =================
    if ($Event -eq 'PreCompact') {
        $slug = if ($currentSlug) { $currentSlug } else { 'general' }
        $targetFile = "askai/$slug.md"
        if ($features -and $slug -ne 'general') {
            $entry = $features.features | Where-Object { $_.slug -eq $slug } | Select-Object -First 1
            if ($entry) { $targetFile = $entry.file }
        }
        $targetPath = Join-Path $claudeDir $targetFile
        $note = "Context is about to be compacted (real context size threshold, not a fixed prompt count). Before anything else this turn, silently append 2-4 bullet points capturing the most important recent progress/state to '$targetPath' under a new '## Pre-compact note <UTC timestamp>' heading (create the file with a top-level '# $slug -- Checkpoint Summary' heading first if it doesn't exist). Keep it brief -- this is a safety net so nothing important is lost to compaction, not a full checkpoint. Do not ask the user anything and do not call clear_session for this -- just write the note and continue normally."
        Emit-Context 'PreCompact' $note
        exit 0
    }

    # ================= UserPromptSubmit: scoping + feature context + checkpoint =================
    $prompt = ''
    if ($data -and $data.prompt) { $prompt = [string]$data.prompt }
    $trimmed = $prompt.Trim()

    $interval        = Read-IntFile $intervalFile 5 2 50
    $volumeThreshold = Read-IntFile $volumeThresholdFile 80000 10000 2000000

    # '!noscope' -- opt this one prompt out of counting, checkpointing and scoping questions
    $noscope = $trimmed -imatch '!noscope'

    # cheap trivial-reply filter (skips the scoping reminder only)
    $isTrivial = $noscope -or ($trimmed.Length -le 3) -or
        ($trimmed -imatch '^(ok|okay|k|thanks|thank you|thx|yes|no|yep|nope|sure|got it|great|good|nice|cool|continue|go ahead|proceed|sounds good|looks good|lgtm)[.!]*$')

    $count = Read-IntFile $counterFile 0 0 2147483647
    if (-not $noscope) {
        $count = $count + 1
        Set-Content -Path $counterFile -Value $count -NoNewline -Encoding utf8
    }

    $contextParts = New-Object System.Collections.Generic.List[string]

    # --- '#slug' tag anywhere in the prompt switches THIS session's active feature immediately ---
    $taggedSlug = $null
    if ($features -and $features.features -and $prompt) {
        foreach ($m in [regex]::Matches($prompt, '#([a-zA-Z0-9_-]+)')) {
            $candidate = $m.Groups[1].Value
            $hit = $features.features | Where-Object { $_.slug -ieq $candidate } | Select-Object -First 1
            if ($hit) { $taggedSlug = $hit.slug; break }
        }
    }
    if ($taggedSlug -and $taggedSlug -ne $currentSlug) {
        $currentSlug = $taggedSlug
        Set-Content -Path $currentFeatureFile -Value $currentSlug -NoNewline -Encoding utf8
        $contextParts.Add("Prompt tag '#$currentSlug' matched a tracked feature -- switched this session's active feature to it immediately (no need to wait for the next checkpoint).")
    }

    # --- inject only THIS SESSION's current feature summary, or a cheap index if none is set yet ---
    if ($currentSlug -and $features) {
        $entry = $features.features | Where-Object { $_.slug -eq $currentSlug } | Select-Object -First 1
        if ($entry) {
            $summaryPath = Join-Path $claudeDir $entry.file
            if (Test-Path $summaryPath) {
                $summary = Get-Content $summaryPath -Raw -ErrorAction SilentlyContinue
                if ($summary -and $summary.Trim().Length -gt 0) {
                    $contextParts.Add("Feature checkpoint summary -- '$($entry.name)' ($($entry.file)), for continuity across session clears:`n" + $summary)
                }
            }
        }
    } elseif (-not $currentSlug -and $features -and $features.features -and $features.features.Count -gt 0) {
        $lines = $features.features | ForEach-Object { "- $($_.slug): $($_.name) -- $($_.file)" }
        $contextParts.Add("This project has tracked feature summaries from earlier sessions (no checkpoint has run yet in THIS session, so nothing is auto-loaded). If the user's prompt below is about one of these, read the matching file yourself right away rather than waiting for the next checkpoint (or tag your prompt with e.g. '#$($features.features[0].slug)' to switch instantly):`n" + [string]::Join("`n", $lines))
    }

    # --- scoping reminder ---
    if (-not $isTrivial) {
        $contextParts.Add("Token-efficient scoping reminder (applies to every project): first judge whether this prompt is a NEW, DISTINCT task/request, or an obvious follow-up/continuation/short reply within the current conversation. " +
            "If it's clearly a follow-up or continuation, proceed normally -- do not ask anything extra. " +
            "If it's a new, distinct task, BEFORE doing any exploration, confirm three things via one AskUserQuestion call, pre-filling your best guess as the recommended option in each: " +
            "(1) Area -- the specific file(s)/directory/topic this task is scoped to (offer your best guess, or 'no specific area -- general question' if none applies); stay inside the confirmed scope, don't explore beyond it unless truly necessary. " +
            "(2) Additional items -- anything extra to pull in beyond the area (default option: 'none'). " +
            "(3) Answer length -- max characters for the final reply (default option: '500 characters'); keep the answer at or under the confirmed budget, cutting explanation before the direct answer. " +
            "Skip asking only if the user's request already explicitly states all three itself -- then just state what you're using in one line instead.")
    }

    # --- pending-clear: a prior checkpoint was filed but the actual clear was never confirmed done ---
    $pendingClear = (Test-Path $pendingClearFile) -and ((Get-Content $pendingClearFile -Raw -ErrorAction SilentlyContinue).Trim() -eq '1')

    if ($pendingClear -and -not $noscope) {
        $contextParts.Add("Reminder: a checkpoint from an earlier prompt in this session filed its summary but the clear_session('self') call was never confirmed done (file: '$pendingClearFile'). Decide again this turn, explicitly: (a) if now is a reasonable stopping point, after answering, call clear_session('self') as your last action and then write '0' to '$pendingClearFile'; (b) otherwise, tell the user in one short line that you're still holding the pending clear and why -- do not just silently drop it again.")
    }

    # --- checkpoint decision: interval count, an explicit wrap-up phrase, or accumulated tool-output volume ---
    $isWrapUp = $trimmed -imatch "(done for (today|now|the day)|that's (all|it) for (now|today)|stopping here|wrapping up|calling it a day)"
    $bytesSinceCheckpoint = Read-IntFile $bytesFile 0 0 2147483647
    $isVolumeTrigger = $bytesSinceCheckpoint -ge $volumeThreshold
    $shouldCheckpoint = (-not $noscope) -and (-not $pendingClear) -and (($count % $interval -eq 0) -or $isWrapUp -or $isVolumeTrigger)

    if ($shouldCheckpoint) {
        $reason = "prompt #$count reached the every-$interval checkpoint"
        if ($isWrapUp) { $reason = "you said something that sounds like wrapping up for now" }
        elseif ($isVolumeTrigger) { $reason = "this session has accumulated roughly $bytesSinceCheckpoint characters of tool output since the last checkpoint (threshold: $volumeThreshold)" }

        $contextParts.Add("Checkpoint triggered ($reason). After fully answering the user's actual request below, do these closing steps in the same turn: " +
            "(1) Read '$featuresFile' if it exists (it may not yet, on an early checkpoint) -- it holds {`"features`":[{`"slug`",`"name`",`"file`":`"askai/<slug>.md`"}]} (a project-wide registry, shared by all sessions). " +
            "(2) Based on roughly the recent exchanges, judge which existing feature(s) this work belongs to, or whether it's project-general, or whether it looks like a new feature not yet tracked. " +
            "(3) Confirm with the user via AskUserQuestion: offer your best-guess existing feature(s) as options (if any matched), plus a 'General / project-wide' option -- the user can pick 'Other' to type a new feature name, and you can set multiSelect if more than one plausibly applies. " +
            "(4) For each confirmed feature: if new, choose a short kebab-case slug, add {slug, name, file: 'askai/<slug>.md'} to features.json's features array (create features.json with an empty features array first if it doesn't exist), and create the feature's md file under '$askaiDir' with a top-level '# <Feature Name> -- Checkpoint Summary' heading if it doesn't exist yet. If 'General / project-wide' was chosen, use slug 'general' and file 'askai/general.md'. Append a short bullet-point summary of the relevant exchanges under a new '## Checkpoint <UTC timestamp>' heading in each confirmed feature's file. " +
            "(5) Write the confirmed feature's slug to '$currentFeatureFile' (create the file if needed; this is THIS session's own pointer, other concurrent sessions are unaffected) -- if more than one feature was confirmed, pick the most central one to write there. " +
            "(6) Write '1' to '$pendingClearFile' right after the summary file write succeeds -- this marks the clear as owed until it's actually confirmed done. " +
            "(7) Tell the user in one short line which feature(s) the checkpoint was filed under. " +
            "(8) Then decide explicitly, out loud to the user: if now is a reasonable stopping point, call clear_session('self') as your last tool call this turn (it will still ask the user to approve) and then write '0' to '$pendingClearFile'. If the user is clearly mid-task, it is fine to hold the clear -- but say so explicitly ('holding the clear for now since you're still working') rather than silently doing nothing; the pending-clear reminder will resurface on your next reply either way, so it is never silently forgotten.")

        # optimistic reset -- a checkpoint is about to consolidate things
        Set-Content -Path $bytesFile -Value '0' -NoNewline -Encoding utf8
    }

    if ($contextParts.Count -gt 0) {
        Emit-Context 'UserPromptSubmit' ([string]::Join("`n`n", $contextParts))
    }

    exit 0
} catch {
    exit 0
}
'@
Set-Content -Path (Join-Path $hooksDir 'askai.ps1') -Value $askaiPs1Content -Encoding utf8
Write-Host "Installed: $hooksDir\askai.ps1"

# ============================================================================
# 2. askai.md -- the /askai slash command
# ============================================================================
$askaiMdContent = @'
---
description: Token-efficient task runner — scopes area, extra context, and caps answer length
argument-hint: <task description>
---

Handle this task in token-efficient mode. Before doing any exploration, always confirm three things with the user via one AskUserQuestion call — even when they're inferable or a default would obviously apply. Pre-fill each question's options with your best guess (including the relevant default) so confirming is one click, but still ask:

1. **Area** — the specific file(s), directory, or topic this task is scoped to (offer your best guess as an option, e.g. inferred from the task text or "no specific area — general question"). Stay inside the confirmed scope; do not explore the wider codebase/project unless answering truly requires it.
2. **Additional items** — anything extra to pull into scope beyond the area (e.g. "also the tests", "and the config file"). Offer "none" as the default option.
3. **Answer length** — max characters for your final reply. Offer "500 characters (default)" plus a couple of other sizes as options.

Only skip the question entirely if the user's request already explicitly pins down all three (e.g. they named the file, said what else to include, and gave a character limit) — in that case state what you're using in one line instead.

Then do the task:
- Read/search only within area + additional items — no broader exploration.
- Keep the final answer at or under the character budget. If something has to give, cut explanation before cutting the direct answer.

Task: $ARGUMENTS
'@
Set-Content -Path (Join-Path $commandsDir 'askai.md') -Value $askaiMdContent -Encoding utf8
Write-Host "Installed: $commandsDir\askai.md"

# ============================================================================
# 3. merge hook registrations + autoCompact tuning into settings.json
# ============================================================================
$hookScriptPath = Join-Path $hooksDir 'askai.ps1'

function New-HookGroup([string]$eventName) {
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$hookScriptPath`" -Event $eventName"
    return [pscustomobject]@{
        hooks = @(
            [pscustomobject]@{
                type          = 'command'
                command       = $cmd
                timeout       = if ($eventName -eq 'PreCompact') { 20 } elseif ($eventName -eq 'PostToolUse') { 10 } else { 15 }
                statusMessage = 'askai'
            }
        )
    }
}

function Test-HasAskaiHook($eventArray, [string]$eventName) {
    if (-not $eventArray) { return $false }
    foreach ($group in $eventArray) {
        foreach ($h in $group.hooks) {
            if ($h.command -and $h.command -like "*askai.ps1*-Event $eventName*") { return $true }
        }
    }
    return $false
}

$settings = $null
if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw
    if ($raw.Trim()) { $settings = $raw | ConvertFrom-Json }
}
if (-not $settings) { $settings = [pscustomobject]@{} }

if (-not ($settings.PSObject.Properties.Name -contains 'hooks')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'hooks' -Value ([pscustomobject]@{})
}

foreach ($eventName in @('UserPromptSubmit', 'PostToolUse', 'PreCompact')) {
    if (-not ($settings.hooks.PSObject.Properties.Name -contains $eventName)) {
        $settings.hooks | Add-Member -MemberType NoteProperty -Name $eventName -Value @()
    }
    $existing = @($settings.hooks.$eventName)
    if (-not (Test-HasAskaiHook $existing $eventName)) {
        $settings.hooks.$eventName = $existing + (New-HookGroup $eventName)
        Write-Host "Registered $eventName hook"
    } else {
        Write-Host "$eventName hook already present -- left as-is"
    }
}

if (-not ($settings.PSObject.Properties.Name -contains 'autoCompactEnabled')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'autoCompactEnabled' -Value $true
    Write-Host "Set autoCompactEnabled = true"
}
if (-not ($settings.PSObject.Properties.Name -contains 'autoCompactWindow')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'autoCompactWindow' -Value 150000
    Write-Host "Set autoCompactWindow = 150000"
}

$settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsPath -Encoding utf8
Write-Host "Merged into: $settingsPath"

Write-Host ""
Write-Host "Done. Restart Claude Code (or open /hooks once) for the new hooks to take effect."
Write-Host "See the PER-PROJECT SETUP comment block at the top of this script for what to add per-project."

<#
PER-PROJECT SETUP (do this separately, inside each project you want it active in):

1. Create .claude/askai/interval.txt in the project root containing a number 2-50
   (how many prompts between checkpoints; 5 is the hook's own default if this file
   is absent, so you only need this file to override it -- e.g. write "8" for a
   heavy coding project).

2. Optionally create .claude/askai/volume-threshold.txt containing a character count
   (default 80000 if absent) -- checkpoint fires early if accumulated tool output
   crosses this since the last checkpoint, regardless of prompt count.

3. Optionally add to that project's .claude/settings.json:
     { "bashOutputMaxChars": 15000, "taskOutputMaxChars": 15000, "effortLevel": "medium" }
   (trims verbose command/test output and drops reasoning effort for routine work;
   tune to taste -- these are project-specific judgment calls, not required.)

4. Optionally add a CLAUDE.md note like:
     "For broad, multi-file exploration, delegate to the Explore subagent instead of
     reading files directly in the main thread."

5. The .claude/askai/<slug>.md and features.json files ARE the actual accumulated
   project memory (not infrastructure) -- if you want continuity from this laptop's
   work to carry over, copy that project's .claude/askai folder by hand (skip the
   sessions/ subfolder -- that's per-session counters/pointers, not memory).
#>
