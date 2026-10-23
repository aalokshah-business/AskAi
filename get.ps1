<#
.SYNOPSIS
  Install AskAI straight from GitHub, then run install.ps1 with your options (Windows).
.DESCRIPTION
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Project C:\code\myapp -Yes

  The source stays in %USERPROFILE%\.askai\src (a git checkout when git is installed, else GitHub's zip), so
  `askai update` can refresh it. Every option after the script goes to install.ps1 unchanged; -Project is resolved to a full
  path first. It always installs the latest AskAI (the repository's default branch, main). Environment: ASKAI_REPO (owner/name)
  and ASKAI_REPO_URL (a full git URL or path) point at a fork or a test copy; ASKAI_DIR is where the source goes.
  This script never closes your PowerShell window.
#>
$ErrorActionPreference = 'Stop'
$repo = if ($env:ASKAI_REPO) { $env:ASKAI_REPO } else { 'aalokshah-business/AskAi' }
$url = if ($env:ASKAI_REPO_URL) { $env:ASKAI_REPO_URL } else { "https://github.com/$repo.git" }
$dir = if ($env:ASKAI_DIR) { $env:ASKAI_DIR } else { Join-Path $env:USERPROFILE '.askai\src' }
function Assert-ReplaceableSource([string]$Target) {
  $full = [IO.Path]::GetFullPath($Target).TrimEnd('\', '/')
  $root = [IO.Path]::GetPathRoot($full).TrimEnd('\', '/')
  $userHomePath = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\', '/')
  $askaiHomePath = Join-Path $userHomePath '.askai'
  if ($full -eq $root -or $full -eq $userHomePath -or $full -eq $askaiHomePath) { throw "Refusing to replace unsafe source folder: $Target" }
  $manifest = Join-Path $full 'package.json'
  if (-not (Test-Path -LiteralPath (Join-Path $full 'askai.js') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $full 'install.ps1') -PathType Leaf) -or
      -not (Test-Path -LiteralPath $manifest -PathType Leaf) -or
      (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -ne 'askai') {
    throw "Source folder already exists and is not an AskAI checkout: $Target. Choose another ASKAI_DIR."
  }
}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
New-Item -ItemType Directory -Force -Path (Split-Path $dir) | Out-Null
if (Get-Command git -ErrorAction SilentlyContinue) {
  if (Test-Path (Join-Path $dir '.git')) {
    Assert-ReplaceableSource $dir
    Write-Host "==> updating $dir to the latest AskAI"
    git -C $dir fetch --quiet --depth 1 origin HEAD; if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    git -C $dir checkout --quiet FETCH_HEAD; if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
  } else {
    Write-Host "==> fetching the latest AskAI into $dir"
    if (Test-Path -LiteralPath $dir) { Assert-ReplaceableSource $dir; Remove-Item -LiteralPath $dir -Recurse -Force }
    git clone --quiet --depth 1 $url $dir; if ($LASTEXITCODE -ne 0) { throw "git clone $url failed" }
  }
} else {
  Write-Host "==> downloading the latest AskAI into $dir (no git: GitHub zip of main)"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('askai-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'askai.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp
  $top = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
  if (-not $top) { throw 'Downloaded archive does not contain AskAI.' }
  Assert-ReplaceableSource $top.FullName
  if (Test-Path -LiteralPath $dir) { Assert-ReplaceableSource $dir; Remove-Item -LiteralPath $dir -Recurse -Force }
  Move-Item -LiteralPath $top.FullName -Destination $dir
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not ([IO.Path]::GetFullPath($tmp).StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase))) { throw 'Unexpected temporary folder; not removing it.' }
  Remove-Item -LiteralPath $tmp -Recurse -Force
}
Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
$fwd = @($args)
for ($i = 0; $i -lt $fwd.Count - 1; $i++) { if ("$($fwd[$i])" -ieq '-Project') { $fwd[$i + 1] = (Resolve-Path -LiteralPath "$($fwd[$i + 1])").Path } }
$shell = (Get-Process -Id $PID).Path
& $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'install.ps1') @fwd
if ($LASTEXITCODE -ne 0) { Write-Warning "install.ps1 exited with code $LASTEXITCODE" }
