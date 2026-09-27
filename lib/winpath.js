'use strict';
// Add/remove one directory on the *user* PATH without expanding %VARS% in the other entries (a plain
// [Environment]::SetEnvironmentVariable would rewrite them expanded), then broadcast WM_SETTINGCHANGE so new terminals see it.
// The script is built here and run via -EncodedCommand; tests only parse it and never run it.

function script(dir, add) {
  const d = String(dir).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
$dir = '${d}'
$add = $${add ? 'true' : 'false'}
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
  $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $parts = @($raw.Split(';') | Where-Object { $_ -ne '' })
  $norm = { param($x) $x.TrimEnd('\\').ToLowerInvariant() }
  $has = @($parts | Where-Object { (& $norm $_) -eq (& $norm $dir) }).Count -gt 0
  $changed = $false
  if ($add -and -not $has) { $parts += $dir; $changed = $true }
  elseif (-not $add -and $has) { $parts = @($parts | Where-Object { (& $norm $_) -ne (& $norm $dir) }); $changed = $true }
  if ($changed) {
    $key.SetValue('Path', ($parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    Add-Type -Namespace AskaiWin -Name Native -MemberDefinition '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);'
    $res = [UIntPtr]::Zero
    [void][AskaiWin.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$res)
    'changed'
  } else { 'unchanged' }
} finally { $key.Close() }
`;
}

function encoded(dir, add) { return Buffer.from(script(dir, add), 'utf16le').toString('base64'); }

// S.run-compatible: returns 'changed' | 'unchanged' | 'error: ...'
function editUserPath(run, dir, add) {
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(dir, add)], { timeout: 60000 });
  if (!r.ok) return `error: ${(r.stderr || r.error || `exit ${r.status}`).toString().trim().split(/\r?\n/)[0]}`;
  return r.stdout.trim().split(/\r?\n/).pop();
}

module.exports = { script, encoded, editUserPath };
