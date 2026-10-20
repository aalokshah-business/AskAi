# Windows: runs token-setup.mjs (preview unless --apply). Needs Node.js 18+ (winget install OpenJS.NodeJS.LTS).
#   powershell -ExecutionPolicy Bypass -File .\setup\setup.ps1 --apply --install-clis
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host 'Node.js 18+ is required: winget install OpenJS.NodeJS.LTS'; exit 1 }
& $node.Source (Join-Path $PSScriptRoot 'token-setup.mjs') @args
exit $LASTEXITCODE
