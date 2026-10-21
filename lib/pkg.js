'use strict';
// Package installs for every platform. Windows keeps askai's original winget route unchanged. macOS, Linux and WSL use Homebrew
// when it is present (it runs on Linux too), else the tool's own documented installer script, else cargo for RTK. Nothing here asks
// for sudo: when only the system package manager could install a tool, the error names the command to run by hand.
//
// Each spec is keyed by the winget id the components already use, so a component calls install(ctx, 'rtk-ai.rtk', present) the
// same way on every OS. The installer scripts are the vendors' published one-liners; the install plan names their URLs before the
// one confirmation askai asks for.

const SPECS = {
  'Anthropic.ClaudeCode': { brew: ['install', '--cask', 'claude-code'], brewName: 'claude-code', script: { url: 'https://claude.ai/install.sh', shell: 'bash' } },
  'rtk-ai.rtk': { brew: ['install', 'rtk'], brewName: 'rtk', cargo: ['install', '--git', 'https://github.com/rtk-ai/rtk'], note: 'not `cargo install rtk`: that crate is the unrelated Rust Type Kit' },
  'BurntSushi.ripgrep.MSVC': { brew: ['install', 'ripgrep'], brewName: 'ripgrep', manual: 'sudo apt-get install ripgrep  (or dnf install ripgrep)' },
  'astral-sh.uv': { brew: ['install', 'uv'], brewName: 'uv', script: { url: 'https://astral.sh/uv/install.sh', shell: 'sh' } },
  'OpenJS.NodeJS.LTS': { brew: ['install', 'node'], brewName: 'node', manual: 'install Node.js 22 LTS from https://nodejs.org or with nvm' },
  'jqlang.jq': { brew: ['install', 'jq'], brewName: 'jq', manual: 'sudo apt-get install jq  (or dnf install jq)' },
  'GitHub.cli': { brew: ['install', 'gh'], brewName: 'gh', manual: 'see https://cli.github.com for your distribution' },
};

const WG = ['--exact', '--accept-package-agreements', '--accept-source-agreements'];
const isWin = () => process.platform === 'win32';

// What a non-Windows OS with the given tools on PATH would run. Independent of the actual host OS, so the docs generator
// gets the same mac/linux text no matter which platform runs it (describe() below answers for the real host instead).
function describeOther(ctx, id) {
  const s = SPECS[id] || {};
  if (s.brew && ctx.which('brew')) return `brew ${s.brew.join(' ')}`;
  if (s.script) return `curl -fsSL ${s.script.url} | ${s.script.shell}`;
  if (s.cargo) return `cargo ${s.cargo.join(' ')}${ctx.which('cargo') ? '' : ' (needs Rust from rustup.rs, or Homebrew)'}`;
  return s.manual ? `manual: ${s.manual}` : `manual install of ${id}`;
}

// One human-readable line for the install plan: what will run on this OS.
function describe(ctx, id) {
  if (isWin()) return `winget install ${id}`;
  return describeOther(ctx, id);
}

function failIfAbsent(ctx, id, r, present, how) {
  ctx.refreshPath();
  if (ctx.dry) return;
  if (!present()) {
    const detail = [r && r.stderr, r && r.stdout, r && r.error && r.error.message].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 240);
    const net = /connection reset|reset by peer|timed out|Could not resolve|curl: \((?:6|7|28|35|56)\)/i.test(detail);
    throw new Error(r && r.ok
      ? `${id} installed (${how}) but is not on PATH yet; open a new terminal and re-run \`askai install\``
      : net
        ? `${how} failed for ${id}: the download was reset or blocked. That is the network path to the download host, not Cursor. Re-run \`askai install --only cursor-serena --yes\` when it is reachable.`
        : `${how} failed for ${id} (exit ${r ? r.status : '?'})${detail ? `: ${detail}` : ''}`);
  }
}

// Install `id` unless present() already says it is there. Throws with a clear next step when it cannot.
function install(ctx, id, present) {
  if (isWin()) {
    if (!ctx.which('winget')) throw new Error(`winget not found; install ${id} manually, then re-run`);
    const r = ctx.act(`winget install ${id}`, 'winget', ['install', '--id', id, ...WG], { inherit: true, timeout: 900000 });
    return failIfAbsent(ctx, id, r, present, 'winget install');
  }
  const s = SPECS[id];
  if (!s) { if (ctx.dry) { ctx.log.plan(`${id}: install it manually on ${process.platform}`); return; } throw new Error(`${id}: no install recipe for ${process.platform}; install it manually, then re-run`); }
  if (s.brew && ctx.which('brew')) {
    const r = ctx.act(`brew ${s.brew.join(' ')}`, 'brew', s.brew, { inherit: true, timeout: 900000 });
    return failIfAbsent(ctx, id, r, present, 'brew');
  }
  if (s.script) {
    if (!ctx.which('curl')) throw new Error(`${id}: needs curl (or Homebrew) to run ${s.script.url}`);
    let r;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const cmd = `curl -fsSL ${s.script.url} | ${s.script.shell}`;
      r = ctx.act(cmd, 'sh', ['-c', cmd], { inherit: true, timeout: 900000 });
      if (ctx.dry || (r && r.ok)) break;
      if (attempt < 3) ctx.log.warn(`${s.script.url} failed (${attempt} of 3); retrying`);
    }
    return failIfAbsent(ctx, id, r, present, `installer script ${s.script.url}`);
  }
  if (s.cargo && ctx.which('cargo')) {
    const r = ctx.act(`cargo ${s.cargo.join(' ')}`, 'cargo', s.cargo, { inherit: true, timeout: 1800000 });
    return failIfAbsent(ctx, id, r, present, 'cargo');
  }
  const hint = s.manual || (s.cargo ? `install Homebrew (https://brew.sh) or Rust (https://rustup.rs), then: cargo ${s.cargo.join(' ')}${s.note ? ` (${s.note})` : ''}` : 'install it manually');
  if (ctx.dry) { ctx.log.plan(`${id}: no Homebrew found; a real run needs: ${hint}`); return; }
  throw new Error(`${id}: no Homebrew found; ${hint}`);
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
