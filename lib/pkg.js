'use strict';
// Package installs for every platform. Windows keeps askai's original winget route unchanged. macOS, Linux and WSL use Homebrew
// when it is present (it runs on Linux too), else the tool's own documented installer script, else cargo for RTK. uv has a second
// route: when astral.sh is blocked, `python3 -m pip install --user uv` uses PyPI. Nothing here asks for sudo: when only the
// system package manager could install a tool, the error names the command to run by hand.
//
// Each spec is keyed by the winget id the components already use, so a component calls install(ctx, 'rtk-ai.rtk', present) the
// same way on every OS. The installer scripts are the vendors' published one-liners; the install plan names their URLs before the
// one confirmation askai asks for.

const SPECS = {
  'Anthropic.ClaudeCode': { brew: ['install', '--cask', 'claude-code'], brewName: 'claude-code', script: { url: 'https://claude.ai/install.sh', shell: 'bash' } },
  'rtk-ai.rtk': { brew: ['install', 'rtk'], brewName: 'rtk', cargo: ['install', '--git', 'https://github.com/rtk-ai/rtk'], note: 'not `cargo install rtk`: that crate is the unrelated Rust Type Kit' },
  'BurntSushi.ripgrep.MSVC': { brew: ['install', 'ripgrep'], brewName: 'ripgrep', manual: 'sudo apt-get install ripgrep  (or dnf install ripgrep)' },
  'astral-sh.uv': { brew: ['install', 'uv'], brewName: 'uv', script: { url: 'https://astral.sh/uv/install.sh', shell: 'sh' }, pip: 'python3 -m pip install --user uv' },
  'OpenJS.NodeJS.LTS': { brew: ['install', 'node'], brewName: 'node', manual: 'install Node.js 22 LTS from https://nodejs.org or with nvm' },
  'jqlang.jq': { brew: ['install', 'jq'], brewName: 'jq', manual: 'sudo apt-get install jq  (or dnf install jq)' },
  'GitHub.cli': { brew: ['install', 'gh'], brewName: 'gh', manual: 'sudo apt-get install -y gh  (or dnf install gh; https://cli.github.com)' },
};

const WG = ['--exact', '--accept-package-agreements', '--accept-source-agreements'];
const isWin = () => process.platform === 'win32';
const RUSTUP_SCRIPT = 'https://sh.rustup.rs';

// cargo missing (no Homebrew either): install Rust the same way we already tell the user to by hand -- rustup,
// user-level, no root -- then hand back cargo's own absolute path. ~/.bashrc etc. only take effect in a NEW shell,
// so this process's PATH never sees it; the absolute path lets the cargo install below run anyway in this same run.
// Existence checks go through ctx.probe (like everything else here), not a raw fs call, so this stays mockable.
function ensureRustup(ctx) {
  const home = process.env.HOME;
  if (!home) return null;
  const cargoBin = `${home}/.cargo/bin/cargo`;
  const exists = () => ctx.probe('test', ['-x', cargoBin], { timeout: 10000 }).ok;
  if (exists()) return cargoBin;
  if (!ctx.which('curl')) return null;
  const cmd = `curl --proto '=https' --tlsv1.2 -sSf ${RUSTUP_SCRIPT} | sh -s -- -y`;
  const r = ctx.act('install Rust via rustup (user-level, no root; cargo is needed to build rtk)', 'sh', ['-c', cmd], { inherit: true, timeout: 600000 });
  if (ctx.dry || !r.ok) return null;
  return exists() ? cargoBin : null;
}

// What a non-Windows OS with the given tools on PATH would run. Independent of the actual host OS, so the docs generator
// gets the same mac/linux text no matter which platform runs it (describe() below answers for the real host instead).
function describeOther(ctx, id) {
  const s = SPECS[id] || {};
  if (s.brew && ctx.which('brew')) return `brew ${s.brew.join(' ')}`;
  if (s.script) {
    const line = `curl -fsSL ${s.script.url} | ${s.script.shell}`;
    return s.pip ? `${line}; if that host is blocked, ${s.pip}` : line;
  }
  if (s.cargo) return `cargo ${s.cargo.join(' ')}${ctx.which('cargo') ? '' : ' (installs Rust via rustup first if missing, user-level, no root)'}`;
  return s.manual ? `manual: ${s.manual}` : `manual install of ${s.brewName || 'that tool'}`;
}

// One human-readable line for the install plan: what will run on this OS.
function describe(ctx, id) {
  if (isWin()) return `winget install ${id}`;
  return describeOther(ctx, id);
}

function resultText(r) {
  return [r && r.stderr, r && r.stdout, r && r.error && r.error.message].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 240);
}

function downloadBlocked(r) {
  return /connection reset|reset by peer|timed out|Could not resolve|curl: \((?:6|7|28|35|56)\)|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(resultText(r));
}

function pythonLauncher(ctx) {
  for (const name of ['python3', 'python', 'py']) if (ctx.which(name)) return name;
  return null;
}

function toolName(id) {
  const s = SPECS[id] || {};
  if (s.brewName) return s.brewName;
  if (!isWin() && String(id).includes('.')) return String(id).split('.').pop();
  return id;
}
function failIfAbsent(ctx, id, r, present, how) {
  ctx.refreshPath();
  if (ctx.dry) return;
  if (!present()) {
    const name = toolName(id);
    const howText = isWin() ? how : String(how).replace(/winget install [^ ]+/g, name);
    if (r && r.ok) throw new Error(`needs you: ${name} is not on PATH yet. Open a new terminal and run askai install --retry`);
    if (downloadBlocked(r)) throw new Error(`needs you: network blocks the download for ${name}. Retry: askai install --retry`);
    const detail = resultText(r).replace(/[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g, '');
    throw new Error(`failed: ${name} (${howText})${detail ? `: ${detail.trim()}` : ''}. Retry: askai install --retry`);
  }
}

// astral.sh is one host. PyPI is another, and `uv` from `pip install --user` lands in ~/.local/bin, which askai already searches.
// A dry-run that successfully planned the primary installer does not also plan this.
function installUvFromPypi(ctx, present, prior, how) {
  ctx.refreshPath();
  if (present()) return;
  if (ctx.dry && prior && prior.ok) return;
  const py = pythonLauncher(ctx);
  if (!py) {
    failIfAbsent(ctx, 'astral-sh.uv', prior, present, how);
    if (ctx.dry) ctx.log.plan('python3 -m pip install --user uv  (if the uv installer host is blocked)');
    return;
  }
  if (!ctx.dry) ctx.log.warn(`${how} did not provide uv; trying ${py} -m pip install --user uv`);
  const r = ctx.act(`${py} -m pip install --user uv`, py, ['-m', 'pip', 'install', '--user', 'uv'], { inherit: true, timeout: 900000 });
  ctx.refreshPath();
  if (ctx.dry || present()) return;
  const detail = resultText(r);
  throw new Error(`uv was not installed. ${how} failed, and \`${py} -m pip install --user uv\` failed too${detail ? `: ${detail}` : ''}. Install uv where PyPI or astral.sh is reachable, then re-run \`askai install --only cursor-serena --yes\`.`);
}

// Install `id` unless present() already says it is there. Throws with a clear next step when it cannot.
function install(ctx, id, present) {
  const uv = id === 'astral-sh.uv';
  if (isWin()) {
    if (!ctx.which('winget')) {
      if (uv) return installUvFromPypi(ctx, present, { ok: false, status: 1, stdout: '', stderr: 'winget not found', error: null }, 'winget');
      throw new Error(`winget not found; install ${id} manually, then re-run`);
    }
    const r = ctx.act(`winget install ${id}`, 'winget', ['install', '--id', id, ...WG], { inherit: true, timeout: 900000 });
    if (uv) return installUvFromPypi(ctx, present, r, 'winget install');
    return failIfAbsent(ctx, id, r, present, 'winget install');
  }
  const s = SPECS[id];
  if (!s) { if (ctx.dry) { ctx.log.plan(`${id}: install it manually on ${process.platform}`); return; } throw new Error(`${id}: no install recipe for ${process.platform}; install it manually, then re-run`); }
  if (s.brew && ctx.which('brew')) {
    const r = ctx.act(`brew ${s.brew.join(' ')}`, 'brew', s.brew, { inherit: true, timeout: 900000 });
    if (uv) return installUvFromPypi(ctx, present, r, 'brew');
    return failIfAbsent(ctx, id, r, present, 'brew');
  }
  if (s.script) {
    if (!ctx.which('curl')) {
      if (uv) return installUvFromPypi(ctx, present, { ok: false, status: 1, stdout: '', stderr: 'curl not found', error: null }, 'curl');
      throw new Error(`${id}: needs curl (or Homebrew) to run ${s.script.url}`);
    }
    let r;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const cmd = `curl -fsSL ${s.script.url} | ${s.script.shell}`;
      r = ctx.act(cmd, 'sh', ['-c', cmd], { inherit: true, timeout: 900000 });
      if (ctx.dry || (r && r.ok)) break;
      if (uv && downloadBlocked(r)) { ctx.log.warn(`${s.script.url} is blocked; not retrying that host`); break; }
      if (attempt < 3) ctx.log.warn(`${s.script.url} failed (${attempt} of 3); retrying`);
    }
    if (uv) return installUvFromPypi(ctx, present, r, `installer script ${s.script.url}`);
    return failIfAbsent(ctx, id, r, present, `installer script ${s.script.url}`);
  }
  if (s.cargo) {
    const onPath = ctx.which('cargo');
    const cargoBin = onPath || ensureRustup(ctx);
    if (cargoBin) {
      const r = ctx.act(`cargo ${s.cargo.join(' ')}`, onPath ? 'cargo' : cargoBin, s.cargo, { inherit: true, timeout: 1800000 });
      return failIfAbsent(ctx, id, r, present, 'cargo');
    }
  }
  const cargoRoute = s.cargo && (process.platform === 'linux'
    ? `install Rust (https://rustup.rs) or Homebrew (https://brew.sh), then: cargo ${s.cargo.join(' ')}${s.note ? ` (${s.note})` : ''}`
    : `install Homebrew (https://brew.sh) or Rust (https://rustup.rs), then: cargo ${s.cargo.join(' ')}${s.note ? ` (${s.note})` : ''}`);
  const hint = s.manual || cargoRoute || 'install it manually';
  const name = toolName(id);
  // A live install here is unlikely to survive a container rebuild, and the manual command above may need
  // root this container does not have -- say so instead of just repeating the same command every retry.
  const containerNote = require('./platform').inContainer() ? ' This looks like a container: prefer baking this into the image over a live install, unless the container is long-lived and you have root.' : '';
  if (ctx.dry) { ctx.log.plan(`${name}: no Homebrew found; a real run needs: ${hint}${containerNote}`); return; }
  throw new Error(`${name}: no Homebrew found; ${hint}${containerNote}`);
}

function upgrade(ctx, id) {
  if (isWin()) {
    if (!ctx.which('winget')) return;
    ctx.act(`winget upgrade ${id}`, 'winget', ['upgrade', '--id', id, ...WG], { inherit: true, timeout: 900000 });
    return ctx.refreshPath();
  }
  const s = SPECS[id] || {};
  if (s.brewName && ctx.which('brew')) ctx.act(`brew upgrade ${s.brewName}`, 'brew', ['upgrade', s.brewName], { inherit: true, timeout: 900000 });
}

function uninstall(ctx, id) {
  if (isWin()) {
    if (ctx.which('winget')) ctx.act(`winget uninstall ${id}`, 'winget', ['uninstall', '--id', id, '--exact'], { inherit: true, timeout: 600000 });
    return;
  }
  const s = SPECS[id] || {};
  if (s.brewName && ctx.which('brew')) ctx.act(`brew uninstall ${s.brewName}`, 'brew', ['uninstall', s.brewName], { inherit: true, timeout: 600000 });
  else ctx.log.info(`${id}: installed without a package manager; remove it by hand if you no longer want it`);
}

module.exports = { SPECS, install, upgrade, uninstall, describe, describeOther };
