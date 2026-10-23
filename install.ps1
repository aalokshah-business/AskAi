<#
.SYNOPSIS
  Installs AskAI on Windows (macOS, Linux and WSL use install.sh): checks that Node.js 18+ is present, then runs askai.js,
  which applies the token-saving setup for Claude Code and, when they are present, Codex, Antigravity and Cursor.

.DESCRIPTION
  Run from the unzipped AskAI folder (full steps: docs\INSTALL.md):

    powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun      # preview: changes nothing
    powershell -ExecutionPolicy Bypass -File .\install.ps1              # install (asks once)
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Target all -Workflow full
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action check

  What it sets: Claude Sonnet 5.5 at high effort when no main model is set, Haiku for subagents, idle drains off, a Bash output
  cap and deny-read rules for Claude Code; effort, verbosity, personality and no auto-recaps for Codex;
  paid credits off for Antigravity; short token rules and a handoff command in every tool. RTK and Context Mode are opt-in only
  (-Rtk, -ContextMode): independent benchmarks found they cost more. Settings you already chose are never changed; every file is
  backed up first (~\.claude\askai\backups); askai uninstall removes only what AskAI added. Safe to re-run.

.PARAMETER Yes            Do not ask for confirmation (also skips the Node.js prompt).
.PARAMETER DryRun         Show the plan; nothing is installed or written.
.PARAMETER Workflow       Kind of work: minimal | coding (default) | docs | full | max (everything: RTK, Context Mode, Headroom, Graphify, Context7, Caveman plugin, LSP, base tools). Alias: -Profile.
.PARAMETER Target         Tools to set up: auto (default: Claude Code plus every other tool found) | claude | codex | agy | cursor | both | all, or a list such as claude,codex.
.PARAMETER Markitdown     Add markitdown (PDF and Office files to Markdown).
.PARAMETER Ccusage        Add ccusage (usage report).
.PARAMETER Only           Comma-separated component ids (askai profiles and docs\ARCHITECTURE.md list them all).
.PARAMETER Skip           Comma-separated component ids to leave out.
.PARAMETER NoPath         Do not add the askai command to the user PATH.
.PARAMETER Caveman        Terse-reply level: lite | full | ultra | off (default full).
.PARAMETER ClaudeHome     Use this folder instead of ~\.claude (testing).
.PARAMETER CursorHome     Use this folder instead of ~\.cursor (testing).
.PARAMETER CodexHome      Use this folder instead of ~\.codex (testing).
.PARAMETER AgyHome        Use this folder instead of ~\.gemini (testing).
.PARAMETER NoStatusline   Do not set Claude Code's status line.
.PARAMETER CavemanPlugin  Also install the Caveman plugin (adds its own hooks; off by default).
.PARAMETER Tools          With -Action uninstall: also remove the tools AskAI installed (winget, uv, npm).
.PARAMETER Force          Re-run components that already look fine; with uninstall, also remove things AskAI did not add.
.PARAMETER Path           Folder for -Action suggest | project | scaffold | check.
.PARAMETER Print          With -Action project: show the Cursor rules instead of writing them.
.PARAMETER Remove         With -Action project: delete the Cursor rules AskAI wrote.
.PARAMETER Lean           Accepted for older scripts; lean settings are in every profile.
.PARAMETER LeanGit        Also drop Claude Code's git instructions from every turn.
.PARAMETER Rtk            Opt in to RTK (benchmarks found no net saving).
.PARAMETER ContextMode    Opt in to Context Mode (benchmarks found higher cost).
.PARAMETER Lsp            Claude Code's official code-intelligence plugins: ts,py,kotlin,ruby,swift.
.PARAMETER MainModel      Claude Code model when settings.json has none: claude-haiku-5-5 (default) | haiku | sonnet | opus | keep.
.PARAMETER SubagentModel  CLAUDE_CODE_SUBAGENT_MODEL when unset (default haiku).
.PARAMETER CodexModel     Codex model when config.toml has none.
.PARAMETER Topic          With -Action tips: claude | codex | agy | cursor | session | habits.
.PARAMETER Headroom       Also install Headroom in MCP mode for every tool in play (no proxy).
.PARAMETER Graphify       Also install Graphify and register its skill for every tool in play.
.PARAMETER Context7       Also register the Context7 docs MCP server for every tool in play.
.PARAMETER Repomix        Also install the Repomix CLI.
.PARAMETER CodebaseMemory Also install codebase-memory-mcp and register it in every tool in play (not in max).
.PARAMETER ClaudeMem      Also install the claude-mem plugin for Claude Code (not in max; it summarises sessions with your plan).
.PARAMETER BaseTools      Also install the command-line tools agents search with: ripgrep, jq and gh (only those missing).
.PARAMETER Project        After installing, write the project knowledge pack into this repository (askai init): AGENTS.md, CLAUDE.md, GEMINI.md, docs\ai\*, subagents for all four tools.
.PARAMETER ShellIntegration Add the AskAI project-selection function to this PowerShell profile. Run with -Yes for unattended setup.
.PARAMETER Action         install (default) | update | status | doctor | check | savings | report | profiles | suggest | project | scaffold | tips | peak | restore | uninstall | init | infra | audit | guide | models | mcp | plugins.
  Every other command (ask, start, break, resume, session, help) runs through the askai command after install.
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$DryRun,
  [Alias('Profile')][ValidateSet('minimal', 'coding', 'docs', 'full', 'max')][string]$Workflow,
  [string]$Target,          # auto | claude | cursor | both | codex | agy | all, or a list such as claude,codex
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
  [switch]$Lean,
  [switch]$LeanGit,
  [switch]$Rtk,
  [switch]$ContextMode,
  [string]$Lsp,
  [string]$MainModel,
  [string]$SubagentModel,
  [string]$CodexModel,
  [string]$CodexHome,
  [string]$AgyHome,
  [string]$Topic,
  [string]$Project,
  [switch]$ShellIntegration,
  [switch]$BaseTools,
  [switch]$Headroom,
  [switch]$Graphify,
  [switch]$Context7,
  [switch]$Repomix,
  [switch]$CodebaseMemory,
  [switch]$ClaudeMem,
  [ValidateSet('install', 'update', 'status', 'doctor', 'check', 'setup', 'savings', 'report', 'profiles', 'suggest', 'project', 'scaffold', 'tips', 'peak', 'restore', 'uninstall', 'init', 'infra', 'audit', 'guide', 'models', 'mcp', 'plugins')][string]$Action = 'install'
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
if ($Lean) { $argv += '--lean' }
if ($LeanGit) { $argv += '--lean-git' }
if ($Rtk) { $argv += '--rtk' }
if ($ContextMode) { $argv += '--context-mode' }
if ($Lsp) { $argv += @('--lsp', $Lsp) }
if ($MainModel) { $argv += @('--main-model', $MainModel) }
if ($SubagentModel) { $argv += @('--subagent-model', $SubagentModel) }
if ($CodexModel) { $argv += @('--codex-model', $CodexModel) }
if ($CodexHome) { $argv += @('--codex-home', $CodexHome) }
if ($AgyHome) { $argv += @('--agy-home', $AgyHome) }
if ($Topic) { $argv += $Topic }
if ($Project) {
  if (-not (Test-Path -LiteralPath $Project -PathType Container)) { throw "Project folder not found: $Project" }
  $argv += @('--project', (Resolve-Path -LiteralPath $Project).Path)
}
if ($BaseTools) { $argv += '--base-tools' }
if ($Headroom) { $argv += '--headroom' }
if ($Graphify) { $argv += '--graphify' }
if ($Context7) { $argv += '--context7' }
if ($Repomix) { $argv += '--repomix' }
if ($CodebaseMemory) { $argv += '--codebase-memory' }
if ($ClaudeMem) { $argv += '--claude-mem' }

& $node $script @argv
$askaiCode = $LASTEXITCODE
if ($askaiCode -eq 0 -and $Action -eq 'install' -and $ShellIntegration -and -not $ClaudeHome) {
  $profilePath = $PROFILE.CurrentUserCurrentHost
  if ($DryRun) { Write-Host "[dry-run] would add AskAI shell integration to $profilePath" }
  else {
    $appPath = Join-Path $HOME '.askai\app\askai.js'
    if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { $appPath = Join-Path $HOME '.claude\askai\app\askai.js' }
    & $node $appPath shell install powershell --path $profilePath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host 'Open a new PowerShell terminal to use askai set project NAME.'
  }
}
exit $askaiCode
