<#
.SYNOPSIS
  Install AskAI straight from GitHub, then run install.ps1 with your options (Windows).
.DESCRIPTION
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Project C:\code\myapp -Yes

  The source stays in %USERPROFILE%\.claude\askai\src (a git checkout when git is installed, else GitHub's zip), so
  `askai upgrade` can refresh it. Every option after the script goes to install.ps1 unchanged; -Project is resolved to a full
  path first. It always installs the latest AskAI (the repository's default branch, main). Environment: ASKAI_REPO (owner/name)
  and ASKAI_REPO_URL (a full git URL or path) point at a fork or a test copy; ASKAI_DIR is where the source goes.
  This script never closes your PowerShell window.
#>
$ErrorActionPreference = 'Stop'
$repo = if ($env:ASKAI_REPO) { $env:ASKAI_REPO } else { 'aalokshah-business/AskAi' }
$url = if ($env:ASKAI_REPO_URL) { $env:ASKAI_REPO_URL } else { "https://github.com/$repo.git" }
$dir = if ($env:ASKAI_DIR) { $env:ASKAI_DIR } else { Join-Path $env:USERPROFILE '.claude\askai\src' }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
New-Item -ItemType Directory -Force -Path (Split-Path $dir) | Out-Null
if (Get-Command git -ErrorAction SilentlyContinue) {
  if (Test-Path (Join-Path $dir '.git')) {
    Write-Host "==> updating $dir to the latest AskAI"
    git -C $dir fetch --quiet --depth 1 origin HEAD; if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    git -C $dir checkout --quiet FETCH_HEAD; if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
  } else {
    Write-Host "==> fetching the latest AskAI into $dir"
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    git clone --quiet --depth 1 $url $dir; if ($LASTEXITCODE -ne 0) { throw "git clone $url failed" }
  }
} else {
  Write-Host "==> downloading the latest AskAI into $dir (no git: GitHub zip of main)"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('askai-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'askai.zip'
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp
  $top = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  Move-Item -Path $top.FullName -Destination $dir
  Remove-Item -Recurse -Force $tmp
}
Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
$fwd = @($args)
for ($i = 0; $i -lt $fwd.Count - 1; $i++) { if ("$($fwd[$i])" -ieq '-Project') { $fwd[$i + 1] = (Resolve-Path -LiteralPath "$($fwd[$i + 1])").Path } }
$shell = (Get-Process -Id $PID).Path
& $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'install.ps1') @fwd
if ($LASTEXITCODE -ne 0) { Write-Warning "install.ps1 exited with code $LASTEXITCODE" }
