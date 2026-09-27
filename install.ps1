<#
.SYNOPSIS
  One-command setup of askai on Windows: makes sure Node.js is present, then runs `askai.js`, which installs and wires up
  RTK, Context Mode, Serena and a terse-output block for Claude Code and, when it is present, Cursor. The set of tools
  follows the kind of work (-Workflow).

.DESCRIPTION
  Run from a checkout of this repo:

    powershell -ExecutionPolicy Bypass -File .\install.ps1
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Workflow docs
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action suggest -Path C:\work\my-project

  Safe to re-run: components that already look healthy are skipped. Nothing is written to Claude Code's or Cursor's
  config without a timestamped backup first (~/.claude/askai/backups). Use -DryRun to see the plan without changing anything.

.PARAMETER Yes            Do not ask for confirmation (also skips the Node.js prompt).
.PARAMETER DryRun         Show what would happen; nothing is installed or written.
.PARAMETER Workflow       Kind of work: minimal | coding (default) | docs | full. Alias: -Profile.
.PARAMETER Target         Where to wire the tools: auto (default: Claude Code, plus Cursor when installed) | claude | cursor | both.
.PARAMETER Markitdown     Add markitdown (PDF and Office files to Markdown) to the workflow.
.PARAMETER Ccusage        Add ccusage (third-party usage report) to the workflow.
.PARAMETER Only           Comma-separated components: claude,baseline,rtk,context-mode,serena,markitdown,ccusage,caveman,caveman-plugin,rules,statusline,cursor-rtk,cursor-context-mode,cursor-serena
.PARAMETER Skip           Comma-separated components to skip.
.PARAMETER NoPath         Do not add the `askai` command to the user PATH.
.PARAMETER Caveman        Terse-output level in the CLAUDE.md block and the Cursor rules: lite | full | ultra | off (default full).
.PARAMETER ClaudeHome     Use this folder instead of ~/.claude (testing aid).
.PARAMETER CursorHome     Use this folder instead of ~/.cursor (testing aid; RTK's own Cursor init may still write to the real one).
.PARAMETER NoStatusline   Do not set Claude Code's status line.
.PARAMETER CavemanPlugin  Also install the Caveman plugin (adds its own hooks; off by default).
.PARAMETER Tools          uninstall: also remove the tools askai installed (winget, uv, npm).
.PARAMETER Force          Re-run components that already look fine; uninstall: also remove things askai did not add.
.PARAMETER Path           Project folder for -Action suggest | project.
.PARAMETER Print          With -Action project: show the Cursor rules instead of writing them.
.PARAMETER Remove         With -Action project: delete the Cursor rules askai wrote.
.PARAMETER Action         install (default) | update | status | doctor | report | profiles | suggest | project | restore | uninstall
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$DryRun,
  [Alias('Profile')][ValidateSet('minimal', 'coding', 'docs', 'full')][string]$Workflow,
  [ValidateSet('auto', 'claude', 'cursor', 'both')][string]$Target,
  [switch]$Markitdown,
  [switch]$Ccusage,
  [string]$Only,
  [string]$Skip,
  [switch]$NoPath,
  [ValidateSet('lite', 'full', 'ultra', 'off')][string]$Caveman,
  [string]$ClaudeHome,
  [string]$CursorHome,
  [switch]$NoStatusline,
  [switch]$CavemanPlugin,
  [switch]$Tools,
  [switch]$Force,
  [string]$Path,
  [switch]$Print,
  [switch]$Remove,
  [ValidateSet('install', 'update', 'status', 'doctor', 'report', 'profiles', 'suggest', 'project', 'restore', 'uninstall')][string]$Action = 'install'
)

$ErrorActionPreference = 'Stop'
$MinNode = [version]'22.5.0'   # Context Mode needs this; askai itself runs on Node 18+

function Update-SessionPath {
  # Re-read PATH from the registry so a tool installed a moment ago (winget) is visible in this same run.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $seen = @{}
  $parts = @()
  foreach ($p in (@($env:Path, $machine, $user) -join ';').Split(';')) {
    if ($p -and -not $seen.ContainsKey($p.ToLowerInvariant())) { $seen[$p.ToLowerInvariant()] = $true; $parts += $p }
  }
  $env:Path = $parts -join ';'
}

function Get-NodeVersion {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  $out = & $cmd.Source --version 2>$null
  if ($out -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]("$($Matches[1]).$($Matches[2]).$($Matches[3])") }
  return $null
}

function Confirm-Step([string]$Message) {
  if ($Yes -or $DryRun) { return $true }
  try { $a = Read-Host "$Message [y/N]" } catch { return $false }
  return ($a -match '^(y|yes)$')
}

function Install-Node {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget was not found. Install "App Installer" from the Microsoft Store (or install Node.js LTS from nodejs.org), then re-run this script.'
  }
  Write-Host '  > winget install --id OpenJS.NodeJS.LTS'
  & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  Update-SessionPath
}

$nodeVersion = Get-NodeVersion
if (-not $nodeVersion) {
  Write-Host 'Node.js is not installed. askai needs it (LTS 22.5+).'
  if ($DryRun) {
    Write-Host '[dry-run] would install Node.js LTS with: winget install --id OpenJS.NodeJS.LTS'
    Write-Host '[dry-run] then run askai.js. Re-run with -DryRun after Node.js is installed to see the full component plan.'
    exit 0
  }
  if (-not (Confirm-Step 'Install Node.js LTS with winget now?')) { Write-Host 'Aborted: Node.js is required.'; exit 1 }
  Install-Node
  $nodeVersion = Get-NodeVersion
  if (-not $nodeVersion) { Write-Host 'Node.js still not found. Open a new terminal and re-run this script.'; exit 1 }
}
elseif ($nodeVersion -lt $MinNode -and $Action -eq 'install') {
  Write-Host "Node.js $nodeVersion found; Context Mode needs $MinNode or newer."
  if ($DryRun) {
    Write-Host '[dry-run] would upgrade Node.js LTS with: winget install --id OpenJS.NodeJS.LTS'
  }
  elseif (Confirm-Step 'Upgrade Node.js LTS with winget now?') {
    Install-Node
    $nodeVersion = Get-NodeVersion
  }
  else { Write-Host 'Continuing without the upgrade; the Context Mode component will report that Node is too old.' }
}

$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot 'askai.js'
if (-not (Test-Path $script)) { throw "askai.js not found next to install.ps1 ($PSScriptRoot)." }

$argv = @($Action)
if ($Path) { $argv += $Path }
if ($Yes) { $argv += '--yes' }
if ($DryRun) { $argv += '--dry-run' }
if ($Workflow) { $argv += @('--profile', $Workflow) }
if ($Target) { $argv += @('--target', $Target) }
if ($Markitdown) { $argv += '--markitdown' }
if ($Ccusage) { $argv += '--ccusage' }
if ($Only) { $argv += @('--only', $Only) }
if ($Skip) { $argv += @('--skip', $Skip) }
if ($NoPath) { $argv += '--no-path' }
if ($Caveman) { $argv += @('--caveman', $Caveman) }
if ($ClaudeHome) { $argv += @('--claude-home', $ClaudeHome) }
if ($CursorHome) { $argv += @('--cursor-home', $CursorHome) }
if ($NoStatusline) { $argv += '--no-statusline' }
if ($CavemanPlugin) { $argv += '--caveman-plugin' }
if ($Tools) { $argv += '--tools' }
if ($Force) { $argv += '--force' }
if ($Print) { $argv += '--print' }
if ($Remove) { $argv += '--remove' }

& $node $script @argv
exit $LASTEXITCODE
