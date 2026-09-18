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

    # opt-in A/B (askai/ab.txt or ~/.claude/askai-ab.txt containing 'on'): each new session gets a sticky random arm, kept in
    # <sid>.arm.txt. Control sessions skip the caveman directive and the scoping reminder (memory/checkpoint features still run)
    # so askai-report.js can compare cost per prompt between arms. Anything but 'on' -> everyone is treatment, arm files ignored.
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    $abOn = $false
    foreach ($cfg in @((Join-Path $askaiDir 'ab.txt'), (Join-Path $userProfile '.claude\askai-ab.txt'))) {
        if (Test-Path $cfg) { $abOn = ((Get-Content $cfg -Raw -ErrorAction SilentlyContinue) -as [string]).Trim().ToLower() -eq 'on'; break }
    }
    $isControl = $false
    if ($abOn) {
        $armFile = Join-Path $sessionsDir "$safeSessionId.arm.txt"
        # only brand-new sessions get an arm (no counter yet); a session already running with caveman on is never flipped mid-way
        if (-not (Test-Path $armFile) -and -not (Test-Path $counterFile)) {
            Set-Content -Path $armFile -Value $(if ((Get-Random -Maximum 2) -eq 0) { 'control' } else { 'treatment' }) -NoNewline -Encoding ascii
        }
        $isControl = ((Get-Content $armFile -Raw -ErrorAction SilentlyContinue) -as [string]).Trim() -eq 'control'
        if ($isControl) { $isTrivial = $true }   # $isTrivial only gates the scoping reminder
    }

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
    foreach ($cfg in @((Join-Path $askaiDir 'caveman.txt'), (Join-Path $userProfile '.claude\askai-caveman.txt'))) {
        if (Test-Path $cfg) {
            $v = Get-Content $cfg -Raw -ErrorAction SilentlyContinue
            if ($v) {
                $v = $v.Trim().ToLower()
                if ($v -in 'off', 'lite', 'full', 'ultra') { $cavemanLevel = $v; break }
            }
        }
    }
    if ($isControl) { $cavemanLevel = 'off' }   # A/B control arm
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
        $contextParts.Add("Scoping reminder: apply the scoping rules given earlier this session (new distinct task -> one 3-question AskUserQuestion; follow-ups and short replies skip it).")
    } elseif (-not $isTrivial) {
        Mark-Seen $seenFile 'scope'
        $contextParts.Add("Token-efficient scoping reminder (applies to every project; the full rules are sent once per session, later prompts get a short pointer): first judge whether this prompt is a NEW, DISTINCT task/request, or an obvious follow-up/continuation/short reply within the current conversation. " +
            "If it's clearly a follow-up or continuation, proceed normally -- do not ask anything extra. " +
            "If it's a new, distinct task, BEFORE doing any exploration, confirm three things via one AskUserQuestion call, pre-filling your best guess as the recommended option in each: " +
            "(1) Area -- the specific file(s)/directory/topic this task is scoped to (offer your best guess, or 'no specific area -- general question' if none applies); stay inside the confirmed scope, don't explore beyond it unless truly necessary. " +
            "(2) Additional items -- anything extra to pull in beyond the area (default option: 'none'). " +
            "(3) Answer length -- max characters for the final reply (default option: '500 characters'); keep the answer at or under the confirmed budget, cutting explanation before the direct answer. " +
            "Skip asking only if the user's request already explicitly states all three itself -- then just state what you're using in one line instead.")
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
