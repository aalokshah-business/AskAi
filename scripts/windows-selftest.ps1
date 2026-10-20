<#
.SYNOPSIS
  Windows self-test for AskAI. Runs the real install.ps1 into a temporary folder, so your own Claude Code, Codex,
  Antigravity and Cursor settings are never touched, then prints a summary to paste back.

    powershell -ExecutionPolicy Bypass -File .\scripts\windows-selftest.ps1

  Steps: checksums; install.ps1 -DryRun (must write nothing); install, askai check, uninstall (must leave nothing);
  the automated tests. The temporary folder is deleted at the end.
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$ps1 = Join-Path $root 'install.ps1'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('askai-selftest-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$homes = @{ ClaudeHome = (Join-Path $tmp '.claude'); CodexHome = (Join-Path $tmp '.codex'); AgyHome = (Join-Path $tmp '.gemini'); CursorHome = (Join-Path $tmp '.cursor') }
foreach ($d in $homes.Values) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
New-Item -ItemType Directory -Path (Join-Path $homes.AgyHome 'antigravity-cli') -Force | Out-Null
$flags = @('--claude-home', $homes.ClaudeHome, '--codex-home', $homes.CodexHome, '--agy-home', $homes.AgyHome, '--cursor-home', $homes.CursorHome)
$summary = New-Object System.Collections.Generic.List[string]
function Note($line) { $summary.Add($line); Write-Host $line }
function Count-Files { (Get-ChildItem -Recurse -File $tmp -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\askai\\' } | Measure-Object).Count }

Note "AskAI Windows self-test: PowerShell $($PSVersionTable.PSVersion), $([Environment]::OSVersion.VersionString)"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Note 'FAIL  node not found: winget install OpenJS.NodeJS.LTS, then re-run'; exit 1 }
Note "node $(& node --version)"

# 1. Checksums
$bad = 0
Get-Content (Join-Path $root 'SHA256SUMS.txt') | ForEach-Object {
  $h, $f = $_ -split '\s+', 2; $p = Join-Path $root $f
  if (-not (Test-Path $p) -or (Get-FileHash $p -Algorithm SHA256).Hash -ne $h.ToUpper()) { $bad++; Write-Host "  mismatch: $f" } }
Note "1. checksums: $(if ($bad) { "FAIL ($bad files differ; re-download, do not open files before checking)" } else { 'ok' })"

# 2. Preview: install.ps1 -DryRun for all four tools
$before = Count-Files
& $ps1 -DryRun -Yes -Target all @homes
$code = $LASTEXITCODE; $after = Count-Files
Note "2. install.ps1 -DryRun: exit $code, files written $($after - $before) $(if ($code -eq 0 -and $after -eq $before) { '(ok)' } else { '(FAIL)' })"

# 3. Install into the temporary folder (minimal profile; Claude Code CLI itself is not installed), check, uninstall
& $ps1 -Yes -Target all -Workflow minimal -Skip claude -NoPath @homes
$code = $LASTEXITCODE
Note "3a. install.ps1: exit $code $(if ($code -eq 0) { '(ok)' } else { '(FAIL)' })"
$check = & node (Join-Path $root 'askai.js') check @flags 2>&1 | Select-Object -Last 1
Note "3b. askai check: $check"
& node (Join-Path $root 'askai.js') uninstall --yes @flags | Out-Null
$code = $LASTEXITCODE
$left = (Get-ChildItem -Recurse -File $tmp -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\askai\\' } | Select-String -Pattern 'askai' -List | Measure-Object).Count
Note "3c. askai uninstall: exit $code, files still mentioning askai: $left $(if ($code -eq 0 -and $left -eq 0) { '(ok)' } else { '(FAIL)' })"

# 4. Automated tests (2 report tests need real Claude Code transcripts; the preview-matrix test needs bash and is skipped)
Push-Location $root
$out = & node --test 2>&1
Pop-Location
$pass = ($out | Select-String '^# pass (\d+)').Matches.Groups[1].Value
$fail = ($out | Select-String '^# fail (\d+)').Matches.Groups[1].Value
Note "4. tests: $pass passed, $fail failed (2 failures expected: they need real Claude Code transcripts)"
$out | Select-String '^not ok' | ForEach-Object { Note "   $($_.Line)" }

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host "`n===== paste everything below this line ====="
$summary | ForEach-Object { Write-Host $_ }
