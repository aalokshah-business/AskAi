<# Standalone Ask AI desktop setup from a cloned/downloaded AskAI folder. #>
param([switch]$Yes,[switch]$DryRun)
$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction Stop
$arguments = @((Join-Path $PSScriptRoot 'askai.js'), 'desktop', 'install')
if ($Yes) { $arguments += '--yes' }
if ($DryRun) { $arguments += '--dry-run' }
& $node.Source @arguments
exit $LASTEXITCODE
