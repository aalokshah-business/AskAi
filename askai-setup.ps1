<#
Portable installer for the "askai" token-optimization hook system (Claude Code / Desktop app).

Installs, under the CURRENT user's home directory (works regardless of Windows username):
  - ~/.claude/hooks/askai.ps1        the unified hook script (UserPromptSubmit + PreToolUse + PreCompact)
  - ~/.claude/commands/askai.md      the /askai slash command
  - ~/.claude/hooks/askai-report.js  token savings report (needs Node.js when run)
  - ~/.claude/commands/askai-report.md  the /askai-report [hours] slash command
  - merges hook registrations + autoCompactEnabled/autoCompactWindow into ~/.claude/settings.json
    (existing content is preserved; safe to re-run -- it will not duplicate entries)

NOT installed by this script (these are per-project, not global infrastructure):
  - .claude/askai/interval.txt, context-guard.txt (checkpoint / context-guard tuning for a specific project)
  - .claude/settings.json's bashOutputMaxChars / effortLevel
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
'@
Set-Content -Path (Join-Path $hooksDir 'askai.ps1') -Value $askaiPs1Content -Encoding utf8
Write-Host "Installed: $hooksDir\askai.ps1"

# ============================================================================
# 2. askai.md -- the /askai slash command
# ============================================================================
$askaiMdContent = @'
---
description: Token-efficient task runner — scopes area, extra context, and caps answer length. Also handles skill authoring (create/edit/improve a Claude skill) by handing off to the skill-creator workflow.
argument-hint: <task description>
---

First check: is this task about creating, drafting, editing, or improving a Claude skill itself (a SKILL.md, its bundled scripts/references, or its triggering description) — as opposed to using an existing skill to do unrelated work? If so, skip everything below and instead invoke the `skill-creator` skill, giving it the task in `$ARGUMENTS` verbatim as its starting context. Skill authoring is a multi-step interview/draft/test loop that the area/length scoping below doesn't fit, so don't apply it here. Once skill-creator's process concludes (skill drafted, tested, or packaged per the user's request), stop — don't fall through to the steps below for the same task.

Otherwise, handle this task in token-efficient mode. Do not ask the user to confirm scope with AskUserQuestion; a round trip costs more than it saves. Before any exploration, state in ONE line the three things you are assuming, inferring each from the task text:

1. **Area** -- the specific file(s), directory, or topic this task is scoped to (or "no specific area" for a general question). Stay inside it; do not explore the wider codebase/project unless answering truly requires it.
2. **Additional items** -- anything extra pulled into scope beyond the area. Default: none.
3. **Answer length** -- max characters for your final reply. Default: 500 characters.

If the user's request already pins any of these down, use theirs. Ask (one short question) only if the task is genuinely ambiguous or expensive to get wrong.

Then do the task:
- Read/search only within area + additional items — no broader exploration.
- Keep the final answer at or under the character budget. If something has to give, cut explanation before cutting the direct answer.

Task: $ARGUMENTS
'@
Set-Content -Path (Join-Path $commandsDir 'askai.md') -Value $askaiMdContent -Encoding utf8
Write-Host "Installed: $commandsDir\askai.md"

# ============================================================================
# 2b. askai-report.js + askai-report.md -- token savings report (/askai-report [hours])
# ============================================================================
# Needs Node.js when run: it reads Claude Code transcripts under ~/.claude/projects and prints a savings ledger.
# The .js is ASCII-only and written without a BOM (it starts with a shebang line).
$askaiReportJs = @'
#!/usr/bin/env node
// askai / caveman / subagent performance + TOKEN SAVINGS report, built from Claude Code transcripts (~/.claude/projects/**/*.jsonl)
// plus askai's own files (metrics.jsonl, sessions/<sid>.arm.txt) and the settings that trim tokens.
// Usage: node askai-report.js [--hours 6] [--json]      (cumulative view: --hours 168 = 7 days, --hours 720 = 30 days)
// Transcripts carry no "without askai" baseline, so every saving is labelled by how it was obtained:
//   MEASURED = opt-in A/B (askai/ab.txt = on) control vs treatment sessions;  COMPUTED = exact arithmetic on known config;
//   OBSERVED = on/off comparison of different turns (confounded, not proof);  none = not measurable from transcripts.
const fs = require('fs'), path = require('path'), os = require('os');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hours = parseFloat(opt('hours', '6'));
const asJson = args.includes('--json');
const since = Date.now() - hours * 3600e3;
const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
const sfmt = n => (n < 0 ? '-' : '') + fmt(Math.abs(n));
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const cost = u => u.inp + 1.25 * u.cc + 0.1 * u.cr + 5 * u.out;   // relative units (input token = 1), not dollars
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };

const KINDS = [
  ['caveman', /Caveman mode \(|Caveman mode is now off/g],
  ['summary', /Feature checkpoint summary --|Tracked feature summaries exist|This project has tracked feature summaries/g],
  ['scope-full', /Token-efficient scoping reminder \(applies|Scoping \(new, distinct/g],
  ['scope-short', /Scoping reminder: apply/g],
  ['checkpoint', /Checkpoint triggered|Checkpoint due|Prompt tag '#/g],
  ['pending-clear', /Pending clear still owed|Reminder: a checkpoint from an earlier/g],
  ['volume', /Volume safety note|Tool-output volume (?:just )?crossed/g],
  ['precompact', /Context is about to be compacted/g],
];
function segments(text) {
  const marks = [];
  for (const [kind, re] of KINDS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) marks.push({ kind, at: m.index, hit: m[0] }); }
  marks.sort((a, b) => a.at - b.at);
  return marks.map((m, i) => ({ kind: m.kind, chars: (i + 1 < marks.length ? marks[i + 1].at : text.length) - m.at, off: /is now off/.test(m.hit), text: text.slice(m.at, m.at + 40) }));
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.jsonl') && fs.statSync(p).mtimeMs > since) files.push(p);
  }
})(projectsRoot);

const msgs = new Map();            // message id -> usage/text record (one per API response)
const toolNames = {};              // tool_use id -> tool name
const seenToolUse = new Set();
const toolOut = [];                // {name, chars, ts}
const mainEvents = {};             // sid -> ordered events for turn analysis
const sessInfo = {};               // sid -> {cwd, first, last}
const hookSegs = [];               // {sid, ts, kind, chars}
const clearCalls = [];
const agents = {};                 // agent file -> {sid, prompt}
const skillCalls = {}, agentTypes = {}, compactions = [];

for (const f of files) {
  const sub = f.split(path.sep).includes('subagents');
  const sid = sub ? path.basename(path.dirname(path.dirname(f))) : path.basename(f, '.jsonl');
  const agentKey = sub ? path.basename(f, '.jsonl') : null;
  const ev = mainEvents[sid] = mainEvents[sid] || [];
  const info = sessInfo[sid] = sessInfo[sid] || { cwd: null, first: Infinity, last: 0 };
  let cave = 'none';
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(j.timestamp || '');
    if (!sub && j.cwd && !info.cwd) info.cwd = j.cwd;
    if (ts) { info.first = Math.min(info.first, ts); info.last = Math.max(info.last, ts); }

    if (j.type === 'assistant' && j.message) {
      const m = j.message, u = m.usage || {};
      const id = m.id || j.uuid;
      let r = msgs.get(id);
      if (!r) { r = { id, sid, sub, agentKey, ts, out: 0, inp: 0, cr: 0, cc: 0, textChars: 0, cave, tools: [] }; msgs.set(id, r); }
      r.out = Math.max(r.out, u.output_tokens || 0);
      r.inp = Math.max(r.inp, u.input_tokens || 0);
      r.cr = Math.max(r.cr, u.cache_read_input_tokens || 0);
      r.cc = Math.max(r.cc, u.cache_creation_input_tokens || 0);
      for (const c of m.content || []) {
        if (c.type === 'text') { r.textChars += (c.text || '').length; if (!sub) ev.push({ t: 'text', id, ts, chars: (c.text || '').length }); }
        if (c.type === 'tool_use') {
          r.tools.push(c.name); toolNames[c.id] = c.name;
          if (!seenToolUse.has(c.id)) {
            seenToolUse.add(c.id);
            if (ts >= since) {
              const inp = c.input || {};
              if (c.name === 'Skill') { const k = inp.skill || inp.name || '?'; skillCalls[k] = (skillCalls[k] || 0) + 1; }
              if (c.name === 'Agent' || c.name === 'Task') { const k = inp.subagent_type || 'general-purpose'; agentTypes[k] = (agentTypes[k] || 0) + 1; }
            }
          }
          if (!sub && c.name === 'AskUserQuestion') ev.push({ t: 'ask', ts, q: JSON.stringify(c.input || {}) });
          if (!sub && /clear_session/.test(c.name)) clearCalls.push({ sid, ts });
        }
      }
    } else if (j.type === 'user' && j.message) {
      const c = j.message.content;
      if (Array.isArray(c) && c.some(x => x.type === 'tool_result')) {
        for (const x of c) {
          if (x.type !== 'tool_result') continue;
          const s = typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map(y => y.text || '').join('') : '';
          const nm = toolNames[x.tool_use_id] || '?';
          toolOut.push({ name: nm, chars: s.length, ts });
          if (!sub && nm !== 'AskUserQuestion') ev.push({ t: 'tool', ts, chars: s.length });
          if (!sub && nm === 'AskUserQuestion') ev.push({ t: 'answer', ts, s });
        }
      } else if (!j.isMeta) {
        const text = typeof c === 'string' ? c : (c || []).map(x => x.text || '').join('');
        if (sub) { if (agentKey && !agents[agentKey]) agents[agentKey] = { sid, prompt: text.replace(/\s+/g, ' ').slice(0, 70) }; }
        else if (text) ev.push({ t: 'prompt', ts, text });
      }
    } else if (!sub && j.type === 'system' && j.subtype === 'compact_boundary' && j.compactMetadata) {
      const cm = j.compactMetadata;
      if (ts && !compactions.some(c => c.sid === sid && c.ts === ts)) compactions.push({ sid, ts, trigger: cm.trigger, pre: cm.preTokens || 0, post: cm.postTokens || 0 });
    } else if (!sub && j.attachment && j.attachment.type === 'hook_additional_context') {
      const text = [].concat(j.attachment.content || []).join('\n\n');
      const kinds = [];
      for (const s of segments(text)) {
        hookSegs.push({ sid, ts, kind: s.kind, chars: s.chars });
        kinds.push(s.kind);
        if (s.kind === 'caveman') cave = s.off ? 'none' : ((s.text.match(/\((lite|full|ultra)/) || [])[1] || 'full');
      }
      ev.push({ t: 'hook', ts, kinds });
    }
  }
}

// ---------- window + totals ----------
const inWin = r => r.ts >= since;
const all = [...msgs.values()].filter(inWin);
const sum = list => list.reduce((a, r) => ({ out: a.out + r.out, inp: a.inp + r.inp, cr: a.cr + r.cr, cc: a.cc + r.cc, n: a.n + 1 }), { out: 0, inp: 0, cr: 0, cc: 0, n: 0 });
const main = all.filter(r => !r.sub), subs = all.filter(r => r.sub);
const T = sum(all), M = sum(main), S = sum(subs);

// main-session responses per session (all times, sorted): used for the carry cost of anything that sits in context
const mainBySid = {};
for (const r of msgs.values()) if (!r.sub) (mainBySid[r.sid] = mainBySid[r.sid] || []).push(r);
for (const k in mainBySid) mainBySid[k].sort((a, b) => a.ts - b.ts);
const later = (sid, ts) => { const a = mainBySid[sid] || []; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].ts >= ts) hi = m; else lo = m + 1; } return a.length - lo; };
const carry = (sid, ts) => 1.25 + 0.1 * later(sid, ts);   // cache write once + a re-read per later response

// ---------- per session ----------
const bySid = {};
for (const r of all) { const s = bySid[r.sid] = bySid[r.sid] || { main: [], sub: [] }; (r.sub ? s.sub : s.main).push(r); }
const promptsIn = sid => (mainEvents[sid] || []).filter(e => e.t === 'prompt' && e.ts >= since).length;
const sessions = Object.entries(bySid).map(([sid, s]) => {
  const m = sum(s.main), b = sum(s.sub);
  const peak = Math.max(0, ...s.main.map(r => r.inp + r.cr + r.cc));
  return { sid: sid.slice(0, 8), prompts: promptsIn(sid), mainResp: m.n, mainOut: m.out, mainCr: m.cr, subResp: b.n, subCr: b.cr, subOut: b.out, peakCtx: peak, cost: cost(m) + cost(b) };
}).filter(s => s.mainResp + s.subResp > 0).sort((a, b) => b.cost - a.cost);

// ---------- subagents ----------
const agentRows = {};
for (const r of subs) { const a = agentRows[r.agentKey] = agentRows[r.agentKey] || { key: r.agentKey, turns: 0, cr: 0, out: 0, prompt: (agents[r.agentKey] || {}).prompt || '' }; a.turns++; a.cr += r.cr; a.out += r.out; }
const agentList = Object.values(agentRows).sort((a, b) => b.cr - a.cr);
const longAgents = agentList.filter(a => a.turns > 100);

// ---------- hook (askai) overhead: injected tokens x carry ----------
const kindStats = {};
let hookTok = 0, hookUnits = 0;
for (const h of hookSegs) {
  if (h.ts < since) continue;
  const k = kindStats[h.kind] = kindStats[h.kind] || { n: 0, chars: 0, tokens: 0, units: 0 };
  const tok = h.chars / 4, u = tok * carry(h.sid, h.ts);
  k.n++; k.chars += h.chars; k.tokens += tok; k.units += u; hookTok += tok; hookUnits += u;
}

// ---------- scoping compliance, answer-length budget, tool volume per turn ----------
const turns = [];
for (const [sid, ev] of Object.entries(mainEvents)) {
  let t = null;
  const close = () => { if (t && t.ts >= since) turns.push(t); };
  for (const e of ev) {
    if (e.t === 'prompt') { close(); t = { sid, ts: e.ts, scope: false, asked: false, summary: false, budget: null, toolChars: 0, toolCarry: 0, texts: new Map(), order: [] }; }
    else if (!t) continue;
    else if (e.t === 'hook') { if (e.kinds.some(k => k.startsWith('scope'))) t.scope = true; if (e.kinds.includes('summary')) t.summary = true; }
    else if (e.t === 'ask' && /area|scope|answer length/i.test(e.q)) t.asked = true;
    else if (e.t === 'answer') { const b = e.s.match(/length[^"]*"="([\d,]+)\s*char/i); if (b) t.budget = parseInt(b[1].replace(/,/g, ''), 10); }
    else if (e.t === 'tool') { t.toolChars += e.chars; t.toolCarry += e.chars / 4 * carry(sid, e.ts); }
    else if (e.t === 'text' && e.chars) { t.texts.set(e.id, (t.texts.get(e.id) || 0) + e.chars); t.order = t.order.filter(x => x !== e.id).concat(e.id); }
  }
  close();
}
const finalChars = t => t.texts.get(t.order[t.order.length - 1]);
const eligible = turns.filter(t => t.scope), asked = eligible.filter(t => t.asked);
const budgeted = turns.filter(t => t.budget && t.order.length).map(t => ({ budget: t.budget, chars: finalChars(t) }));
const withinBudget = budgeted.filter(b => b.chars <= b.budget * 1.1);

// ---------- caveman: observational comparison by mode active at response time ----------
const cmp = { on: { textResp: [], out: [], final: [] }, off: { textResp: [], out: [], final: [] } };
for (const r of main) {
  const g = r.cave === 'none' ? cmp.off : cmp.on;
  g.out.push(r.out);
  if (r.textChars > 0) g.textResp.push(r.textChars);
}
for (const t of turns) {
  if (!t.order.length) continue;
  const rec = msgs.get(t.order[t.order.length - 1]);
  (rec && rec.cave !== 'none' ? cmp.on : cmp.off).final.push(finalChars(t));
}

// ---------- A/B arms (opt-in) ----------
function findAskaiDir(cwd) {
  for (let d = cwd; d && d !== path.dirname(d); d = path.dirname(d)) { const p = path.join(d, '.claude', 'askai'); if (fs.existsSync(p)) return p; }
  return null;
}
const askaiDirs = new Set(), arms = {};
for (const [sid, i] of Object.entries(sessInfo)) {
  if (!i.cwd) continue;
  const d = findAskaiDir(i.cwd); if (!d) continue;
  askaiDirs.add(d);
  const af = path.join(d, 'sessions', sid + '.arm.txt');
  if (fs.existsSync(af)) arms[sid] = fs.readFileSync(af, 'utf8').trim();
}
const armStats = {};
for (const [sid, arm] of Object.entries(arms)) {
  const s = bySid[sid]; if (!s) continue;
  const a = armStats[arm] = armStats[arm] || { sessions: 0, prompts: 0, out: 0, cr: 0, resp: 0, cost: 0 };
  const m = sum(s.main), b = sum(s.sub);
  a.sessions++; a.prompts += promptsIn(sid); a.out += m.out + b.out; a.cr += m.cr + b.cr; a.resp += m.n + b.n; a.cost += cost(m) + cost(b);
}
let abMeasured = null;
{
  const c = armStats.control, t = armStats.treatment;
  if (c && t && c.prompts && t.prompts) {
    const cp = c.cost / c.prompts, tp = t.cost / t.prompts;
    abMeasured = { per_prompt_control: cp, per_prompt_treatment: tp, saved_per_prompt: cp - tp, saved_total: (cp - tp) * t.prompts, saved_share: (cp - tp) / cp,
      sessions_control: c.sessions, sessions_treatment: t.sessions, trustworthy: Math.min(c.sessions, t.sessions) >= 8 };
  }
}

// ---------- checkpoints / clears ----------
const metrics = [];
for (const d of askaiDirs) {
  const mf = path.join(d, 'metrics.jsonl');
  if (!fs.existsSync(mf)) continue;
  for (const l of fs.readFileSync(mf, 'utf8').split('\n')) { try { const j = JSON.parse(l); if (Date.parse(j.ts) >= since) metrics.push(j); } catch { } }
}

// ---------- tool output volume ----------
const outBy = {};
for (const o of toolOut) if (o.ts >= since) { const x = outBy[o.name] = outBy[o.name] || { n: 0, chars: 0, max: 0 }; x.n++; x.chars += o.chars; x.max = Math.max(x.max, o.chars); }
const outList = Object.entries(outBy).sort((a, b) => b[1].chars - a[1].chars);

// ======================= TOKEN SAVINGS LEDGER =======================
const ledger = { saved: [], cost: [], avoided: [] };
const addSaved = (label, tokens, units, bucket, note, grp) => ledger.saved.push({ label, tokens, units, bucket, note, grp });
const ctxOf = r => r.inp + r.cr + r.cc;

// A1 caveman: visible reply text, caveman-on responses vs caveman-off responses (observational)
{
  const on = main.filter(r => r.cave !== 'none' && r.textChars > 0), off = cmp.off.textResp;
  const d = mean(off) - mean(on.map(r => r.textChars));
  if (on.length >= 20 && off.length >= 20 && d > 0) {
    addSaved('caveman terse replies', on.length * d / 4, on.reduce((a, r) => a + d / 4 * (6.25 + 0.1 * later(r.sid, r.ts)), 0), 'observed',
      `${on.length} on-responses average ${Math.round(mean(on.map(r => r.textChars)))} text chars vs ${Math.round(mean(off))} off (${Math.round(d)} fewer); different tasks, so correlation only`, 'reply');
  } else addSaved('caveman terse replies', 0, 0, 'none', `caveman-on ${on.length} responses avg ${on.length ? Math.round(mean(on.map(r => r.textChars))) : 'n/a'} text chars vs off ${off.length} avg ${off.length ? Math.round(mean(off)) : 'n/a'}; ${on.length < 20 || off.length < 20 ? 'too few responses in a group' : 'no reduction observed'}, 0 credited`, 'reply');
}
// A2 answer-length budget: final replies of budgeted turns vs final replies of turns with no budget (observational)
{
  const bt = turns.filter(t => t.budget && t.order.length), ub = turns.filter(t => !t.budget && t.order.length);
  const d = mean(ub.map(finalChars)) - mean(bt.map(finalChars));
  if (bt.length >= 5 && ub.length >= 5 && d > 0) {
    addSaved('answer-length budget', bt.length * d / 4, bt.reduce((a, t) => a + d / 4 * (6.25 + 0.1 * later(t.sid, (msgs.get(t.order[t.order.length - 1]) || t).ts)), 0), 'observed',
      `budgeted final replies average ${Math.round(mean(bt.map(finalChars)))} chars vs ${Math.round(mean(ub.map(finalChars)))} without a budget (n=${bt.length}/${ub.length}); overlaps caveman, counted once in NET`, 'reply');
  } else addSaved('answer-length budget', 0, 0, 'none', `budgeted final replies ${bt.length ? Math.round(mean(bt.map(finalChars))) : 'n/a'} chars vs ${ub.length ? Math.round(mean(ub.map(finalChars))) : 'n/a'} unbudgeted (n=${bt.length}/${ub.length}); no reduction or too few turns`, 'reply');
}
// A3/A4 tool volume per turn: scoped vs not, feature-summary vs not (observational)
function cmpTurns(label, withT, withoutT, what) {
  if (withT.length < 5 || withoutT.length < 5) return addSaved(label, 0, 0, 'none', `too few turns (${withT.length} with / ${withoutT.length} without) to compare`);
  const a = mean(withT.map(t => t.toolChars)) / 4, b = mean(withoutT.map(t => t.toolChars)) / 4;
  // task mix differs between the groups (heavy-tailed tool output), so this is shown but never credited; only the A/B can attribute it
  addSaved(label, 0, 0, 'none', `${what}: ${fmt(a)} tool-output tokens/turn with vs ${fmt(b)} without (n=${withT.length}/${withoutT.length}); comparison only, 0 credited (task mix differs -- the A/B is the test)`);
}
cmpTurns('scoping question (area limit)', asked, eligible.filter(t => !t.asked), 'asked turns');
cmpTurns('feature-summary injection', turns.filter(t => t.summary), turns.filter(t => !t.summary), 'summary turns');

// A5 skill name-only overrides: descriptions dropped from the skill listing that rides in every main-session context (computed)
function findSkillMd(name) {
  const bare = name.replace(/^[^:]*:/, '');
  const cands = [path.join(os.homedir(), '.claude', 'skills', bare, 'SKILL.md')];
  const base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'local-agent-mode-sessions', 'skills-plugin');
  try { for (const a of fs.readdirSync(base)) for (const b of fs.readdirSync(path.join(base, a))) cands.push(path.join(base, a, b, 'skills', bare, 'SKILL.md')); } catch { }
  return cands.find(p => fs.existsSync(p));
}
function descChars(file) {
  const t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const fm = (t.match(/^---\n([\s\S]*?)\n---/) || [])[1]; if (!fm) return 0;
  const m = ('\n' + fm).match(/\ndescription:[ \t]*([\s\S]*?)(?=\n[A-Za-z_-]+:|$)/); if (!m) return 0;
  return m[1].replace(/^[>|][+-]?\s*/, '').replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim().length;
}
const userSettings = readJson(path.join(os.homedir(), '.claude', 'settings.json')) || {};
const projSettings = [];
for (const i of Object.values(sessInfo)) if (i.cwd) for (const n of ['settings.json', 'settings.local.json']) { const s = readJson(path.join(i.cwd, '.claude', n)); if (s && !projSettings.includes(s)) projSettings.push(s); }
{
  const so = userSettings.skillOverrides || {};
  const names = Array.isArray(so) ? so : Object.entries(so).filter(([, v]) => v === 'name-only').map(([k]) => k);
  const found = names.map(n => ({ n, f: findSkillMd(n) })).filter(x => x.f).map(x => ({ n: x.n, ch: descChars(x.f) }));
  const descTok = found.reduce((a, x) => a + x.ch, 0) / 4;
  let tok = 0, units = 0;
  for (const [sid, s] of Object.entries(bySid)) if (s.main.length) { tok += descTok; units += descTok * ((sessInfo[sid].first >= since ? 1.25 : 0) + 0.1 * s.main.length); }
  if (names.length) addSaved(`skill name-only overrides (${found.length}/${names.length} measurable)`, tok, units, 'computed',
    `${fmt(descTok)} description tokens dropped from the skill list per session x ${Object.values(bySid).filter(s => s.main.length).length} sessions; ${names.length - found.length} skills are built-in (no file to measure) so this is a floor`);
  else addSaved('skill name-only overrides', 0, 0, 'none', 'none configured');
}
// A6 clear_session cycles: context dropped x re-reads avoided (observational; assumes the old context would have been kept)
{
  let tok = 0, units = 0, tracked = 0;
  const cc = clearCalls.filter(c => c.ts >= since);
  for (const c of cc) {
    const arr = mainBySid[c.sid] || [], pre = [...arr].reverse().find(r => r.ts <= c.ts), post = arr.filter(r => r.ts > c.ts);
    if (pre && post.length) { const drop = ctxOf(pre) - ctxOf(post[0]); if (drop > 0) { tracked++; tok += drop; units += 0.1 * drop * post.length; } }
  }
  addSaved('checkpoint + clear_session cycle', tok, units, tracked ? 'observed' : 'none', `${cc.length} clear call(s), ${metrics.length} metrics row(s); ${tracked} traceable into a continuation in the same session${tracked ? '' : ' (0 credited)'}`);
}
// A7 compaction (autoCompactWindow): shown for reference, never credited (compaction happens regardless of askai)
{
  const cs = compactions.filter(c => c.ts >= since);
  let tok = 0;
  for (const c of cs) if (c.pre > c.post) tok += c.pre - c.post;
  const auto = cs.filter(c => c.trigger === 'auto').length;
  addSaved(`context compaction${userSettings.autoCompactWindow ? ' (autoCompactWindow ' + fmt(userSettings.autoCompactWindow) + ')' : ''}`, 0, 0, 'none',
    `${cs.length} compaction(s) in window (${auto} auto, ${cs.length - auto} manual); ${cs.length ? 'typically at ' + fmt(median(cs.map(c => c.pre))) + ' context tokens, ' : ''}freed ${fmt(tok)} context tokens in total. Not credited: Claude Code compacts regardless of askai, and the gain from the window setting vs its default is not separable`);
}
// info rows (no number credited)
const capCfg = [userSettings, ...projSettings].map(s => s.bashOutputMaxChars).filter(Boolean);
const capChars = capCfg.length ? Math.min(...capCfg) : null;
const nearCap = capChars ? toolOut.filter(o => o.ts >= since && (o.name === 'Bash' || /Task|Bash/.test(o.name)) && o.chars >= capChars * 0.93).length : 0;
const infoRows = [];
if (capChars) infoRows.push(`tool-output cap (${fmt(capChars)} chars): ${nearCap} Bash/Task results at the cap; the cut-off amount is not recorded in transcripts, so 0 credited`);
const nAgentsMain = Object.values(agentTypes).reduce((a, b) => a + b, 0);
infoRows.push(`Explore/subagent delegation: ${nAgentsMain} agent launches (${Object.entries(agentTypes).map(([k, v]) => k + ' x' + v).join(', ') || 'none'}); keeps their tool output out of the main context but has no baseline, 0 credited`);
const skillList = Object.entries(skillCalls).sort((a, b) => b[1] - a[1]);
infoRows.push(`skills invoked: ${skillList.length ? skillList.map(([k, v]) => k + ' x' + v).join(', ') : 'none'} (a name-only skill still loads fully when invoked)`);

// B cost: hook text carried in context + the marginal API call of each AskUserQuestion round-trip
for (const [k, v] of Object.entries(kindStats).sort((a, b) => b[1].units - a[1].units)) ledger.cost.push({ label: 'hook: ' + k + ' x' + v.n, tokens: v.tokens, units: v.units });
const askResp = main.filter(r => r.tools.includes('AskUserQuestion'));
const askUnits = askResp.reduce((a, r) => a + cost(r), 0);
ledger.cost.push({ label: 'AskUserQuestion calls x' + askResp.length + ' (extra API call each)', tokens: askResp.reduce((a, r) => a + r.out, 0), units: askUnits });
const costUnits = hookUnits + askUnits;

// C overhead already avoided by send-once / short-pointer design (vs re-injecting the full text every prompt); not part of NET
function avoidedOnce(kind) {
  let tok = 0, units = 0; const per = {};
  for (const h of hookSegs) if (h.kind === kind && h.ts >= since) (per[h.sid] = per[h.sid] || []).push(h);
  for (const [sid, hs] of Object.entries(per)) {
    const first = Math.min(...hs.map(h => h.ts));
    const ps = (mainEvents[sid] || []).filter(e => e.t === 'prompt' && e.ts > first && e.ts >= since);
    const extra = Math.max(0, ps.length - (hs.length - 1)); if (!extra) continue;
    const avg = mean(hs.map(h => h.chars / 4));
    tok += extra * avg; units += extra * avg * mean(ps.map(p => carry(sid, p.ts)));
  }
  return { tok, units };
}
{
  const fullChars = mean(hookSegs.filter(h => h.kind === 'scope-full').map(h => h.chars));
  let tok = 0, units = 0;
  for (const h of hookSegs) if (h.kind === 'scope-short' && h.ts >= since && fullChars > h.chars) { const d = (fullChars - h.chars) / 4; tok += d; units += d * carry(h.sid, h.ts); }
  ledger.avoided.push({ label: 'scoping: short pointer instead of full block', tokens: tok, units });
  for (const k of ['caveman', 'summary']) { const a = avoidedOnce(k); ledger.avoided.push({ label: k + ': once per session, not every prompt', tokens: a.tok, units: a.units }); }
}

// NET
const savedBy = b => ledger.saved.filter(r => r.bucket === b);
const compTok = savedBy('computed').reduce((a, r) => a + r.tokens, 0), compU = savedBy('computed').reduce((a, r) => a + r.units, 0);
const obs = savedBy('observed'), obsReply = obs.filter(r => r.grp === 'reply'), obsOther = obs.filter(r => r.grp !== 'reply');
const obsU = Math.max(0, ...obsReply.map(r => r.units)) + obsOther.reduce((a, r) => a + r.units, 0);
const obsTok = Math.max(0, ...obsReply.map(r => r.tokens)) + obsOther.reduce((a, r) => a + r.tokens, 0);
const net = { computed_units: compU - costUnits, all_units: compU + obsU - costUnits, share_computed: (compU - costUnits) / (cost(T) || 1), share_all: (compU + obsU - costUnits) / (cost(T) || 1) };

// ---------- output ----------
const R = {
  window_hours: hours, responses: T.n, main_sessions: sessions.filter(s => s.mainResp).length,
  totals: { out: T.out, cache_read: T.cr, cache_create: T.cc, uncached_in: T.inp, cost_units: cost(T) },
  main: M, sub: S, sub_share_of_cost: cost(S) / (cost(T) || 1),
  ledger: { saved: ledger.saved, cost: ledger.cost, avoided_by_design: ledger.avoided, info: infoRows,
    totals: { computed_saved_tokens: compTok, computed_saved_units: compU, observed_saved_tokens: obsTok, observed_saved_units: obsU, askai_cost_units: costUnits, askai_hook_tokens: hookTok, net }, ab_measured: abMeasured },
  askai: { hook_injections: kindStats, scoping: { eligible: eligible.length, asked: asked.length }, budget: { measured: budgeted.length, within: withinBudget.length },
    checkpoint_metrics: metrics.length, clear_calls: clearCalls.filter(c => c.ts >= since).length },
  caveman: { on: { responses: cmp.on.out.length, mean_text_chars: mean(cmp.on.textResp), mean_out_tokens: mean(cmp.on.out), mean_final_chars: mean(cmp.on.final) },
    off: { responses: cmp.off.out.length, mean_text_chars: mean(cmp.off.textResp), mean_out_tokens: mean(cmp.off.out), mean_final_chars: mean(cmp.off.final) } },
  ab: armStats,
};
if (asJson) { console.log(JSON.stringify(R, null, 2)); process.exit(0); }

const L = [];
const row = (...c) => L.push(c.join(''));
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
L.push(`askai / caveman / subagent report -- last ${hours}h  (${files.length} transcript files, ${T.n} responses, ${R.main_sessions} main sessions)`);
L.push('Relative cost units = input + 1.25*cache_create + 0.1*cache_read + 5*output (input token = 1); estimates, not billing.', '');

L.push('TOKEN SAVINGS LEDGER  (what askai, its plugins and the settings saved vs what they cost)');
L.push('  tokens = raw tokens kept out of output/context; units = cost-weighted (write 1.25, re-read 0.1 per later response, output 5).');
L.push('  Evidence: MEASURED = A/B arms | COMPUTED = exact config arithmetic | OBSERVED = on/off comparison, confounded (not proof) | none = unmeasurable.', '');
const lrow = (label, tok, u, ev) => row('    ', pad(label, 50), lpad(fmt(tok), 8), lpad(fmt(u), 9), '  ', ev);
L.push('  A. SAVED' + ' '.repeat(45) + lpad('tokens', 8) + lpad('units', 9) + '  evidence');
for (const r of ledger.saved) { lrow(r.label, r.tokens, r.units, r.bucket.toUpperCase()); L.push('        ' + r.note); }
for (const s of infoRows) L.push('    - ' + s);
L.push('');
L.push('  B. COST OF ASKAI' + ' '.repeat(37) + lpad('tokens', 8) + lpad('units', 9));
for (const r of ledger.cost) lrow(r.label, r.tokens, r.units, '');
L.push('        AskUserQuestion counts every ask in main sessions (scoping, checkpoint confirms, any other). Excludes agent work the hooks trigger (file writes, get_usage, metrics lines), so cost is a floor.');
L.push('');
L.push('  C. OVERHEAD ALREADY AVOIDED BY DESIGN (not part of NET; B would have been this much larger)');
for (const r of ledger.avoided) lrow(r.label, r.tokens, r.units, '');
L.push('');
L.push(`  NET  computed only:               ${sfmt(compU)} saved - ${fmt(costUnits)} cost = ${sfmt(compU - costUnits)} units (${(100 * net.share_computed).toFixed(2)}% of total spend)`);
L.push(`  NET  incl. observed estimates:    ${sfmt(compU + obsU)} saved - ${fmt(costUnits)} cost = ${sfmt(compU + obsU - costUnits)} units (${(100 * net.share_all).toFixed(2)}% of total spend; reply-length rows counted once)`);
if (abMeasured) L.push(`  MEASURED A/B (caveman + scoping): control ${fmt(abMeasured.per_prompt_control)} vs treatment ${fmt(abMeasured.per_prompt_treatment)} units/prompt -> ${sfmt(abMeasured.saved_per_prompt)}/prompt (${(100 * abMeasured.saved_share).toFixed(1)}%), ${sfmt(abMeasured.saved_total)} units over ${armStats.treatment.prompts} treatment prompts; ${abMeasured.sessions_control}/${abMeasured.sessions_treatment} sessions${abMeasured.trustworthy ? '' : ' -- too few sessions to trust (need >=8 per arm)'}.`);
else L.push('  MEASURED A/B: none yet -- no proven savings. Put "on" in .claude/askai/ab.txt (or ~/.claude/askai-ab.txt) to start it for new sessions.');
L.push('');

L.push('1. WHERE TOKENS WENT');
L.push(pad('', 14) + lpad('responses', 10) + lpad('output', 10) + lpad('cache_read', 12) + lpad('cache_create', 13) + lpad('cost units', 12) + lpad('share', 8));
for (const [n, s] of [['main', M], ['subagents', S], ['total', T]]) row(pad(n, 14), lpad(s.n, 10), lpad(fmt(s.out), 10), lpad(fmt(s.cr), 12), lpad(fmt(s.cc), 13), lpad(fmt(cost(s)), 12), lpad(pct(cost(s), cost(T)), 8));
L.push('');
L.push('Top sessions by cost (main + their subagents):');
L.push(pad('  session', 11) + lpad('prompts', 8) + lpad('main resp', 10) + lpad('main out', 10) + lpad('sub resp', 9) + lpad('sub cr', 9) + lpad('peak ctx', 10) + lpad('cost', 9));
for (const s of sessions.slice(0, 6)) row('  ' + pad(s.sid, 9), lpad(s.prompts, 8), lpad(s.mainResp, 10), lpad(fmt(s.mainOut), 10), lpad(s.subResp, 9), lpad(fmt(s.subCr), 9), lpad(fmt(s.peakCtx), 10), lpad(fmt(s.cost), 9));
L.push('');
L.push(`Subagents: ${agentList.length} agents, ${S.n} turns; ${longAgents.length} ran >100 turns. Heaviest:`);
for (const a of agentList.slice(0, 5)) L.push(`  ${a.key.slice(0, 14)}  ${lpad(a.turns, 4)} turns  cache_read ${lpad(fmt(a.cr), 7)}  out ${lpad(fmt(a.out), 6)}  "${a.prompt}"`);
L.push('');

L.push('2. ASKAI OVERHEAD (hook text injected into context)');
L.push(pad('  kind', 16) + lpad('times', 7) + lpad('chars', 9) + lpad('~tokens', 9) + lpad('cost units*', 13));
for (const [k, v] of Object.entries(kindStats).sort((a, b) => b[1].units - a[1].units)) row('  ' + pad(k, 14), lpad(v.n, 7), lpad(fmt(v.chars), 9), lpad(fmt(v.tokens), 9), lpad(fmt(v.units), 13));
L.push(`  * units = tokens x (1.25 cache write + 0.1 x later responses in that session); ignores compaction/clears, so a slight overestimate.`);
L.push(`  Total ~${fmt(hookTok)} tokens = ${fmt(hookUnits)} units = ${pct(hookUnits, cost(T))} of total cost units (${pct(hookUnits, cost(M))} of main-session cost).`);
const multiFull = Object.entries(hookSegs.filter(h => h.ts >= since && h.kind === 'scope-full').reduce((a, h) => (a[h.sid] = (a[h.sid] || 0) + 1, a), {})).filter(([, n]) => n > 2);
if (multiFull.length) L.push(`  Full scoping block re-sent >2x in ${multiFull.length} session(s) (${multiFull.map(([k, n]) => k.slice(0, 8) + ' x' + n).join(', ')}): sessions started on an older hook version (full block every prompt) or post-compaction.`);
L.push('');

L.push('3. ASKAI BEHAVIOUR');
L.push(`  Prompts that received the scoping reminder: ${eligible.length}; AskUserQuestion scoping asked: ${asked.length} (${pct(asked.length, eligible.length)}; follow-ups are meant to skip, so <100% is expected).`);
L.push(`  Answer-length budget set on ${budgeted.length} turns; final reply within budget (+10%): ${withinBudget.length} (${pct(withinBudget.length, budgeted.length)}).` + (budgeted.length ? ` Median reply/budget = ${(median(budgeted.map(b => b.chars / b.budget))).toFixed(2)}.` : ''));
const nk = k => (kindStats[k] || { n: 0 }).n;
L.push(`  Triggers fired: ${nk('checkpoint')} checkpoint reminders (v2: volume-note and pending-clear retired).  Completed cycle: ${metrics.length} metrics lines, ${R.askai.clear_calls} clear_session calls.` + (metrics.length ? ` Context at checkpoint: ${metrics.map(m => (m.tokens_used != null ? Math.round(m.tokens_used/1000) + 'K' : (m.percent_used ?? '?') + '%')).join(', ')}.` : ''));
L.push('');

L.push('4. CAVEMAN (observational: responses grouped by whether caveman mode was active when produced)');
L.push(pad('', 16) + lpad('responses', 10) + lpad('text chars/resp', 17) + lpad('out tokens/resp', 17) + lpad('final reply chars', 19));
for (const [n, g] of [['caveman on', cmp.on], ['caveman off', cmp.off]]) row(pad('  ' + n, 16), lpad(g.out.length, 10), lpad(Math.round(mean(g.textResp)), 17), lpad(Math.round(mean(g.out)), 17), lpad(Math.round(mean(g.final)), 19));
if (cmp.on.out.length > 20 && cmp.off.out.length > 20 && mean(cmp.off.final) && mean(cmp.on.final)) L.push(`  Final replies with caveman on are ${(100 * (1 - mean(cmp.on.final) / mean(cmp.off.final))).toFixed(0)}% shorter than off (different tasks/sessions -> correlation only; needs the A/B for proof).`);
else L.push('  Too few responses in one group to compare; widen --hours.');
L.push('');

L.push('5. A/B ARMS (askai/ab.txt = on: control sessions skip caveman + scoping reminder)');
if (Object.keys(armStats).length < 2) L.push('  No two-arm data yet. Enable with: "on" in .claude/askai/ab.txt (or ~/.claude/askai-ab.txt); new sessions get a sticky random arm.');
else {
  L.push(pad('  arm', 12) + lpad('sessions', 9) + lpad('prompts', 8) + lpad('out/prompt', 11) + lpad('cost/prompt', 12) + lpad('resp/prompt', 12));
  for (const [arm, a] of Object.entries(armStats)) row('  ' + pad(arm, 10), lpad(a.sessions, 9), lpad(a.prompts, 8), lpad(fmt(a.out / (a.prompts || 1)), 11), lpad(fmt(a.cost / (a.prompts || 1)), 12), lpad((a.resp / (a.prompts || 1)).toFixed(1), 12));
}
L.push('');

L.push('6. TOOL OUTPUT VOLUME (chars returned into context)');
for (const [n, v] of outList.slice(0, 6)) L.push(`  ${pad(n, 22)} ${lpad(v.n, 5)} calls  ${lpad(fmt(v.chars), 8)} chars  largest ${fmt(v.max)}`);
L.push('');

L.push('VERDICT');
L.push(`  - Tokens saved (units): computed ${sfmt(compU)}${compU ? '' : ' (nothing computable beyond config)'}, observed-but-unproven ${sfmt(obsU)}; askai cost ${fmt(costUnits)}; NET ${sfmt(compU - costUnits)} computed / ${sfmt(compU + obsU - costUnits)} incl. observed = ${(100 * net.share_all).toFixed(2)}% of ${fmt(cost(T))} total spend.`);
L.push(net.all_units < 0 ? '  - On this evidence askai + caveman cost more than they saved; the savings that exist are too small to see against total spend.' : '  - Savings exceed cost only if the observed (confounded) rows are real; the A/B is the only proof.');
L.push(`  - Subagents = ${pct(cost(S), cost(T))} of cost units; ${longAgents.length} of ${agentList.length} agents ran >100 turns (${pct(longAgents.reduce((a, x) => a + x.cr * 0.1 + x.out * 5, 0), cost(S))} of subagent cost). Biggest lever.`);
L.push(`  - Scoping asked on ${asked.length}/${eligible.length} eligible prompts; answer budgets respected ${pct(withinBudget.length, budgeted.length)}.`);
L.push(abMeasured ? `  - A/B data present: measured saving ${sfmt(abMeasured.saved_per_prompt)} units/prompt (${(100 * abMeasured.saved_share).toFixed(1)}%)${abMeasured.trustworthy ? '' : ', too few sessions to trust yet'}.` : '  - No proven savings: enable the A/B (section 5) to get a baseline.');
console.log(L.join('\n'));
'@
[System.IO.File]::WriteAllText((Join-Path $hooksDir 'askai-report.js'), (($askaiReportJs -replace "`r`n", "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Installed: $hooksDir\askai-report.js"

$askaiReportMd = @'
---
description: Token savings report for askai + caveman + settings - tokens saved per feature vs askai's own cost, plus where tokens went, hook overhead, caveman on/off, A/B arms. Args: hours (default 6).
argument-hint: [hours]
allowed-tools: Bash(node:*)
---

Run `node "$HOME/.claude/hooks/askai-report.js" --hours <N>` with N = `$ARGUMENTS` (a number of hours; default 6 if empty). Use the Bash tool. On Windows use `node "%USERPROFILE%\.claude\hooks\askai-report.js"` if `$HOME` is not set.

The script's first block is the TOKEN SAVINGS LEDGER: tokens saved per feature (A), askai's own cost (B), overhead avoided by design (C) and NET. Every row carries an evidence label: MEASURED (A/B arms), COMPUTED (config arithmetic), OBSERVED (on/off comparison, correlation only), none (unmeasurable, 0 credited).

Then reply with:
1. The ledger's A/B/NET lines and the VERDICT block from the script output, verbatim.
2. At most 3 bullets of what to change next, ranked by measured cost share. Only claim savings the report actually supports; OBSERVED rows are correlation, not proof, and say so.
3. If the MEASURED A/B line says "none yet", add one line: put `on` in `<project>/.claude/askai/ab.txt` (or `~/.claude/askai-ab.txt`) to start a random per-session control/treatment split for NEW sessions.

Do not recompute or re-round the script's numbers. Do not edit any files. For a cumulative view, pass 168 (7 days) or 720 (30 days) as the hours argument.
'@
Set-Content -Path (Join-Path $commandsDir 'askai-report.md') -Value $askaiReportMd -Encoding utf8
Write-Host "Installed: $commandsDir\askai-report.md"

# ============================================================================
# 3. merge hook registrations + autoCompact tuning into settings.json
# ============================================================================
$hookScriptPath = Join-Path $hooksDir 'askai.ps1'

$preToolUseMatcher = 'Agent|Task'

function New-HookGroup([string]$eventName) {
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$hookScriptPath`" -Event $eventName"
    $group = [pscustomobject]@{
        hooks = @(
            [pscustomobject]@{
                type          = 'command'
                command       = $cmd
                timeout       = if ($eventName -eq 'PreCompact') { 20 } elseif ($eventName -eq 'PreToolUse') { 10 } else { 15 }
                statusMessage = 'askai'
            }
        )
    }
    if ($eventName -eq 'PreToolUse') {
        # Agent launches only -- the subagent-budget guard denies (once) an Agent call that lacks tool-call and reply-size limits
        $group | Add-Member -MemberType NoteProperty -Name 'matcher' -Value $preToolUseMatcher
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

foreach ($eventName in @('UserPromptSubmit', 'PreToolUse', 'PreCompact')) {
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

# v2 retired the PostToolUse hook (it cost a PowerShell spawn per tool call). Drop askai's own old
# registration on re-run; other tools' PostToolUse hooks are left alone.
if ($settings.hooks.PSObject.Properties.Name -contains 'PostToolUse') {
    $kept = @(); $removed = $false
    foreach ($group in @($settings.hooks.PostToolUse)) {
        $rest = @($group.hooks | Where-Object { -not ($_.command -and $_.command -like '*askai.ps1*-Event PostToolUse*') })
        if ($rest.Count -eq @($group.hooks).Count) { $kept += $group }
        else { $removed = $true; if ($rest.Count -gt 0) { $group.hooks = $rest; $kept += $group } }
    }
    if ($removed) {
        if ($kept.Count -eq 0) { $settings.hooks.PSObject.Properties.Remove('PostToolUse') }
        else { $settings.hooks.PostToolUse = $kept }
        Write-Host "Removed retired askai PostToolUse hook registration"
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

# subagents were ~70% of spend: default them to sonnet unless a call or agent definition names a model
# (a per-call `model`, e.g. haiku for Explore, still wins). Only set when absent.
if (-not ($settings.PSObject.Properties.Name -contains 'env')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'env' -Value ([pscustomobject]@{})
}
if (-not ($settings.env.PSObject.Properties.Name -contains 'CLAUDE_CODE_SUBAGENT_MODEL')) {
    $settings.env | Add-Member -MemberType NoteProperty -Name 'CLAUDE_CODE_SUBAGENT_MODEL' -Value 'sonnet'
    Write-Host "Set env.CLAUDE_CODE_SUBAGENT_MODEL = sonnet"
}

# skill listing trim -- plugin skills (anthropic-skills:*) ignore skillOverrides, so only bundled/user skills are listed.
# only skills unrelated to code/book-writing work, set to name-only
# (name stays visible and still invocable, just the description is dropped from every turn's context).
# Only ADDS missing entries -- never overrides a value you've already set for a given skill.
$defaultSkillTrim = [ordered]@{
    'keybindings-help'                     = 'name-only'
    'artifact-design'                      = 'name-only'
    'artifact-diagramming'                 = 'name-only'
    'artifact-capabilities'                = 'name-only'
    'claude-api'                           = 'name-only'
    'dataviz'                              = 'name-only'
    'workflow-authoring'                   = 'name-only'
    'loop'                                 = 'name-only'
    'schedule'                             = 'name-only'
    'fewer-permission-prompts'             = 'name-only'
    'init'                                 = 'name-only'
    'security-review'                      = 'name-only'
    'simplify'                             = 'name-only'
    'run'                                  = 'name-only'
    'update-config'                        = 'name-only'
    'code-review'                          = 'name-only'
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

2. Optionally create .claude/askai/context-guard.txt containing a token count
   (default 120000 if absent, range 20000-2000000) -- past it the hook nudges you
   to start a fresh session, again every +40K.

3. Optionally add to that project's .claude/settings.json:
     { "bashOutputMaxChars": 15000, "effortLevel": "medium" }
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
