'use strict';
// Shell functions let a child CLI update ASKAI_PROJECT in the calling terminal.
const fs = require('fs');
const path = require('path');

const sh = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const ps = value => `'${String(value).replace(/'/g, "''")}'`;
function init(shell, script = path.join(__dirname, '..', 'askai.js'), node = process.execPath) {
  if (shell === 'bash' || shell === 'zsh') return `askai() {
  if [ "\${1:-}" = set ] && [ "\${2:-}" = project ]; then
    ${sh(node)} ${sh(script)} "$@" || return $?
    if [ "\${3:-}" = --clear ]; then unset ASKAI_PROJECT; else export ASKAI_PROJECT="$3"; fi
  elif [ "\${1:-}" = project ] && [ "\${2:-}" = switch ] && [ -n "\${3:-}" ]; then
    ${sh(node)} ${sh(script)} "$@" || return $?
    export ASKAI_PROJECT="$3"
  elif [ "\${1:-}" = project ] && [ "\${2:-}" = rename ]; then
    ${sh(node)} ${sh(script)} "$@" || return $?
    if [ "\${ASKAI_PROJECT:-}" = "\${3:-}" ]; then export ASKAI_PROJECT="$4"; fi
  elif [ "\${1:-}" = project ] && [ "\${2:-}" = remove ]; then
    ${sh(node)} ${sh(script)} "$@" || return $?
    if [ "\${ASKAI_PROJECT:-}" = "\${3:-}" ]; then unset ASKAI_PROJECT; fi
  else
    ${sh(node)} ${sh(script)} "$@"
  fi
}`;
  if (shell === 'powershell') return `function global:askai {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$AskAiArgs)
  & ${ps(node)} ${ps(script)} @AskAiArgs
  if ($AskAiArgs.Count -ge 2 -and $AskAiArgs[0] -eq 'set' -and $AskAiArgs[1] -eq 'project' -and $LASTEXITCODE -eq 0) {
    if ($AskAiArgs -contains '--clear') { Remove-Item Env:ASKAI_PROJECT -ErrorAction SilentlyContinue }
    elseif ($AskAiArgs.Count -ge 3) { $env:ASKAI_PROJECT = $AskAiArgs[2] }
  }
  elseif ($AskAiArgs.Count -ge 3 -and $AskAiArgs[0] -eq 'project' -and $AskAiArgs[1] -eq 'switch' -and $LASTEXITCODE -eq 0) { $env:ASKAI_PROJECT = $AskAiArgs[2] }
  elseif ($AskAiArgs.Count -ge 4 -and $AskAiArgs[0] -eq 'project' -and $AskAiArgs[1] -eq 'rename' -and $LASTEXITCODE -eq 0 -and $env:ASKAI_PROJECT -eq $AskAiArgs[2]) { $env:ASKAI_PROJECT = $AskAiArgs[3] }
  elseif ($AskAiArgs.Count -ge 3 -and $AskAiArgs[0] -eq 'project' -and $AskAiArgs[1] -eq 'remove' -and $LASTEXITCODE -eq 0 -and $env:ASKAI_PROJECT -eq $AskAiArgs[2]) { Remove-Item Env:ASKAI_PROJECT -ErrorAction SilentlyContinue }
}`;
  throw new Error(`shell must be powershell, bash or zsh (got "${shell || ''}")`);
}
const BEGIN = '# askai-project-shell:begin';
const END = '# askai-project-shell:end';
const recordFile = home => path.join(home, 'shell-profiles.json');
function install(home, profile, shell, script = path.join(__dirname, '..', 'askai.js')) {
  init(shell, script); // validate shell before writing
  profile = path.resolve(profile);
  const old = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
  const loader = shell === 'powershell'
    ? `Invoke-Expression (& node ${ps(script)} shell init powershell)`
    : `eval "$(node ${sh(script)} shell init ${shell})"`;
  if (!old.includes(BEGIN)) {
    fs.mkdirSync(path.dirname(profile), { recursive: true });
    fs.writeFileSync(profile, old + (old && !old.endsWith('\n') ? '\n' : '') + `${BEGIN}\n${loader}\n${END}\n`);
  }
  fs.mkdirSync(home, { recursive: true });
  const f = recordFile(home); const records = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  if (!records.includes(profile)) records.push(profile);
  fs.writeFileSync(f, JSON.stringify(records, null, 2) + '\n');
  return profile;
}
function uninstall(home) {
  const f = recordFile(home); if (!fs.existsSync(f)) return [];
  const profiles = JSON.parse(fs.readFileSync(f, 'utf8'));
  const changed = [];
  for (const profile of profiles) {
    if (!fs.existsSync(profile)) continue;
    const old = fs.readFileSync(profile, 'utf8');
    const next = old.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\r?\\n?`, 'g'), '');
    if (next !== old) { fs.writeFileSync(profile, next); changed.push(profile); }
  }
  fs.rmSync(f, { force: true }); return changed;
}
module.exports = { init, install, uninstall };
