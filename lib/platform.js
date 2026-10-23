'use strict';
// One place for OS differences. Callers pass a deps object in tests so nothing here touches the real home.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const AGENT = /^(claude|codex|agy|cursor-agent|agent)$/i;

function supportsUnicode(env = process.env, platform = process.platform) {
  if (env.ASKAI_ASCII === '1' || env.NO_COLOR === '1' || env.TERM === 'dumb' || env.LANG === 'C') return false;
  if (platform === 'win32') return !!(env.WT_SESSION || env.TERM_PROGRAM === 'vscode' || /utf-?8/i.test(env.LANG || '') || env.ASKAI_UTF8 === '1');
  return true;
}
function mark(kind, env, platform) {
  const uni = supportsUnicode(env, platform);
  const table = uni ? { ok: '✔', bad: '✖', later: '!', na: '–' } : { ok: 'ok', bad: 'x', later: '!', na: '-' };
  return table[kind] || table.ok;
}
function isInteractive(io = process) {
  return !!(io.stdin && io.stdin.isTTY && io.stdout && io.stdout.isTTY);
}
function continueAnswer(opts = {}) {
  if (opts.yes) return { asked: false, ok: true };
  if (opts.stdinTTY && opts.stdoutTTY) return { asked: true, ok: !!(opts.ask && opts.ask()) };
  return { asked: false, ok: true };
}
function nodeNotice(version = process.version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  if (major === 20) return 'Node 20 is end-of-life (2026-04-30): upgrade to 22 or 24.';
  return '';
}
function nodeNoticeDue({ line, quiet, json, always, previous, day }) {
  if (!line || quiet || json) return false;
  if (always) return true;
  return previous !== day;
}
function shellName(env = process.env) {
  if (env.PSModulePath && /WindowsPowerShell\\v1/i.test(env.PSModulePath) && !env.PWSH) return 'Windows PowerShell 5.1';
  if (env.PSModulePath) return 'PowerShell';
  const shell = env.SHELL || '';
  if (shell) return path.basename(shell);
  if (env.ComSpec) return path.basename(env.ComSpec);
  return process.platform === 'win32' ? 'cmd' : 'sh';
}
function inContainer(env = process.env, exists = fs.existsSync) {
  if (env.REMOTE_CONTAINERS || env.CODESPACES || env.ASKAI_EPHEMERAL_HOME) return true;
  try { return exists('/.dockerenv'); } catch (_) { return false; }
}

function parseTasklist(text, want = AGENT) {
  const found = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (!m) continue;
    const name = m[1].replace(/\.exe$/i, '');
    if (want.test(name)) found.push({ name, pid: m[2] });
  }
  return found;
}
function parsePs(text, want = AGENT) {
  const found = [];
  for (const line of String(text || '').split(/\n/)) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line);
    if (!m) continue;
    const name = path.basename(m[2]);
    if (want.test(name)) found.push({ name, pid: m[1] });
  }
  return found;
}
function parseProc(root, want = AGENT, read = fs.readFileSync, list = fs.readdirSync) {
  const found = [];
  let dirs = [];
  try { dirs = list(root); } catch (_) { return found; }
  for (const pid of dirs) {
    if (!/^\d+$/.test(pid)) continue;
    let comm = '';
    try { comm = String(read(path.join(root, pid, 'comm'), 'utf8')).trim(); } catch (_) { continue; }
    const name = path.basename(comm);
    if (want.test(name)) found.push({ name, pid });
  }
  return found;
}
function findProcesses(deps = {}) {
  const platform = deps.platform || process.platform;
  const spawn = deps.spawn || cp.spawnSync;
  const want = deps.want || AGENT;
  const found = [];
  try {
    if (platform === 'win32') {
      const r = spawn('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const rows = parseTasklist(r && r.stdout, want);
      if (rows.length || (r && r.status === 0)) found.push(...rows);
      else {
        const cim = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { \'"{0}","{1}"\' -f $_.Name, $_.ProcessId }'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
        found.push(...parseTasklist(cim && cim.stdout, want));
      }
    } else {
      const r = spawn('ps', ['-A', '-o', 'pid=,comm='], { encoding: 'utf8', timeout: 5000 });
      if (r && r.status === 0) found.push(...parsePs(r.stdout, want));
      else found.push(...parseProc(deps.procRoot || '/proc', want, deps.read, deps.list));
    }
  } catch (_) { /* detection is best effort */ }
  return found;
}

function spawnHost(cmd, args = [], opts = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  const spawn = deps.spawn || cp.spawnSync;
  const file = (deps.which ? deps.which(cmd) : null) || cmd;
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    // Node throws EINVAL if it spawns a .cmd/.bat without a shell. shell:true is the form that runs the shim.
    return spawn(file, args, { shell: true, windowsHide: true, ...opts });
  }
  return spawn(file, args, { windowsHide: true, ...opts });
}

function copyToClipboard(text, deps = {}) {
  const platform = deps.platform || process.platform;
  const spawn = deps.spawn || cp.spawnSync;
  const tries = platform === 'win32'
    ? [['clip', []], ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard']]]
    : platform === 'darwin' ? [['pbcopy', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, a] of tries) {
    try {
      const r = spawn(cmd, a, { input: String(text), timeout: 3000 });
      if (r && r.status === 0) return cmd === 'powershell.exe' ? 'Set-Clipboard' : cmd;
    } catch (_) { /* next */ }
  }
  if (deps.isTTY && deps.write) {
    try { deps.write(`\x1b]52;c;${Buffer.from(String(text)).toString('base64')}\x07`); return 'osc52'; } catch (_) { /* file next */ }
  }
  if (deps.file) {
    fs.mkdirSync(path.dirname(deps.file), { recursive: true });
    fs.writeFileSync(deps.file, String(text));
    return 'file';
  }
  return null;
}
function clipboardMethod(deps = {}) {
  const which = deps.which || (() => null);
  const platform = deps.platform || process.platform;
  if (platform === 'win32') return which('clip') ? 'clip.exe' : 'file';
  if (platform === 'darwin') return which('pbcopy') ? 'pbcopy' : 'file';
  if (which('wl-copy')) return 'wl-copy';
  if (which('xclip') || which('xsel')) return 'xclip';
  if (deps.isTTY) return 'osc52';
  return 'file';
}

function homeDirs(env = process.env, access = fs.accessSync) {
  const given = env.HOME || env.USERPROFILE || '';
  const ok = p => { try { access(p, fs.constants.W_OK); return true; } catch (_) { return false; } };
  if (given && ok(given)) return { home: given, source: 'env', note: '' };
  const tmp = env.TMPDIR || env.TEMP || env.TMP || os.tmpdir();
  const dir = path.join(tmp, 'askai-home');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* caller sees the path anyway */ }
  return { home: dir, source: 'temp', note: `HOME is unset or not writable. Using ${dir}.` };
}
function openPath(target, deps = {}) {
  const platform = deps.platform || process.platform;
  const spawn = deps.spawn || cp.spawnSync;
  if (platform === 'win32') return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start', '""', target], { windowsHide: true });
  if (platform === 'darwin') return spawn('open', [target], { windowsHide: true });
  return spawn('xdg-open', [target], { windowsHide: true });
}
function packageManager(which = () => null) {
  const tools = [
    ['winget', 'winget install <id>'],
    ['scoop', 'scoop install <name>'],
    ['choco', 'choco install <name>'],
    ['apt-get', 'apt-get install <name>  (no sudo from AskAI; run it yourself if it needs root)'],
    ['dnf', 'dnf install <name>'],
    ['apk', 'apk add <name>'],
    ['pacman', 'pacman -S <name>'],
    ['brew', 'brew install <name>'],
  ];
  const hit = tools.find(([bin]) => which(bin));
  if (hit) return { bin: hit[0], command: hit[1] };
  return { bin: '', command: 'No package manager on PATH. Install ripgrep, jq and gh with winget, scoop, choco, apt-get, dnf, apk, pacman or brew, then re-run.' };
}
function privilege(command) {
  return `Needs privileges. AskAI will not prompt for a password. Run: ${command}`;
}

function writeAtomic(file, text, deps = {}) {
  const write = deps.write || fs.writeFileSync;
  const rename = deps.rename || fs.renameSync;
  const unlink = deps.unlink || fs.unlinkSync;
  const tmp = `${file}.${process.pid}.tmp`;
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      write(tmp, text);
      rename(tmp, file);
      return file;
    } catch (e) {
      last = e;
      if (!/EBUSY|EPERM|EACCES/.test(e.code || '') || i === 3) break;
      const end = Date.now() + 15 * (i + 1);
      while (Date.now() < end) { /* short backoff for a file lock */ }
    }
  }
  try { unlink(tmp); } catch (_) { /* temp may not exist */ }
  throw last;
}
function copyFile(src, dest, deps = {}) {
  const copy = deps.copy || fs.copyFileSync;
  if (deps.symlink) throw new Error('AskAI does not create symlinks');
  copy(src, dest);
  return dest;
}
function shortName(input) {
  const crypto = require('crypto');
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 12);
}

function gitFacts(dir, spawn = cp.spawnSync) {
  const run = args => {
    try { return spawn('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true }) || {}; }
    catch (e) { return { status: 1, stderr: e.message, stdout: '' }; }
  };
  const version = (() => {
    try {
      const r = spawn('git', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      return (r && r.stdout ? String(r.stdout).trim() : '') || 'absent';
    } catch (_) { return 'absent'; }
  })();
  const status = run(['status', '--porcelain']);
  const err = String(status.stderr || '');
  const dubious = /dubious ownership/i.test(err);
  const shallow = String((run(['rev-parse', '--is-shallow-repository']).stdout || '')).trim() === 'true';
  const name = String((run(['config', '--get', 'user.name']).stdout || '')).trim();
  const email = String((run(['config', '--get', 'user.email']).stdout || '')).trim();
  const fix = dubious ? `git config --global --add safe.directory ${dir}` : '';
  return { version, dubious, fix, shallow, identity: !!(name && email), name, email };
}

function which(name) {
  try {
    const r = cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (!r || r.status !== 0) return null;
    return String(r.stdout || '').split(/\r?\n/).find(Boolean) || null;
  } catch (_) { return null; }
}
function envReport(opts = {}) {
  const env = opts.env || process.env;
  const platformName = opts.platform || process.platform;
  const dir = opts.dir || process.cwd();
  const home = homeDirs(env, opts.access);
  const git = opts.git || gitFacts(dir, opts.spawn);
  const lookup = opts.which || which;
  const pm = packageManager(lookup);
  const node = opts.node || process.version;
  const notice = nodeNotice(node);
  const ttyIn = !!(opts.stdinTTY != null ? opts.stdinTTY : process.stdin.isTTY);
  const ttyOut = !!(opts.stdoutTTY != null ? opts.stdoutTTY : process.stdout.isTTY);
  const lines = [
    `OS: ${platformName} ${opts.release || os.release()}`,
    `shell: ${shellName(env)}`,
    `Node: ${node}${notice ? ` — ${notice}` : ''}`,
    `TTY: stdin ${ttyIn ? 'yes' : 'no'}, stdout ${ttyOut ? 'yes' : 'no'}`,
    `git: ${git.version}; safe.directory ${git.dubious ? 'blocked' : 'ok'}; identity ${git.identity ? 'set' : 'absent'}; shallow ${git.shallow ? 'yes' : 'no'}`,
    `package manager: ${pm.bin || 'none'} — ${pm.command}`,
    `container: ${inContainer(env, opts.exists) ? 'yes' : 'no'}`,
    `HOME: ${home.source}${home.note ? ` — ${home.note}` : ''}`,
    `clipboard: ${clipboardMethod({ platform: platformName, which: lookup, isTTY: ttyOut })}`,
  ];
  if (git.fix) lines.push(git.fix);
  return lines.join('\n');
}

function supportText(version) {
  return [
    `askai ${version}`,
    'Tier 1  Ubuntu (bookworm/jammy)  bash  Node 22, 24  CI must pass',
    'Tier 1  Windows 11  Windows PowerShell 5.1 and PowerShell 7  Node 22, 24  CI must pass',
    'Tier 1  Devcontainer / Docker (Debian Node image), non-root  bash  Node 22, 24  CI must pass',
    'Tier 2  macOS (Apple Silicon)  zsh, bash 3.2  Node 22, 24  CI, may fail',
    'Tier 2  Alpine (musl, busybox)  ash, bash if installed  Node 22  CI, may fail',
    'Tier 2  WSL2  bash  Node 22, 24  manual',
    'Info    Node 20 and Node 26  any  assert behavior only',
    'Node 20 is end-of-life (2026-04-30). Core AskAI still runs and prints one upgrade line. Context Mode needs Node >= 22.5. engines is >=20.',
  ].join('\n');
}

module.exports = {
  supportsUnicode, mark, isInteractive, continueAnswer, nodeNotice, nodeNoticeDue, shellName, inContainer,
  parseTasklist, parsePs, parseProc, findProcesses, spawnHost, copyToClipboard, clipboardMethod,
  homeDirs, openPath, packageManager, privilege, writeAtomic, copyFile, shortName, gitFacts, envReport, supportText,
};
