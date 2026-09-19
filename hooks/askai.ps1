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

# Current context size = input + cache tokens of the LAST usage record in the session transcript (reads only the file tail).
# Returns 0 when unknown; every guard below treats 0 as 'no signal'.
function Get-ContextTokens([string]$path) {
    try {
        if (-not $path -or -not (Test-Path $path)) { return 0 }
        $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        try {
            $len = $fs.Length
            $take = [int][Math]::Min($len, 400000)
            [void]$fs.Seek($len - $take, [IO.SeekOrigin]::Begin)
            $buf = New-Object byte[] $take
            $got = $fs.Read($buf, 0, $take)
            $txt = [Text.Encoding]::UTF8.GetString($buf, 0, $got)
        } finally { $fs.Dispose() }
        $ms = [regex]::Matches($txt, '"input_tokens":(\d+),"cache_creation_input_tokens":(\d+),"cache_read_input_tokens":(\d+)')
        if ($ms.Count -eq 0) { return 0 }
        $m = $ms[$ms.Count - 1]
        return ([int]$m.Groups[1].Value + [int]$m.Groups[2].Value + [int]$m.Groups[3].Value)
    } catch { return 0 }
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
    $cavemanFile        = Join-Path $sessionsDir "$safeSessionId.caveman.txt"
    $ctxNudgeFile       = Join-Path $sessionsDir "$safeSessionId.ctxnudge.txt"  # context size at the last size nudge
    $connFile           = Join-Path $sessionsDir "$safeSessionId.conn.txt"      # connector(s) whose enable set a task aside
    $seenFile           = Join-Path $sessionsDir "$safeSessionId.seen.txt"     # long instruction blocks already sent this session
    $summaryFlagFile    = Join-Path $sessionsDir "$safeSessionId.summary.txt"  # slug (or '(index)') whose summary is already in context
    # project-wide config/registry
    $featuresFile        = Join-Path $askaiDir 'features.json'
    $intervalFile        = Join-Path $askaiDir 'interval.txt'
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
    # retired in v2: tool-output volume tracking cost a PowerShell spawn per tool call and only forced extra checkpoints
    if ($Event -eq 'PostToolUse') { exit 0 }

    # ================= PreToolUse (Agent): subagents were ~70% of spend, so each launch must carry explicit limits =================
    # Denies ONCE per distinct prompt when a tool-call limit or reply-size limit is missing; an identical resend or '!nolimit'
    # in the prompt passes, so this can never loop.
    if ($Event -eq 'PreToolUse') {
        $ti = $data.tool_input
        $ap = ''
        if ($ti -and $ti.prompt) { $ap = [string]$ti.prompt }
        if ($ap -and $ap -notmatch '!nolimit') {
            $needCalls = $ap -notmatch '(?i)(\d+\s*(tool[- ]?calls?|calls|turns|steps)\b|(tool[- ]?calls?|turns)\s*(limit|max|budget|cap))'
            $needReply = $ap -notmatch '(?i)((under|below|within|max(imum)?|at most|no more than|limit(ed)? to|<)\s*~?\d[\d,]*\s*(chars|characters|words|lines|tokens|bullets)|(reply|report|answer|response)\s*(size|length|limit|budget))'
            if ($needCalls -or $needReply) {
                $sha = [Security.Cryptography.SHA1]::Create()
                $key = 'agentdeny:' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ap))).Replace('-', '').Substring(0, 12))
                if (-not (Test-Seen $seenFile $key)) {
                    Mark-Seen $seenFile $key
                    $missing = @()
                    if ($needCalls) { $missing += "a tool-call limit (e.g. 'at most 15 tool calls; stop and report what was found if reached')" }
                    if ($needReply) { $missing += "a reply size limit (e.g. 'reply under 1500 characters, paths and line numbers first, no file dumps')" }
                    $reason = "askai subagent budget: subagents are ~70% of spend. Add " + ($missing -join ' and ') + " to the agent prompt and resend (use Explore with model haiku for search). An identical resend or '!nolimit' in the prompt passes."
                    $deny = [ordered]@{ hookSpecificOutput = [ordered]@{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } }
                    Write-Output ($deny | ConvertTo-Json -Depth 5 -Compress)
                }
            }
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
        Remove-Item -Path $cavemanFile, $seenFile, $summaryFlagFile, $ctxNudgeFile -Force -ErrorAction SilentlyContinue
        Emit-Context 'PreCompact' $note
        exit 0
    }

    # ================= UserPromptSubmit: scoping + feature context + checkpoint =================
    $prompt = ''
    if ($data -and $data.prompt) { $prompt = [string]$data.prompt }
    $trimmed = $prompt.Trim()

    $interval = Read-IntFile $intervalFile 5 2 50
    $ctx = Get-ContextTokens ([string]$data.transcript_path)

    # '!noscope' -- opt this one prompt out of counting, checkpointing and scoping questions
    $noscope = $trimmed -imatch '!noscope'

    # cheap trivial-reply filter (skips the scoping reminder only)
    $isTrivial = $noscope -or ($trimmed.Length -le 3) -or
        ($trimmed -imatch '^(ok|okay|k|thanks|thank you|thx|yes|no|yep|nope|sure|got it|great|good|nice|cool|continue|go ahead|proceed|sounds good|looks good|lgtm)[.!]*$')

    $isShortReply = $isTrivial   # arm-independent copy: the A/B control arm overrides $isTrivial below, but v2 guards apply to both arms

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

    # --- scoping: state the assumption in one line instead of asking (an AskUserQuestion round trip cost more than it saved) ---
    # Full rule sent once per session (and again after PreCompact); later prompts get nothing -- history already carries it.
    if (-not $isTrivial -and -not (Test-Seen $seenFile 'scope')) {
        Mark-Seen $seenFile 'scope'
        $contextParts.Add("Scoping (new, distinct tasks only; follow-ups and short replies skip it): before exploring, state in ONE line the area (files/dir/topic), extras (default none) and max answer length (default 500 chars) you are assuming, then stay inside that scope and keep the final reply within the budget, cutting explanation before the direct answer. Do NOT call AskUserQuestion for this; ask only if the request is genuinely ambiguous or costly to get wrong.")
    }

    # --- checkpoint decision: interval count, an explicit wrap-up phrase, or accumulated tool-output volume ---
    $isWrapUp = $trimmed -imatch "(done for (today|now|the day)|that's (all|it) for (now|today)|stopping here|wrapping up|calling it a day)"
    $shouldCheckpoint = (-not $noscope) -and (($count % $interval -eq 0) -or $isWrapUp)

    if ($shouldCheckpoint) {
        $reason = "prompt #$count reached the every-$interval checkpoint"
        if ($isWrapUp) { $reason = "you said something that sounds like wrapping up for now" }

        # the hook logs the metrics row itself from the transcript -- the model no longer spends a get_usage call + append on it
        $row = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); session = $safeSessionId; slug = $(if ($currentSlug) { $currentSlug } else { 'general' }); trigger = $reason; tokens_used = $ctx; outcome = 'held' }
        Add-Content -Path $metricsFile -Value ($row | ConvertTo-Json -Compress) -Encoding ascii

        if (Test-Seen $seenFile 'checkpoint') {
            $contextParts.Add("Checkpoint due ($reason). After answering, file it the same one-call way as earlier this session (feature files under '$askaiDir', pointer '$currentFeatureFile').")
        } else {
            Mark-Seen $seenFile 'checkpoint'
            $slugList = ''
            if ($features -and $features.features) { $slugList = ' Known slugs: ' + (($features.features | ForEach-Object { $_.slug }) -join ', ') + '.' }
            $contextParts.Add("Checkpoint due ($reason). After fully answering, file it silently with exactly ONE tool call (a single PowerShell/Bash command doing both writes; no AskUserQuestion, no get_usage, no metrics -- the hook logs those): (a) append 2-5 bullets of progress under a new '## Checkpoint <UTC timestamp>' heading in the matching feature file '$askaiDir\<slug>.md' (else 'general'; create it with a '# <Feature Name> -- Checkpoint Summary' heading if missing, and for a genuinely new feature also add {slug, name, file:'askai/<slug>.md'} to '$featuresFile'); (b) write the slug to '$currentFeatureFile'.$slugList Then one short line saying which feature it went under. Call clear_session('self') only if the user is clearly wrapping up (it asks them to approve); otherwise hold it and do not mention it again.")
        }
    }

    # --- context-size guard: every turn re-reads the whole context, so cost grows with size. One short nudge each time it
    # grows another 40K past the threshold (default 120K; askai/context-guard.txt overrides); the counter resets on PreCompact.
    $ctxGuard = Read-IntFile (Join-Path $askaiDir 'context-guard.txt') 120000 20000 2000000
    if ($ctx -ge $ctxGuard) {
        $lastNudge = Read-IntFile $ctxNudgeFile 0 0 2147483647
        if ($ctx -ge ($lastNudge + 40000) -or $lastNudge -eq 0) {
            Set-Content -Path $ctxNudgeFile -Value $ctx -NoNewline -Encoding ascii
            $contextParts.Add("Context is ~$([int]($ctx / 1000))K tokens and every turn re-reads all of it. When this step is done, say so in one line and suggest a fresh session for the next task (checkpoints are saved); do search/exploration through an Explore agent on haiku (at most 15 tool calls) instead of reading files here.")
        }
    }

    # --- connector manager: Claude Docs + visualize are kept OFF by default (their tool list rides every turn, ~1.7K units).
    # A hook cannot flip a connector, so it hands the model the recipe: enable -> end turn -> next prompt resumes -> disable again.
    if (Test-Path $connFile) {
        $names = "$(Get-Content $connFile -Raw -ErrorAction SilentlyContinue)".Trim()
        Remove-Item $connFile -Force -ErrorAction SilentlyContinue
        if ($names) {
            $contextParts.Add("askai connector: an earlier task in this session was set aside to enable [$names]. If those tools are now in your tool list, do that task now and, in the SAME turn, turn the connector off again with set_session_connector_enabled (it applies when the turn ends). If they are still missing, say so in one line and do the task without them.")
        }
    } elseif (-not $isShortReply) {
        $need = @()
        if ($trimmed -imatch '\b(claude (code )?docs?|docs\.claude\.com|docs\.anthropic\.com)\b') { $need += 'Claude Docs' }
        if ($trimmed -imatch '\b(visuali[sz]e|show_widget|mockup|interactive (chart|diagram|widget))\b') { $need += 'visualize' }
        if ($need.Count -gt 0) {
            $conn = [string]::Join(' + ', $need)
            $big = ''
            if ($ctx -ge 80000) { $big = " Context is ~$([int]($ctx / 1000))K tokens, so each toggle rewrites the cached prompt (about 1.25x the context): tell the user a fresh session makes this cheap." }
            Set-Content -Path $connFile -Value $conn -NoNewline -Encoding ascii
            $contextParts.Add("askai connector: this prompt may need [$conn], which askai keeps OFF by default. If its tools are NOT in your tool list: load mcp__ccd_connectors__set_session_connector_enabled (and session_connectors_status for the exact name) via ToolSearch, enable it, then end the turn with one line asking the user to send any message (e.g. 'go') -- the enable takes effect next turn and the hook will remind you to switch it off afterwards. If the task can be done without it, do that instead.$big")
        }
    }

    if ($contextParts.Count -gt 0) {
        Emit-Context 'UserPromptSubmit' ([string]::Join("`n`n", $contextParts))
    }

    exit 0
} catch {
    exit 0
}
