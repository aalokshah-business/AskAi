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

Also installed by default (third-party, needs Node.js/npm; each can be skipped):
  caveman skill  npx skills add JuliusBrussee/caveman -g   (the /caveman terse-output skill)
                 skip with -SkipCaveman
  caveman proxy  npm install -g @caveman-ai/cli && caveman setup --install
                 (installs the companion binaries into ~/.caveman/bin, needs Node 22.13+; in testing it did
                 not modify settings.json -- use `caveman setup --agent-native claude` yourself if you want more)
                 skip with -SkipCavemanProxy
  Both run AFTER the askai settings merge so the two don't clobber each other; a failure only warns.

The askai hook itself also applies caveman terse-output mode: a ~700-char directive injected ONCE per
session (not every prompt) and re-armed after a compaction. The level lives in ~/.claude/askai-caveman.txt
(off|lite|full|ultra, default full; per-project override: <project>/.claude/askai/caveman.txt).
  -CavemanMode <level>  writes that level (otherwise an existing file is kept; -SkipCaveman defaults it to off)

Usage: copy this file to the new laptop and run it (PowerShell 5.1+, Windows):
  powershell -ExecutionPolicy Bypass -File askai-setup.ps1 [-SkipCaveman] [-SkipCavemanProxy] [-CavemanMode off|lite|full|ultra]
#>

param(
    [switch]$SkipCaveman,
    [switch]$SkipCavemanProxy,
    [ValidateSet('off', 'lite', 'full', 'ultra')][string]$CavemanMode
)

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

# Hook context persists in message history and is re-sent every turn, so long instruction blocks go out ONCE per
# session (tracked in $seenFile, cleared on PreCompact) and later prompts get only a short pointer.
function Test-Seen([string]$file, [string]$key) {
    (Test-Path $file) -and (@(Get-Content $file -ErrorAction SilentlyContinue) -contains $key)
}
function Mark-Seen([string]$file, [string]$key) {
    Add-Content -Path $file -Value $key -Encoding ascii
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

    # resolve one stable project root so a session started in a subdirectory doesn't spawn a stray .claude\askai there:
    # nearest ancestor with .git, else nearest ancestor that already has .claude\askai, else cwd
    $projectRoot = $null
    foreach ($marker in @('.git', '.claude\askai')) {
        for ($d = $cwd; $d; $d = Split-Path $d -Parent -ErrorAction SilentlyContinue) {
            if (Test-Path (Join-Path $d $marker)) { $projectRoot = $d; break }
        }
        if ($projectRoot) { break }
    }
    if (-not $projectRoot) { $projectRoot = $cwd }

    $claudeDir   = Join-Path $projectRoot '.claude'
    $askaiDir    = Join-Path $claudeDir 'askai'
    $sessionsDir = Join-Path $askaiDir 'sessions'
    if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }

    # per-session state -- concurrent sessions in the same project never clobber each other
    $counterFile        = Join-Path $sessionsDir "$safeSessionId.counter.txt"
    $currentFeatureFile = Join-Path $sessionsDir "$safeSessionId.current-feature.txt"
    $bytesFile          = Join-Path $sessionsDir "$safeSessionId.bytes.txt"
    $pendingClearFile   = Join-Path $sessionsDir "$safeSessionId.pending-clear.txt"
    $cavemanFile        = Join-Path $sessionsDir "$safeSessionId.caveman.txt"
    $seenFile           = Join-Path $sessionsDir "$safeSessionId.seen.txt"     # long instruction blocks already sent this session
    $summaryFlagFile    = Join-Path $sessionsDir "$safeSessionId.summary.txt"  # slug (or '(index)') whose summary is already in context
    # project-wide config/registry
    $featuresFile        = Join-Path $askaiDir 'features.json'
    $intervalFile        = Join-Path $askaiDir 'interval.txt'
    $volumeThresholdFile = Join-Path $askaiDir 'volume-threshold.txt'
    $metricsFile         = Join-Path $askaiDir 'metrics.jsonl'

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
        $newTotal = $current + $responseLength
        Set-Content -Path $bytesFile -Value $newTotal -NoNewline -Encoding utf8

        # same-turn fallback -- don't wait for a UserPromptSubmit that might never come
        $volumeThreshold = Read-IntFile $volumeThresholdFile 80000 10000 2000000
        if ($newTotal -ge $volumeThreshold) {
            Emit-Context 'PostToolUse' "Tool-output volume just crossed $volumeThreshold chars mid-turn (no need to wait for your next prompt). Before writing your final reply this turn, run the checkpoint closing steps now: read '$featuresFile' if present, judge/confirm the feature via AskUserQuestion, append a checkpoint summary, write the slug to '$currentFeatureFile', write '1' to '$pendingClearFile', call get_usage('self') for a pre-clear tokens_used/percent_used reading and log it plus the outcome as one JSON line to '$metricsFile' (see the interval-checkpoint instructions for the exact fields), and decide explicitly whether to call clear_session('self') now or hold it and say so."
            Set-Content -Path $bytesFile -Value '0' -NoNewline -Encoding utf8
        }
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
        # compaction may summarize away the caveman directive -- re-arm it so the next prompt injects it again
        # (same for the once-per-session instruction blocks and the injected feature summary)
        Remove-Item -Path $cavemanFile, $seenFile, $summaryFlagFile -Force -ErrorAction SilentlyContinue
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

    # --- caveman terse-output mode: injected ONCE per session (hook context persists in history, so re-sending it
    # every prompt would pile up), re-injected only if the level changes or after a PreCompact. Level: off|lite|full|ultra,
    # project override <project>/.claude/askai/caveman.txt, else ~/.claude/askai-caveman.txt, else 'full'.
    $cavemanLevel = 'full'
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    foreach ($cfg in @((Join-Path $askaiDir 'caveman.txt'), (Join-Path $userProfile '.claude\askai-caveman.txt'))) {
        if (Test-Path $cfg) {
            $v = Get-Content $cfg -Raw -ErrorAction SilentlyContinue
            if ($v) {
                $v = $v.Trim().ToLower()
                if ($v -in 'off', 'lite', 'full', 'ultra') { $cavemanLevel = $v; break }
            }
        }
    }
    $cavemanSeen = ''
    if (Test-Path $cavemanFile) {
        $cavemanSeen = Get-Content $cavemanFile -Raw -ErrorAction SilentlyContinue
        if ($cavemanSeen) { $cavemanSeen = $cavemanSeen.Trim() }
    }
    if ($cavemanLevel -ne $cavemanSeen) {
        $cavemanKeep = "Keep technical terms, numbers, units, code blocks, commands and quoted errors exact; never drop not/no/never/only/except. Commit messages, PR text, code comments and file contents stay in normal style. Use full clear sentences for security warnings, destructive/irreversible-action confirmations and AskUserQuestion option text. Compression is style only -- never omit needed information, and never make output longer to sound like a caveman."
        $cavemanText = @{
            lite  = "Caveman mode (lite, set by askai; user says 'stop caveman' or 'normal mode' to end it): no filler (just/really/basically), pleasantries or hedging; keep full sentences and articles. $cavemanKeep"
            full  = "Caveman mode (full, set by askai; user says 'stop caveman' or 'normal mode' to end it): reply terse -- drop articles, filler (just/really/basically), pleasantries and hedging; fragments OK; short synonyms; no tool-call narration, decorative tables or emoji. $cavemanKeep"
            ultra = "Caveman mode (ultra, set by askai; user says 'stop caveman' or 'normal mode' to end it): maximum terseness -- fragments, drop articles/filler/pleasantries/hedging/connectors when meaning stays clear, well-known abbreviations only (DB, API, HTTP), no tool-call narration, decorative tables or emoji. $cavemanKeep"
        }
        if ($cavemanLevel -eq 'off') {
            if ($cavemanSeen) { $contextParts.Add("Caveman mode is now off -- reply in normal style again.") }
        } else {
            $contextParts.Add($cavemanText[$cavemanLevel])
        }
        Set-Content -Path $cavemanFile -Value $cavemanLevel -NoNewline -Encoding utf8
    }

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
    # Injected once per session (and again after PreCompact, or when a '#slug' tag switches feature), capped to the most
    # recent $summaryMax chars -- history already carries it, so re-sending every prompt would only pile up.
    $summaryMax = Read-IntFile (Join-Path $askaiDir 'summary-max-chars.txt') 6000 1000 200000
    $summaryKey = if ($currentSlug) { $currentSlug } else { '(index)' }
    $summaryFlagSeen = ''
    $summaryFlagExists = Test-Path $summaryFlagFile
    if ($summaryFlagExists) { $summaryFlagSeen = (Get-Content $summaryFlagFile -Raw -ErrorAction SilentlyContinue); if ($summaryFlagSeen) { $summaryFlagSeen = $summaryFlagSeen.Trim() } }
    # inject when nothing was sent yet this session, or the user explicitly switched feature via '#slug'.
    # A slug set by this session's own checkpoint is already in context, so only the flag is updated.
    $injectSummary = (-not $summaryFlagExists) -or ($taggedSlug -and $summaryKey -ne $summaryFlagSeen)
    if ($summaryKey -ne $summaryFlagSeen) { Set-Content -Path $summaryFlagFile -Value $summaryKey -NoNewline -Encoding ascii }

    if ($injectSummary) {
        if ($currentSlug -and $features) {
            $entry = $features.features | Where-Object { $_.slug -eq $currentSlug } | Select-Object -First 1
            if ($entry) {
                $summaryPath = Join-Path $claudeDir $entry.file
                if (Test-Path $summaryPath) {
                    $summary = Get-Content $summaryPath -Raw -ErrorAction SilentlyContinue
                    if ($summary -and $summary.Trim().Length -gt 0) {
                        $head = "Feature checkpoint summary -- '$($entry.name)' ($($entry.file)), for continuity across session clears:`n"
                        if ($summary.Length -gt $summaryMax) {
                            $tail = $summary.Substring($summary.Length - $summaryMax)
                            $cut = $tail.IndexOf("`n## ")
                            if ($cut -ge 0) { $tail = $tail.Substring($cut + 1) }
                            $head = "Feature checkpoint summary -- '$($entry.name)' ($($entry.file)), most recent $($tail.Length) of $($summary.Length) chars only (read '$summaryPath' if older detail is needed), for continuity across session clears:`n"
                            $summary = $tail
                        }
                        $contextParts.Add($head + $summary)
                    }
                }
            }
        } elseif (-not $currentSlug -and $features -and $features.features -and $features.features.Count -gt 0) {
            $lines = $features.features | ForEach-Object { "- $($_.slug): $($_.name) -- $($_.file)" }
            $contextParts.Add("Tracked feature summaries exist (none loaded yet this session). If the prompt is about one, read its file now, or tag the prompt with e.g. '#$($features.features[0].slug)' to load it:`n" + [string]::Join("`n", $lines))
        }
    }

    # --- scoping reminder (formerly askai-auto-ask.ps1) ---
    if (-not $isTrivial -and (Test-Seen $seenFile 'scope')) {
        $contextParts.Add("Scoping reminder: apply the scoping rules given earlier this session (new distinct task -> one 4-question AskUserQuestion; follow-ups and short replies skip it).")
    } elseif (-not $isTrivial) {
        Mark-Seen $seenFile 'scope'
        $contextParts.Add("Token-efficient scoping reminder (applies to every project; the full rules are sent once per session, later prompts get a short pointer): first judge whether this prompt is a NEW, DISTINCT task/request, or an obvious follow-up/continuation/short reply within the current conversation. " +
            "If it's clearly a follow-up or continuation, proceed normally -- do not ask anything extra. " +
            "If it's a new, distinct task, BEFORE doing any exploration, confirm four things via one AskUserQuestion call, pre-filling your best guess as the recommended option in each: " +
            "(1) Area -- the specific file(s)/directory/topic this task is scoped to (offer your best guess, or 'no specific area -- general question' if none applies); stay inside the confirmed scope, don't explore beyond it unless truly necessary. " +
            "(2) Additional items -- anything extra to pull in beyond the area (default option: 'none'). " +
            "(3) Answer length -- max characters for the final reply (default option: '500 characters'); keep the answer at or under the confirmed budget, cutting explanation before the direct answer. " +
            "(4) Effort level -- judge how demanding the task actually is and pre-fill your recommendation as the default: 'medium' for a straightforward ask, 'xhigh' for genuine complexity, 'high' for everything typical in between (lean toward 'high' for most real work). Offer exactly medium/high/xhigh; never offer or recommend 'max' unless the user has separately, explicitly said this task calls for it. This session cannot change its own effort level (self-effort changes are refused by design) -- if the confirmed level differs from the session's current one, say so in one line and tell the user to apply it themselves via the app's effort-level selector; don't claim to have applied it. " +
            "Skip asking only if the user's request already explicitly states all four itself -- then just state what you're using in one line instead.")
    }

    # --- pending-clear: a prior checkpoint was filed but the actual clear was never confirmed done ---
    $pendingClear = (Test-Path $pendingClearFile) -and ((Get-Content $pendingClearFile -Raw -ErrorAction SilentlyContinue).Trim() -eq '1')

    if ($pendingClear -and -not $noscope -and (Test-Seen $seenFile 'pending')) {
        $contextParts.Add("Pending clear still owed (flag file '$pendingClearFile' = 1): decide again this turn as described earlier -- get_usage('self'), append the metrics line to '$metricsFile' (trigger 'pending-clear reminder', outcome cleared/declined/blocked/held), then clear_session('self') last, or hold and say why in one line.")
    } elseif ($pendingClear -and -not $noscope) {
        Mark-Seen $seenFile 'pending'
        $contextParts.Add("Reminder: a checkpoint from an earlier prompt in this session filed its summary but the clear_session('self') call was never confirmed done (file: '$pendingClearFile'). Decide again this turn, explicitly, and log the decision: call get_usage('self') for this session's current tokens_used/percent_used, then append one JSON line to '$metricsFile' (create it if it doesn't exist; one object per line, no trailing comma) with fields {`"ts`":`"<UTC ISO8601>`",`"session`":`"$safeSessionId`",`"slug`":`"<current feature slug or 'general'>`",`"trigger`":`"pending-clear reminder`",`"tokens_used`":<number>,`"percent_used`":<number>,`"outcome`":`"<see below>`"}. (a) If now is a reasonable stopping point, after answering, call clear_session('self') as your last action: outcome 'cleared' if it's confirmed to have run (then also write '0' to '$pendingClearFile'), 'declined' if the user declines the approval prompt, or 'blocked' if a permission/classifier error prevents it (leave '$pendingClearFile' at '1' for 'declined'/'blocked' so this reminder resurfaces). (b) Otherwise, outcome 'held', and tell the user in one short line that you're still holding the pending clear and why -- do not just silently drop it again.")
    }

    # --- checkpoint decision: interval count, an explicit wrap-up phrase, or accumulated tool-output volume ---
    # suppressed while a clear is already pending -- don't pile up a second classification before the first is resolved
    $isWrapUp = $trimmed -imatch "(done for (today|now|the day)|that's (all|it) for (now|today)|stopping here|wrapping up|calling it a day)"
    $bytesSinceCheckpoint = Read-IntFile $bytesFile 0 0 2147483647
    $isVolumeTrigger = $bytesSinceCheckpoint -ge $volumeThreshold
    $shouldCheckpoint = (-not $noscope) -and (-not $pendingClear) -and (($count % $interval -eq 0) -or $isWrapUp -or $isVolumeTrigger)
    # fires only when the full checkpoint is blocked by a stuck pending-clear -- keeps volume capped either way
    $shouldVolumeNote = (-not $noscope) -and $pendingClear -and $isVolumeTrigger

    if ($shouldCheckpoint) {
        $reason = "prompt #$count reached the every-$interval checkpoint"
        if ($isWrapUp) { $reason = "you said something that sounds like wrapping up for now" }
        elseif ($isVolumeTrigger) { $reason = "this session has accumulated roughly $bytesSinceCheckpoint characters of tool output since the last checkpoint (threshold: $volumeThreshold)" }

        if (Test-Seen $seenFile 'checkpoint') {
            $contextParts.Add("Checkpoint triggered ($reason). After fully answering, run the same 9 closing steps given earlier this session (features.json '$featuresFile' -> confirm feature via AskUserQuestion -> append summary under '$askaiDir' -> write slug to '$currentFeatureFile' -> write '1' to '$pendingClearFile' -> get_usage('self') + metrics line to '$metricsFile' -> decide clear_session('self') or hold, out loud).")
        } else {
        Mark-Seen $seenFile 'checkpoint'
        $contextParts.Add("Checkpoint triggered ($reason). After fully answering the user's actual request below, do these closing steps in the same turn: " +
            "(1) Read '$featuresFile' if it exists (it may not yet, on an early checkpoint) -- it holds {`"features`":[{`"slug`",`"name`",`"file`":`"askai/<slug>.md`"}]} (a project-wide registry, shared by all sessions). " +
            "(2) Based on roughly the recent exchanges, judge which existing feature(s) this work belongs to, or whether it's project-general, or whether it looks like a new feature not yet tracked. " +
            "(3) Confirm with the user via AskUserQuestion: offer your best-guess existing feature(s) as options (if any matched), plus a 'General / project-wide' option -- the user can pick 'Other' to type a new feature name, and you can set multiSelect if more than one plausibly applies. " +
            "(4) For each confirmed feature: if new, choose a short kebab-case slug, add {slug, name, file: 'askai/<slug>.md'} to features.json's features array (create features.json with an empty features array first if it doesn't exist), and create the feature's md file under '$askaiDir' with a top-level '# <Feature Name> -- Checkpoint Summary' heading if it doesn't exist yet. If 'General / project-wide' was chosen, use slug 'general' and file 'askai/general.md'. Append a short bullet-point summary of the relevant exchanges under a new '## Checkpoint <UTC timestamp>' heading in each confirmed feature's file. " +
            "(5) Write the confirmed feature's slug to '$currentFeatureFile' (create the file if needed; this is THIS session's own pointer, other concurrent sessions are unaffected) -- if more than one feature was confirmed, pick the most central one to write there. " +
            "(6) Write '1' to '$pendingClearFile' right after the summary file write succeeds -- this marks the clear as owed until it's actually confirmed done. " +
            "(7) Tell the user in one short line which feature(s) the checkpoint was filed under. " +
            "(8) Call get_usage('self') for this session's current tokens_used/percent_used (this is the pre-clear reading -- the whole point of logging it). Append one JSON line to '$metricsFile' (create the file if it doesn't exist; append-only, one JSON object per line, no trailing comma, no surrounding array) with fields {`"ts`":`"<UTC ISO8601 timestamp>`",`"session`":`"$safeSessionId`",`"slug`":`"<the confirmed feature slug from step 5, or 'general'>`",`"trigger`":`"$reason`",`"tokens_used`":<number from get_usage>,`"percent_used`":<number from get_usage>,`"outcome`":`"<see below>`"}. " +
            "(9) Then decide explicitly, out loud to the user, and set that line's outcome accordingly: if now is a reasonable stopping point, call clear_session('self') as your last tool call this turn (it will still ask the user to approve) -- outcome 'cleared' if it's confirmed to have run (then also write '0' to '$pendingClearFile'), 'declined' if the user declines the approval prompt, or 'blocked' if a permission/classifier error prevents the call (leave '$pendingClearFile' at '1' for 'declined'/'blocked' so the pending-clear reminder resurfaces). If the user is clearly mid-task, it is fine to hold the clear -- set outcome 'held' and say so explicitly ('holding the clear for now since you're still working') rather than silently doing nothing; the pending-clear reminder will resurface on your next reply either way, so it is never silently forgotten.")
        }

        # optimistic reset -- a checkpoint is about to consolidate things
        Set-Content -Path $bytesFile -Value '0' -NoNewline -Encoding utf8
    } elseif ($shouldVolumeNote) {
        $slug = if ($currentSlug) { $currentSlug } else { 'general' }
        $targetFile = "askai/$slug.md"
        if ($features -and $slug -ne 'general') {
            $entry = $features.features | Where-Object { $_.slug -eq $slug } | Select-Object -First 1
            if ($entry) { $targetFile = $entry.file }
        }
        $targetPath = Join-Path $claudeDir $targetFile
        $contextParts.Add("Volume safety note: roughly $bytesSinceCheckpoint characters of tool output have accumulated while a clear is still pending (threshold: $volumeThreshold). The full checkpoint stays deferred until the pending clear is resolved, but silently append 2-4 bullets of the most important recent progress to '$targetPath' under a new '## Volume note <UTC timestamp>' heading (create it with a top-level '# $slug -- Checkpoint Summary' heading first if it doesn't exist) so nothing is lost, then continue normally -- no AskUserQuestion needed for this.")
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
description: Token-efficient task runner — scopes area, extra context, caps answer length, and recommends an effort level. Also handles skill authoring (create/edit/improve a Claude skill) by handing off to the skill-creator workflow.
argument-hint: <task description>
---

First check: is this task about creating, drafting, editing, or improving a Claude skill itself (a SKILL.md, its bundled scripts/references, or its triggering description) — as opposed to using an existing skill to do unrelated work? If so, skip everything below and instead invoke the `skill-creator` skill, giving it the task in `$ARGUMENTS` verbatim as its starting context. Skill authoring is a multi-step interview/draft/test loop that the area/length scoping below doesn't fit, so don't apply it here. Once skill-creator's process concludes (skill drafted, tested, or packaged per the user's request), stop — don't fall through to the steps below for the same task.

Otherwise, handle this task in token-efficient mode. Before doing any exploration, always confirm four things with the user via one AskUserQuestion call — even when they're inferable or a default would obviously apply. Pre-fill each question's options with your best guess (including the relevant default) so confirming is one click, but still ask:

1. **Area** — the specific file(s), directory, or topic this task is scoped to (offer your best guess as an option, e.g. inferred from the task text or "no specific area — general question"). Stay inside the confirmed scope; do not explore the wider codebase/project unless answering truly requires it.
2. **Additional items** — anything extra to pull into scope beyond the area (e.g. "also the tests", "and the config file"). Offer "none" as the default option.
3. **Answer length** — max characters for your final reply. Offer "500 characters (default)" plus a couple of other sizes as options.
4. **Effort level** — judge how demanding the task actually is from the prompt, and pre-fill your recommendation as the default option: `medium` for a straightforward ask (lookup, one-line answer, obvious mechanical edit), `xhigh` for genuine complexity (deep multi-file reasoning, tricky architecture/design tradeoffs, high-stakes correctness), and `high` for everything typical in between — lean toward `high` for most real work. Offer exactly these three options (`medium`, `high`, `xhigh`); never offer or recommend `max` — only propose it if the user has separately, explicitly said this specific task calls for it.

Only skip the question entirely if the user's request already explicitly pins down all four (e.g. they named the file, said what else to include, gave a character limit, and stated an effort level) — in that case state what you're using in one line instead.

Then do the task:
- Read/search only within area + additional items — no broader exploration.
- Keep the final answer at or under the character budget. If something has to give, cut explanation before cutting the direct answer.
- This session cannot change its own effort level (self-effort changes are refused by design, so the session doesn't silently re-price its own turns). If the confirmed effort level differs from the session's current one, say so in one line and tell the user to apply it themselves via the app's effort-level selector — don't claim to have applied it.

Task: $ARGUMENTS
'@
Set-Content -Path (Join-Path $commandsDir 'askai.md') -Value $askaiMdContent -Encoding utf8
Write-Host "Installed: $commandsDir\askai.md"

# ============================================================================
# 3. merge hook registrations + autoCompact tuning into settings.json
# ============================================================================
$hookScriptPath = Join-Path $hooksDir 'askai.ps1'

$postToolUseMatcher = 'Bash|Read|Grep|Agent|Task'

function New-HookGroup([string]$eventName) {
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$hookScriptPath`" -Event $eventName"
    $group = [pscustomobject]@{
        hooks = @(
            [pscustomobject]@{
                type          = 'command'
                command       = $cmd
                timeout       = if ($eventName -eq 'PreCompact') { 20 } elseif ($eventName -eq 'PostToolUse') { 10 } else { 15 }
                statusMessage = 'askai'
            }
        )
    }
    if ($eventName -eq 'PostToolUse') {
        # Scope to high-output tools only -- skips a ~250ms powershell.exe spawn on cheap tools like Edit/Write
        $group | Add-Member -MemberType NoteProperty -Name 'matcher' -Value $postToolUseMatcher
    }
    return $group
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
    } elseif ($eventName -eq 'PostToolUse') {
        # Upgrade an already-registered PostToolUse hook that predates the matcher optimization
        $updated = $false
        foreach ($group in $existing) {
            foreach ($h in $group.hooks) {
                if ($h.command -and $h.command -like "*askai.ps1*-Event PostToolUse*") {
                    if (-not ($group.PSObject.Properties.Name -contains 'matcher')) {
                        $group | Add-Member -MemberType NoteProperty -Name 'matcher' -Value $postToolUseMatcher
                        $updated = $true
                    } elseif ($group.matcher -ne $postToolUseMatcher) {
                        $group.matcher = $postToolUseMatcher
                        $updated = $true
                    }
                }
            }
        }
        if ($updated) {
            Write-Host "Updated PostToolUse hook matcher -> $postToolUseMatcher"
        } else {
            Write-Host "$eventName hook already present -- left as-is"
        }
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

# skill listing trim -- only skills unrelated to code/book-writing work, set to name-only
# (name stays visible and still invocable, just the description is dropped from every turn's context).
# Only ADDS missing entries -- never overrides a value you've already set for a given skill.
$defaultSkillTrim = [ordered]@{
    'anthropic-skills:xlsx'                = 'name-only'
    'anthropic-skills:pptx'                = 'name-only'
    'anthropic-skills:morning'             = 'name-only'
    'anthropic-skills:setup-writing-style' = 'name-only'
    'anthropic-skills:import-memory'       = 'name-only'
    'anthropic-skills:skill-creator'       = 'name-only'
    'keybindings-help'                     = 'name-only'
    'artifact-design'                      = 'name-only'
    'artifact-diagramming'                 = 'name-only'
    'artifact-capabilities'                = 'name-only'
    'anthropic-skills:consolidate-memory'  = 'name-only'
    # secondary caveman skills -- rarely needed, so keep their descriptions out of every turn's context
    'caveman-commit'                       = 'name-only'
    'caveman-compress'                     = 'name-only'
    'caveman-review'                       = 'name-only'
    'caveman-stats'                        = 'name-only'
}
if (-not ($settings.PSObject.Properties.Name -contains 'skillOverrides')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'skillOverrides' -Value ([pscustomobject]@{})
}
$addedSkills = 0
foreach ($skillName in $defaultSkillTrim.Keys) {
    if (-not ($settings.skillOverrides.PSObject.Properties.Name -contains $skillName)) {
        $settings.skillOverrides | Add-Member -MemberType NoteProperty -Name $skillName -Value $defaultSkillTrim[$skillName]
        $addedSkills++
    }
}
if ($addedSkills -gt 0) { Write-Host "Set skillOverrides for $addedSkills skill(s) (name-only)" }
else { Write-Host "skillOverrides already present for all defaults -- left as-is" }

$settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsPath -Encoding utf8
Write-Host "Merged into: $settingsPath"

# caveman terse-output level read by the askai hook (hooks/askai.ps1). Keeps an existing file unless
# -CavemanMode is passed explicitly; without either, -SkipCaveman means 'off' and the default is 'full'.
$cavemanCfg = Join-Path $homeDir '.claude\askai-caveman.txt'
if ($PSBoundParameters.ContainsKey('CavemanMode') -or -not (Test-Path $cavemanCfg)) {
    $cavemanLevel = if ($CavemanMode) { $CavemanMode } elseif ($SkipCaveman) { 'off' } else { 'full' }
    Set-Content -Path $cavemanCfg -Value $cavemanLevel -Encoding ascii
    Write-Host "askai caveman mode: $cavemanLevel ($cavemanCfg)"
} else {
    Write-Host "askai caveman mode: kept existing setting in $cavemanCfg"
}

# ============================================================================
# 4. caveman (third-party) -- on by default; opt out via -SkipCaveman / -SkipCavemanProxy
#    Runs after the settings merge above so anything the caveman CLI writes to settings.json isn't clobbered.
#    A failure here warns but never fails the askai install.
# ============================================================================
function Invoke-Optional([string]$label, [scriptblock]$body) {
    try {
        & $body
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        Write-Host "Installed: $label"
    } catch {
        Write-Warning "$label failed ($($_.Exception.Message)) -- askai itself is installed; re-run that command by hand."
    }
}

if (-not ($SkipCaveman -and $SkipCavemanProxy)) {
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-Warning "Node.js/npm not found on PATH -- skipping caveman. Install Node (22.13+ for the proxy) and re-run."
    } else {
        if (-not $SkipCaveman) {
            Invoke-Optional 'caveman skill' { npx --yes skills add JuliusBrussee/caveman -g -a claude-code -s caveman caveman-commit caveman-compress caveman-review caveman-stats -y --copy }
        }
        if (-not $SkipCavemanProxy) {
            $nodeVer = [version](((node --version) -replace '^v', '') -replace '-.*$', '')
            if ($nodeVer -lt [version]'22.13.0') {
                Write-Warning "Node $nodeVer is older than 22.13 -- skipping caveman proxy."
            } else {
                Invoke-Optional 'caveman proxy (@caveman-ai/cli)' { npm install -g '@caveman-ai/cli' }
                if (Get-Command caveman -ErrorAction SilentlyContinue) {
                    Invoke-Optional 'caveman setup --install' { caveman setup --install }
                }
            }
        }
    }
}

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
