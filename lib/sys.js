'use strict';
// Process and PATH helpers. Windows-first: .cmd/.bat shims are run through cmd.exe, PATH is re-read from the registry
// after a winget install so the same run can use the tool it just installed.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function extraDirs() {
  const home = os.homedir();
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')];
  if (IS_WIN && process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  return dirs;
}

function which(name) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  const exts = IS_WIN ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  const dirs = [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...extraDirs()];
  for (const dir of dirs) {
    const names = IS_WIN && path.extname(name) ? [name] : exts.map(e => name + e);
    for (const n of names) {
      const cand = path.join(dir, n);
      try { if (fs.statSync(cand).isFile()) return cand; } catch (_) {
        // Store app-execution aliases (winget.exe) are reparse points: stat fails with EACCES, lstat sees a link.
        try { if (IS_WIN && fs.lstatSync(cand).isSymbolicLink()) return cand; } catch (__) { /* next */ }
      }
    }
  }
  return null;
}

// PATH may not contain the desktop app's bundled CLI, so also look in the usual native-install spots.
function findClaude() {
  if (process.env.ASKAI_CLAUDE && fs.existsSync(process.env.ASKAI_CLAUDE)) return process.env.ASKAI_CLAUDE;
  const onPath = which('claude');
  if (onPath) return onPath;
  const home = os.homedir();
  const cands = [path.join(home, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude')];
  const appData = process.env.APPDATA;
  if (IS_WIN && appData) {
    const base = path.join(appData, 'Claude', 'claude-code');
    try {
      const vers = fs.readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
      for (const v of vers) cands.push(path.join(base, v, 'claude.exe'));
    } catch (_) { /* not installed */ }
  }
  return cands.find(c => fs.existsSync(c)) || null;
}

const quote = a => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : '"' + String(a).replace(/"/g, '\\"') + '"');

// Never throws. stdin is closed (EOF) so tools that prompt fail fast instead of hanging.
function run(cmd, args, o = {}) {
  const env = { ...process.env, ...(o.env || {}) };
  const full = which(cmd) || cmd;
  let file = full, argv = args, verbatim = false;
  if (IS_WIN && /\.(cmd|bat)$/i.test(full)) {
    file = process.env.ComSpec || 'cmd.exe';
    argv = ['/d', '/s', '/c', '"' + [quote(full), ...args.map(quote)].join(' ') + '"'];
    verbatim = true;
  }
  const r = cp.spawnSync(file, argv, {
    encoding: 'utf8', env, timeout: o.timeout || 120000, windowsHide: true, windowsVerbatimArguments: verbatim,
    maxBuffer: 32 << 20, cwd: o.cwd,
    ...(o.inherit ? { stdio: ['ignore', 'inherit', 'inherit'] } : { input: o.input == null ? '' : o.input }),
  });
  return { ok: r.status === 0 && !r.error, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? r.error.message : null };
}

function regPath(key) {
  const r = cp.spawnSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
  const m = /\bPath\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(r.stdout || '');
  return m ? m[1].trim() : '';
}
const expandVars = s => s.replace(/%([^%]+)%/g, (all, n) => process.env[n] || all);

// Append PATH entries that were added (by winget, uv) after this process started. Existing order is kept.
function refreshPath() {
  if (!IS_WIN) return;
  const cur = (process.env.PATH || '').split(';').filter(Boolean);
  const seen = new Set(cur.map(p => p.toLowerCase()));
  const extra = [regPath('HKCU\\Environment'), regPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')]
    .map(expandVars).join(';').split(';').filter(Boolean).filter(p => !seen.has(p.toLowerCase()));
  if (extra.length) process.env.PATH = [...cur, ...extra].join(';');
}

module.exports = { IS_WIN, which, findClaude, run, refreshPath, quote };
