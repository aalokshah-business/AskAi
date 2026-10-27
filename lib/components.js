'use strict';
// The tools askai installs and wires up. askai contributes no hooks of its own: every hook that fires on a prompt
// or tool call comes from RTK (settings.json for Claude Code, hooks.json for Cursor) or a plugin (Context Mode, optional
// Caveman plugin).
//
// ctx contract (built in askai.js, faked in tests):
//   paths, opts, dry, env, log, which(name), claudeBin(), probe(cmd,args,o) (read-only, always runs),
//   act(label,cmd,args,o) (mutating, skipped in dry-run), refreshPath(), settings(), editSettings(fn), backup(file),
//   editJson(file, fn) (same as editSettings for any JSON file: fresh read, backup, atomic write),
//   cursorPaths ({ home, mcp, hooks } of the Cursor config directory, or null when it is unknown),
//   editPath(dir, add) (user PATH; returns 'changed' | 'unchanged' | 'planned' | 'skipped (...)' | 'error: ...'),
//   manifest, nodeVersion
// Each component: { id, title, evidence, plan, detect(ctx) -> {state,detail}, install(ctx), update(ctx), uninstall(ctx) }
//   host: 'claude' (default) | 'cursor' | 'any'. A cursor component has `mirrors`: the id of the Claude component it is the twin of;
//   a profile that lists the twin installs it too when Cursor is a target.
// state: ok | partial | missing | other.  evidence: measured | reported | unmeasured | none.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const rulesLib = require('./rules');
const profiles = require('./profiles');
const cursor = require('./cursor');
const pkg = require('./pkg');


const firstLine = s => String(s || '').trim().split(/\r?\n/)[0];
function version(ctx, cmd, args = ['--version']) {
  const r = ctx.probe(cmd, args, { timeout: 20000 });
  return r.ok ? firstLine(r.stdout || r.stderr) : null;
}

// Package installs go through lib/pkg.js: winget on Windows (unchanged), Homebrew, the vendor's installer script or cargo elsewhere.
function wingetInstall(ctx, id, present) { return pkg.install(ctx, id, present); }
function wingetUpgrade(ctx, id) { return pkg.upgrade(ctx, id); }
function wingetUninstall(ctx, id) { return pkg.uninstall(ctx, id); }

const wasAdded = (ctx, id) => !!(ctx.manifest.components[id] && ctx.manifest.components[id].installedByAskai);
function record(ctx, id, data) {
  ctx.manifest.components[id] = { ...(ctx.manifest.components[id] || {}), ...data, updated: new Date().toISOString() };
}

// ---- plugins / MCP helpers ---------------------------------------------------------------------------------------
// enabledPlugins in settings.json is the cheap check; `claude plugin list --json` is the fallback (shape parsed loosely).
function pluginState(ctx, name) {
  const ep = ctx.settings().enabledPlugins;
  if (ep && typeof ep === 'object') {
    for (const [k, v] of Object.entries(ep)) if (k.split('@')[0] === name) return v === false ? 'disabled' : 'enabled';
  }
  const claude = ctx.claudeBin();
  if (!claude) return 'unknown';
  const r = ctx.probe(claude, ['plugin', 'list', '--json'], { timeout: 30000 });
  if (r.ok && new RegExp(`"${name}(@[^"]*)?"`).test(r.stdout)) return 'enabled';
  return 'missing';
}
function addPlugin(ctx, marketplaceSrc, marketplace, plugin) {
  const claude = ctx.claudeBin();
  if (!claude && !ctx.dry) throw new Error('claude CLI not found; install Claude Code first (component "claude")');
  const bin = claude || 'claude';
  ctx.backup(ctx.paths.settings);
  ctx.backup(ctx.paths.userJson);
  const m = ctx.act(`add plugin marketplace ${marketplaceSrc}`, bin, ['plugin', 'marketplace', 'add', marketplaceSrc], { timeout: 180000 });
  if (!m.ok && !/already/i.test(m.stdout + m.stderr)) throw new Error(`marketplace add ${marketplaceSrc} failed: ${firstLine(m.stderr || m.stdout || m.error)}`);
  const i = ctx.act(`install plugin ${plugin}@${marketplace}`, bin, ['plugin', 'install', `${plugin}@${marketplace}`], { timeout: 300000 });
  if (!i.ok && !/already/i.test(i.stdout + i.stderr)) throw new Error(`plugin install ${plugin}@${marketplace} failed: ${firstLine(i.stderr || i.stdout || i.error)}`);
  if (!ctx.dry && pluginState(ctx, plugin) !== 'enabled') throw new Error(`plugin ${plugin} does not show as enabled after install; check \`claude plugin list\``);
}
function removePlugin(ctx, marketplace, plugin, id) {
  const claude = ctx.claudeBin();
  if (!claude) return;
  ctx.backup(ctx.paths.settings);
  ctx.backup(ctx.paths.userJson);
  ctx.act(`uninstall plugin ${plugin}@${marketplace}`, claude, ['plugin', 'uninstall', `${plugin}@${marketplace}`], { timeout: 120000 });
  if (wasAdded(ctx, id)) ctx.act(`remove marketplace ${marketplace}`, claude, ['plugin', 'marketplace', 'remove', marketplace], { timeout: 120000 });
}
// Plugins askai did not add (per manifest) stay unless --force. `id` is the manifest key, `plugin` the plugin name.
function uninstallPlugin(ctx, plugin, id) {
  if (pluginState(ctx, plugin) === 'missing') return;
  if (!ctx.opts.force && !wasAdded(ctx, id)) { ctx.log.info(`${plugin}: not installed by askai, left in place (use --force to remove)`); return; }
  removePlugin(ctx, plugin, plugin, id);
}
function updatePlugin(ctx, marketplace, plugin) {
  const claude = ctx.claudeBin();
  if (!claude) throw new Error('claude CLI not found');
  ctx.act(`update marketplace ${marketplace}`, claude, ['plugin', 'marketplace', 'update', marketplace], { timeout: 180000 });
  ctx.act(`update plugin ${plugin}`, claude, ['plugin', 'update', `${plugin}@${marketplace}`], { timeout: 300000 });
}
function mcpServers(ctx) {
  try { return cfg.readJson(ctx.paths.userJson).mcpServers || {}; } catch (_) { return {}; }
}

// ---- components --------------------------------------------------------------------------------------------------
const claude = {
  id: 'claude', title: 'Claude Code CLI', evidence: 'none',
  plan: 'winget install Anthropic.ClaudeCode, only if the claude CLI is missing',
  detect(ctx) {
    const b = ctx.claudeBin();
    if (b) return { state: 'ok', detail: version(ctx, b) || b };
    const want = ctx.opts && ctx.opts.installHost && String(ctx.opts.installHost).split(',').map(s => s.trim()).includes('claude');
    return want ? { state: 'missing', detail: 'claude CLI not found' } : { state: 'other', detail: 'not needed: claude CLI not on PATH' };
  },
  install(ctx) {
    wingetInstall(ctx, 'Anthropic.ClaudeCode', () => !!ctx.claudeBin());
    record(ctx, 'claude', { installedByAskai: true });
  },
  update(ctx) { wingetUpgrade(ctx, 'Anthropic.ClaudeCode'); },
  uninstall(ctx) { if (ctx.opts.tools && wasAdded(ctx, 'claude')) wingetUninstall(ctx, 'Anthropic.ClaudeCode'); },
};

// The model choices of this run (askai install --main-model / --subagent-model).
const baselineOpts = ctx => ({ mainModel: ctx.opts.mainModel, subagentModel: ctx.opts.subagentModel });
const baseline = {
  id: 'baseline', title: 'Settings baseline', evidence: 'none',
  plan: 'settings.json: add (never override) model=claude-haiku-5-5 (Claude Code otherwise starts on Opus; --main-model), CLAUDE_CODE_SUBAGENT_MODEL=haiku, effortLevel=medium, name-only skillOverrides; replace the retired haiku, high effort on Haiku, and autoCompactWindow 150000 defaults; remove leftover self-built askai hook registrations',
  detect(ctx) {
    const probe = JSON.parse(JSON.stringify(ctx.settings()));
    const missing = cfg.applyBaseline(probe, baselineOpts(ctx)).length;
    const retired = cfg.migrateRetired(JSON.parse(JSON.stringify(ctx.settings()))).length;
    return missing || retired ? { state: 'partial', detail: `${missing} baseline key(s) not set${retired ? `, ${retired} old default(s)` : ''}` } : { state: 'ok', detail: 'all baseline keys present' };
  },
  install(ctx) {
    let added = [], migrated = [], legacy = 0;
    ctx.editSettings(s => { added = cfg.applyBaseline(s, baselineOpts(ctx)); migrated = cfg.migrateRetired(s); legacy = cfg.removeLegacyHooks(s); });
    const seen = new Map((ctx.manifest.settings || []).map(e => [e.key, e]));
    for (const a of added) seen.set(a.key, a);
    for (const m of migrated) { if (m.removed) seen.delete(m.key); else seen.set(m.key, { key: m.key, value: m.value }); }
    ctx.manifest.settings = [...seen.values()];
    ctx.log.info(`baseline: ${added.length} key(s) added${migrated.length ? `, ${migrated.length} old default(s) updated` : ''}${legacy ? `, ${legacy} legacy askai hook(s) removed` : ''}`);
  },
  update(ctx) { baseline.install(ctx); },
  uninstall(ctx) {
    const entries = ctx.manifest.settings || [];
    let n = 0;
    ctx.editSettings(s => { for (const e of entries) if (cfg.removeKey(s, e.key, e.value)) n++; });
    ctx.manifest.settings = [];
    ctx.log.info(`baseline: ${n} key(s) removed (only those still holding the value askai set)`);
  },
};

const rtkHooked = ctx => cfg.listHooks(ctx.settings()).some(h => h.event === 'PreToolUse' && /\brtk\b/i.test(h.command));
// The rtk binary, shared by the Claude and the Cursor component: installed with winget when missing, verified to be rtk-ai/rtk, and
// recorded as askai's only when askai installed it (the binary belongs to the `rtk` record whichever host asked for it).
function isRealRtk(ctx) {
  const g = ctx.probe('rtk', ['gain'], { timeout: 30000 });
  if (g.ok || (g.stdout && g.stdout.includes('RTK Token Savings'))) return true;
  const h = ctx.probe('rtk', ['--help'], { timeout: 10000 });
  if (h.ok && /rtk|assistant/i.test(h.stdout || '')) return true;
  return false;
}
function ensureRtk(ctx) {
  const pre = !!ctx.which('rtk');
  if (!pre) wingetInstall(ctx, 'rtk-ai.rtk', () => !!ctx.which('rtk'));
  if (!ctx.dry && !isRealRtk(ctx)) {
    throw new Error('`rtk gain` fails: this is not rtk-ai/rtk (probably the unrelated "Rust Type Kit"). Uninstall it and install rtk-ai.rtk');
  }
  if (!ctx.which('rg')) {
    try { wingetInstall(ctx, 'BurntSushi.ripgrep.MSVC', () => !!ctx.which('rg')); } catch (e) { ctx.log.warn(`ripgrep not installed (some RTK filters need rg): ${e.message}`); }
  }
  record(ctx, 'rtk', { installedByAskai: !pre || wasAdded(ctx, 'rtk') });
  return pre;
}
const rtk = {
  id: 'rtk', title: 'RTK (Bash output compression; opt-in, see README for the benchmarks)', evidence: 'reported', optIn: true, optInFlag: 'rtk',
  plan: 'winget install rtk-ai.rtk; check `rtk gain` works; winget install BurntSushi.ripgrep.MSVC if rg is missing; `rtk init -g --auto-patch` (registers a PreToolUse hook on Bash)',
  detect(ctx) {
    if (!ctx.which('rtk')) return { state: 'missing', detail: 'rtk not on PATH' };
    const v = version(ctx, 'rtk');
    if (!isRealRtk(ctx)) return { state: 'partial', detail: `${v || 'rtk'} but \`rtk gain\` fails: wrong package ("Rust Type Kit") or broken install` };
    if (!rtkHooked(ctx)) return { state: 'partial', detail: `${v || 'rtk'} installed, hook not registered` };
    return { state: 'ok', detail: `${v || 'rtk'}, PreToolUse hook registered` };
  },
  install(ctx) {
    ensureRtk(ctx);
    let ranInit = false;
    if (!rtkHooked(ctx)) {
      ranInit = true;
      ctx.backup(ctx.paths.settings);
      ctx.backup(ctx.paths.claudeMd);
      const r = ctx.act('rtk init -g --auto-patch', 'rtk', ['init', '-g', '--auto-patch'], { timeout: 120000 });
      if (!ctx.dry && !r.ok) throw new Error(`rtk init failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      if (!ctx.dry && !rtkHooked(ctx)) throw new Error('rtk init ran but no rtk hook is registered in settings.json; run `rtk init -g --show`');
    }
    record(ctx, 'rtk', { hook: ranInit || !!(ctx.manifest.components.rtk && ctx.manifest.components.rtk.hook) });
  },
  update(ctx) {
    wingetUpgrade(ctx, 'rtk-ai.rtk');
    if (!ctx.dry && ctx.which('rtk') && !rtkHooked(ctx)) rtk.install(ctx);
  },
  // The hook is removed only when askai registered it (manifest), or with --force.
  uninstall(ctx) {
    const mine = ctx.opts.force || !!(ctx.manifest.components.rtk && ctx.manifest.components.rtk.hook);
    if (mine && ctx.which('rtk') && rtkHooked(ctx)) {
      ctx.backup(ctx.paths.settings);
      ctx.backup(ctx.paths.claudeMd);
      ctx.act('rtk init -g --uninstall', 'rtk', ['init', '-g', '--uninstall'], { timeout: 120000 });
      if (!ctx.dry && rtkHooked(ctx)) {
        ctx.log.warn('rtk init --uninstall left a hook behind; removing the rtk hook entries from settings.json');
        ctx.editSettings(s => cfg.removeHooks(s, /\brtk\b/i));
      }
    } else if (rtkHooked(ctx)) ctx.log.info('rtk: hook was not registered by askai, left in place (use --force to remove)');
    if (ctx.opts.tools && wasAdded(ctx, 'rtk')) wingetUninstall(ctx, 'rtk-ai.rtk');
  },
};

const nodeOk = v => { const [a, b] = String(v).split('.').map(Number); return a > 22 || (a === 22 && b >= 5); };
const contextModeNodeError = v => `Node ${v} is too old for Context Mode (needs >= 22.5). Leave this machine's Node if other software depends on it; Context Mode stays off until Node is 22.5 or newer.`;
const NVM_INSTALL_SCRIPT = 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh';
// Run a shell snippet with nvm sourced, without ever touching this machine's default `node` (no `nvm alias default`,
// no `nvm use --default`): other software on PATH keeps whatever Node it already had.
// nvm lives wherever its installer or a devcontainer feature put it: honour an existing $NVM_DIR, then the usual places, but only
// a directory this user can write to (`nvm install` writes into it); a read-only shared one is skipped and a private ~/.nvm is installed.
const nvmRun = cmd => `for d in "\${NVM_DIR:-}" /usr/local/share/nvm "$HOME/.nvm" "\${XDG_CONFIG_HOME:-$HOME/.config}/nvm"; do if [ -n "$d" ] && [ -s "$d/nvm.sh" ] && [ -w "$d" ] && { [ ! -d "$d/versions" ] || [ -w "$d/versions" ]; }; then export NVM_DIR="$d"; \\. "$d/nvm.sh"; break; fi; done; ${cmd}`;
// The system Node is too old for Context Mode. Rather than upgrading it (and risking whatever else on this machine
// depends on that version), get a second, pinned Node 22+ through nvm -- installing nvm itself if needed -- and hand
// back its bin dir. The caller points Cursor's MCP entry straight at that Node; the system default never changes.
function ensurePinnedNode(ctx) {
  if (process.platform === 'win32') throw new Error(contextModeNodeError(ctx.nodeVersion) + ' (a pinned install via nvm is only wired up for macOS/Linux so far)');
  if (!ctx.which('bash')) throw new Error(contextModeNodeError(ctx.nodeVersion) + ' nvm needs bash, which is not on PATH.');
  const has = ctx.probe('bash', ['-lc', nvmRun('command -v nvm >/dev/null 2>&1 && echo yes')], { timeout: 15000 });
  if (!/yes/.test(has.stdout || '')) {
    if (!ctx.which('curl')) throw new Error(contextModeNodeError(ctx.nodeVersion) + ' Getting a pinned Node via nvm also needs curl, which is not on PATH.');
    const install = ctx.act('install nvm (pinned Node for Context Mode only; this machine\'s own node and shell profile are untouched)', 'bash', ['-lc', `curl -fsSL ${NVM_INSTALL_SCRIPT} | NVM_DIR="$HOME/.nvm" PROFILE=/dev/null bash`], { inherit: true, timeout: 300000 });
    if (!ctx.dry && !install.ok) throw new Error(`could not install nvm to get a pinned Node for Context Mode (exit ${install.status})`);
  }
  if (ctx.dry) return { node: '(pinned node 22, resolved after install)', dir: '' };
  const installed = ctx.act('nvm install 22 (pinned; does not change this machine\'s default node)', 'bash', ['-lc', nvmRun('nvm install 22')], { inherit: true, timeout: 600000 });
  if (!installed.ok) throw new Error(`nvm could not install a pinned Node 22 for Context Mode (exit ${installed.status})`);
  const which = ctx.probe('bash', ['-lc', nvmRun('nvm which 22')], { timeout: 15000 });
  const node = firstLine(which.stdout);
  if (!which.ok || !node) throw new Error('nvm installed a pinned Node 22 but its path could not be resolved; run `nvm which 22` by hand to check');
  return { node, dir: path.dirname(node) };
}
// True once an MCP entry's command is an absolute path to a pinned node rather than the literal string
// 'context-mode' (which only resolves when the package is on the system's own PATH).
const isPinnedEntry = entry => !!entry && path.isAbsolute(String(entry.command || ''));
const contextMode = {
  id: 'context-mode', title: 'Context Mode (sandboxed tool output + session memory; opt-in)', evidence: 'reported', optIn: true, optInFlag: 'contextMode',
  plan: 'claude plugin marketplace add mksglu/context-mode; claude plugin install context-mode@context-mode (plugin hooks + ctx_* MCP tools; needs Node >= 22.5)',
  detect(ctx) {
    const st = pluginState(ctx, 'context-mode');
    if (st === 'enabled') return { state: nodeOk(ctx.nodeVersion) ? 'ok' : 'partial', detail: nodeOk(ctx.nodeVersion) ? 'plugin enabled' : `plugin enabled but Node ${ctx.nodeVersion} < 22.5` };
    return { state: st === 'disabled' ? 'partial' : 'missing', detail: st === 'unknown' ? 'claude CLI not found' : `plugin ${st}` };
  },
  install(ctx) {
    if (!ctx.dry && !nodeOk(ctx.nodeVersion)) throw new Error(contextModeNodeError(ctx.nodeVersion));
    const pre = pluginState(ctx, 'context-mode') === 'enabled';
    if (!pre) addPlugin(ctx, 'mksglu/context-mode', 'context-mode', 'context-mode');
    record(ctx, 'context-mode', { installedByAskai: !pre || wasAdded(ctx, 'context-mode') });
  },
  update(ctx) { updatePlugin(ctx, 'context-mode', 'context-mode'); },
  uninstall(ctx) { uninstallPlugin(ctx, 'context-mode', 'context-mode'); },
};

// The executable of a uv-installed tool: on PATH, else in uv's tool bin dir (which is not on PATH until the user PATH is edited).
function uvToolExe(ctx, name) {
  const onPath = ctx.which(name);
  if (onPath) return onPath;
  const uv = ctx.which('uv');
  if (!uv) return null;
  const r = ctx.probe(uv, ['tool', 'dir', '--bin'], { timeout: 20000 });
  if (!r.ok) return null;
  const exe = path.join(firstLine(r.stdout), process.platform === 'win32' ? `${name}.exe` : name);
  return fs.existsSync(exe) ? exe : null;
}
// The uv-generated trampoline in `uv tool dir --bin` (what uvToolExe returns) can diverge in behavior from the
// tool's own venv: on Windows a markitdown YouTube conversion reliably loses its transcript (exits 0, no error)
// through the trampoline but not through this venv's python -m markitdown, same source, same arguments. Returns
// the venv python so a caller can invoke `<python> -m <name> ...` instead of the trampoline, or null if this
// isn't a uv tool install (nothing to resolve) or the expected venv layout isn't there.
function uvToolPython(ctx, name) {
  const uv = ctx.which('uv');
  if (!uv) return null;
  const r = ctx.probe(uv, ['tool', 'dir'], { timeout: 20000 });
  if (!r.ok) return null;
  const python = path.join(firstLine(r.stdout), name, process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
  return fs.existsSync(python) ? python : null;
}
const serenaExe = ctx => uvToolExe(ctx, 'serena');

function isBrokenTrampoline(ctx, exe) {
  if (!exe) return false;
  if (!ctx._trampolineCache) ctx._trampolineCache = new Map();
  if (ctx._trampolineCache.has(exe)) return ctx._trampolineCache.get(exe);
  const p = ctx.probe ? ctx.probe(exe, ['--version'], { timeout: 3000 }) : null;
  const broken = !!(p && !p.ok && /trampoline/i.test(`${p.stdout}\n${p.stderr}`));
  ctx._trampolineCache.set(exe, broken);
  return broken;
}

function uvToolInstalled(ctx, name) {
  const uv = ctx.which ? ctx.which('uv') : null;
  if (!uv) return false;
  if (ctx._uvToolList === undefined) {
    const p = ctx.probe ? ctx.probe(uv, ['tool', 'list'], { timeout: 15000 }) : null;
    ctx._uvToolList = (p && p.ok) ? p.stdout : null;
  }
  if (ctx._uvToolList !== null) return new RegExp(`^${name}\\b`, 'im').test(ctx._uvToolList);
  return true;
}

// Extras: the formats a document workflow reads (PDF and Office). The audio, YouTube and Azure extras are left out on purpose.
const MARKITDOWN_SPEC = 'markitdown[pdf,docx,pptx,xlsx,xls,youtube-transcription]';
const MCP_ARGS = ['start-mcp-server', '--context', 'claude-code', '--project-from-cwd', '--open-web-dashboard', 'False'];

// uv keeps a cpython-X.Y-<platform> link (a junction on Windows) next to each cpython-X.Y.Z-<platform> directory. When one
// goes stale, `uv tool install` fails with "Missing expected target directory for Python minor version link at <dir>".
// uv recreates the link on the next install, so removing just the link (never the directory it points at) repairs it.
const MINOR_LINK = /^[a-z]+-\d+\.\d+-/i;
const isLink = p => { try { return fs.lstatSync(p).isSymbolicLink(); } catch (_) { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Removes dangling minor-version links in uv's python dir, plus the one `uvOutput` names when it holds that error.
// Returns the links removed (or, in dry-run, the ones that would be).
function repairUvLinks(ctx, uvOutput) {
  const dirProbe = ctx.probe(ctx.which('uv') || 'uv', ['python', 'dir'], { timeout: 20000 });
  const dir = dirProbe.ok ? firstLine(dirProbe.stdout) : '';
  if (!dir) return [];
  const bad = new Set();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { /* no python installed yet */ }
  for (const n of names) {
    const p = path.join(dir, n);
    if (MINOR_LINK.test(n) && isLink(p) && !isDir(p)) bad.add(p);
  }
  const named = /minor version link at (.+?)\s*$/im.exec(uvOutput || '');
  if (named) {
    const target = named[1];
    const link = path.join(path.dirname(target), path.basename(target).replace(/^(.+?-\d+\.\d+)\.[^-]+(?=-)/, '$1'));
    if (samePath(path.dirname(link), dir) && MINOR_LINK.test(path.basename(link)) && isLink(link)) bad.add(link);
  }
  for (const p of bad) {
    if (ctx.dry) { ctx.log.plan(`remove stale uv python link ${p} (its target directory is left alone)`); continue; }
    try { fs.unlinkSync(p); } catch (_) { fs.rmdirSync(p); }
    ctx.log.info(`uv: removed stale python link ${p} (its target directory was left alone)`);
  }
  return [...bad];
}

function uvToolInstall(ctx, spec, force=false) {
  const python = ctx.opts.python || process.env.ASKAI_PYTHON || ctx.manifest.python || '3.13';
  const label = `uv tool install -p ${python} ${spec}`, args = ['tool', 'install', '-p', python, spec];
  if(force)args.push('--force');
  const live = { inherit: true, timeout: 900000 };
  repairUvLinks(ctx);
  let r = ctx.act(label, 'uv', args, live);
  if (ctx.dry || r.ok) return r;
  // Run again with the output captured, so the reason is known and a named stale link can be repaired (uv caches the download).
  ctx.log.info('uv tool install failed; re-running with the output captured to find the cause');
  r = ctx.act(label, 'uv', args, { timeout: 900000 });
  if (!r.ok && /Executable already exists/i.test(`${r.stdout}\n${r.stderr}`)) {
    ctx.log.info('uv tool install: overwriting existing executable stub with --force');
    r = ctx.act(`${label} --force`, 'uv', ['tool', 'install', '--force', '-p', python, spec], live);
  }
  if (!r.ok && repairUvLinks(ctx, `${r.stdout}\n${r.stderr}`).length) r = ctx.act(label, 'uv', args, live);
  if (!r.ok && /Querying Python|0xc0e90002|interpreter.*failed/i.test(`${r.stdout}\n${r.stderr}`)) ctx.log.warn('Python could not start. Use an existing compatible interpreter with --python PATH or ASKAI_PYTHON; AskAI does not change OS security settings.');
  return r;
}

// Put the dir holding a uv tool's binary on the user PATH so the tool works in a shell too (serena's MCP entry uses the
// absolute path and does not need it). Only an entry askai actually added is recorded, so uninstall never removes one the user had.
function uvBinPath(ctx, id, exe) {
  if (!exe) return;
  const dir = path.dirname(exe);
  const res = ctx.editPath(dir, true);
  if (res !== 'planned') ctx.log.info(`user PATH: ${res} (${dir})`);
  if (res === 'changed') record(ctx, id, { pathDir: dir });
  else if (/^error/.test(res)) ctx.log.warn(`could not add ${dir} to the user PATH; \`${id}\` is still installed there`);
}
// Serena and markitdown share uv's bin dir. Removing the PATH entry while the other tool is still installed would break it,
// so the entry is handed to the remaining tool's record and removed when that one goes.
function uvBinUnpath(ctx, id) {
  const rec = ctx.manifest.components[id] || {};
  if (!rec.pathDir) return;
  const others = ['serena', 'markitdown'].filter(x => x !== id && uvToolExe(ctx, x));
  if (others.length) { record(ctx, others[0], { pathDir: rec.pathDir }); ctx.log.info(`user PATH: ${rec.pathDir} kept, ${others[0]} still uses it`); return; }
  ctx.log.info(`user PATH: ${ctx.editPath(rec.pathDir, false)} (${rec.pathDir}, added by askai)`);
}

// An earlier askai run that failed at the uv step was followed by a manual uv install of the same tool: askai owns it.
const interruptedUvInstall = (ctx, id) => (ctx.manifest.runs || []).some(run => (run.results || []).some(x => x.id === id && x.result === 'failed' && /uv tool install/.test(x.detail || '')));

// The serena binary, shared by the Claude and the Cursor component: uv tool install when missing, `serena init`, uv's bin dir on the
// user PATH. Ownership is recorded under `serena` as soon as it is known (askai installed it, or finished an install that failed).
function ensureSerenaTool(ctx) {
  let exe = serenaExe(ctx);
  const broken = isBrokenTrampoline(ctx, exe);
  const pre = !!exe && !broken;
  // Present before this run only because an earlier askai run got as far as `uv tool install` and was finished by hand: still askai's.
  const adopt = pre && !wasAdded(ctx, 'serena') && interruptedUvInstall(ctx, 'serena');
  if (adopt) {
    ctx.log.info('serena: an earlier askai run failed at the uv step and the tool was installed by hand afterwards; recording it as installed by askai');
    record(ctx, 'serena', { installedByAskai: true });
  }
  if (!exe || broken) {
    if (!ctx.which('uv')) wingetInstall(ctx, 'astral-sh.uv', () => !!ctx.which('uv'));
    const r = uvToolInstall(ctx, 'serena-agent');
    if (!ctx.dry && !r.ok) throw new Error(`uv tool install serena-agent failed (exit ${r.status})`);
    if (ctx._trampolineCache && exe) ctx._trampolineCache.delete(exe);
    delete ctx._uvToolList;
    exe = serenaExe(ctx);
    if (!ctx.dry && !exe) throw new Error('serena installed but serena binary not found; check `uv tool dir --bin`');
    // Recorded now, not after the MCP step: if a later step fails, uninstall --tools must still know this tool is askai's.
    record(ctx, 'serena', { installedByAskai: true });
    const init = ctx.act('serena init', exe || 'serena', ['init'], { timeout: 90000 });
    if (!ctx.dry && !init.ok) ctx.log.warn(`serena init did not finish cleanly (${firstLine(init.stderr || init.error) || `exit ${init.status}`}); Serena creates its config on first use`);
  }
  uvBinPath(ctx, 'serena', exe);
  return exe;
}

const serena = {
  id: 'serena', title: 'Serena (symbol-level code navigation)', evidence: 'unmeasured',
  plan: 'winget install astral-sh.uv if missing; uv tool install -p 3.13 serena-agent (a stale uv python link is repaired if it blocks this); serena init; add its bin dir to the user PATH; claude mcp add --scope user serena (dashboard auto-open off)',
  detect(ctx) {
    const exe = serenaExe(ctx), reg = !!mcpServers(ctx).serena;
    if (exe && isBrokenTrampoline(ctx, exe)) return { state: 'partial', detail: reg ? 'broken uv trampoline stub (MCP registered)' : 'broken uv trampoline stub' };
    if (exe && reg) return { state: 'ok', detail: 'installed, MCP registered (user scope)' };
    if (exe) return { state: 'partial', detail: 'installed, MCP server not registered' };
    return { state: reg ? 'partial' : 'missing', detail: reg ? 'MCP registered but serena binary not found' : 'not installed' };
  },
  install(ctx) {
    const claudeBin = ctx.claudeBin();
    if (!claudeBin && !ctx.dry) throw new Error('claude CLI not found; install Claude Code first (component "claude")');
    const exe = ensureSerenaTool(ctx);
    if (!mcpServers(ctx).serena) {
      ctx.backup(ctx.paths.userJson);
      const r = ctx.act('claude mcp add serena', claudeBin || 'claude', ['mcp', 'add', '--scope', 'user', 'serena', '--', exe || 'serena', ...MCP_ARGS], { timeout: 60000 });
      if (!ctx.dry && !r.ok && !/already/i.test(r.stdout + r.stderr)) throw new Error(`claude mcp add serena failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      record(ctx, 'serena', { installedByAskai: wasAdded(ctx, 'serena'), mcp: true });
    } else record(ctx, 'serena', { installedByAskai: wasAdded(ctx, 'serena') });
  },
  update(ctx) {
    if (!ctx.which('uv')) throw new Error('uv not found');
    const exe = serenaExe(ctx);
    if (!exe || isBrokenTrampoline(ctx, exe) || !uvToolInstalled(ctx, 'serena-agent')) {
      ctx.log.info('serena: tool is not installed via uv; skipped (install with askai install --add serena)');
      return;
    }
    ctx.act('uv tool upgrade serena-agent', 'uv', ['tool', 'upgrade', 'serena-agent'], { inherit: true, timeout: 900000 });
  },
  uninstall(ctx) {
    const claudeBin = ctx.claudeBin();
    const rec = ctx.manifest.components.serena || {};
    const mine = ctx.opts.force || !!rec.mcp;
    if (claudeBin && mcpServers(ctx).serena) {
      if (mine) {
        ctx.backup(ctx.paths.userJson);
        ctx.act('claude mcp remove serena', claudeBin, ['mcp', 'remove', '--scope', 'user', 'serena'], { timeout: 60000 });
      } else ctx.log.info('serena: MCP server was not registered by askai, left in place (use --force to remove)');
    }
    if (!ctx.opts.tools) return;
    if (ctx.which('uv') && (ctx.opts.force || rec.installedByAskai)) ctx.act('uv tool uninstall serena-agent', 'uv', ['tool', 'uninstall', 'serena-agent'], { timeout: 300000 });
    else if (serenaExe(ctx)) ctx.log.info('serena: tool was not installed by askai, left in place (use --force to remove)');
    uvBinUnpath(ctx, 'serena');
  },
};

// ---- Cursor: the same tools, registered in Cursor's own config ------------------------------------------------------------
// Each one is the twin of a Claude component. The tool binaries (rtk, serena) stay owned by the Claude component's record
// (ensureRtk / ensureSerenaTool write it); the Cursor record only says which config entries askai added, so uninstall removes
// those and nothing else. A sandboxed run (--claude-home) has no Cursor directory unless --cursor-home names one.
function needCursor(ctx) {
  if (!ctx.cursorPaths) throw new Error('the Cursor config directory is unknown: a run with --claude-home needs --cursor-home DIR too');
  return ctx.cursorPaths;
}
const noCursor = { state: 'other', detail: 'no Cursor config directory (sandboxed run without --cursor-home)' };
const cursorRec = (ctx, id) => ctx.manifest.components[id] || {};

const cursorRtk = {
  id: 'cursor-rtk', host: 'cursor', mirrors: 'rtk', title: 'RTK for Cursor (shell output compression hook)', evidence: 'reported',
  plan: "winget install rtk-ai.rtk if missing; rtk init -g --agent cursor --auto-patch (registers RTK's shell hook in ~/.cursor/hooks.json); backup first",
  detect(ctx) {
    if (!ctx.cursorPaths) return noCursor;
    if (!ctx.which('rtk')) return { state: 'missing', detail: 'rtk not on PATH' };
    return cursor.rtkHooked(ctx)
      ? { state: 'ok', detail: `RTK hook registered in ${ctx.cursorPaths.hooks}` }
      : { state: 'partial', detail: 'rtk installed, no RTK hook in hooks.json' };
  },
  install(ctx) {
    const p = needCursor(ctx);
    ensureRtk(ctx);
    let ranInit = false;
    if (!cursor.rtkHooked(ctx)) {
      ranInit = true;
      if (ctx.opts.cursorHome && !samePath(p.home, cursor.defaultCursorHome())) ctx.log.warn(`rtk init writes to the real ${cursor.defaultCursorHome()}; --cursor-home only changes where askai looks`);
      ctx.backup(p.hooks);
      const r = ctx.act('rtk init -g --agent cursor --auto-patch', 'rtk', ['init', '-g', '--agent', 'cursor', '--auto-patch'], { timeout: 120000 });
      if (!ctx.dry && !r.ok) throw new Error(`rtk init --agent cursor failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      if (!ctx.dry && !cursor.rtkHooked(ctx)) throw new Error(`rtk init ran but no rtk hook is in ${p.hooks}; run \`rtk init -g --agent cursor --show\``);
    }
    record(ctx, 'cursor-rtk', { hook: ranInit || !!cursorRec(ctx, 'cursor-rtk').hook });
  },
  update(ctx) {
    // The rtk binary is upgraded by the rtk component; this only puts back a hook that went missing.
    if (!ctx.cursorPaths || !ctx.manifest.components['cursor-rtk'] || ctx.dry) return;
    if (ctx.which('rtk') && !cursor.rtkHooked(ctx)) cursorRtk.install(ctx);
  },
  // The hook entries are removed only when askai registered them (manifest), or with --force. The rtk binary is the rtk component's.
  uninstall(ctx) {
    if (!ctx.cursorPaths || !cursor.rtkHooked(ctx)) return;
    if (!ctx.opts.force && !cursorRec(ctx, 'cursor-rtk').hook) { ctx.log.info('cursor-rtk: hook was not registered by askai, left in place (use --force to remove)'); return; }
    let n = 0;
    ctx.editJson(ctx.cursorPaths.hooks, j => { n = cursor.removeRtkHooks(j); });
    ctx.log.info(`cursor-rtk: ${n} RTK hook entr${n === 1 ? 'y' : 'ies'} removed from ${ctx.cursorPaths.hooks}`);
  },
};

// Context Mode outside Claude Code is its npm package. Cursor gets the MCP tools only: the routing hooks are Claude Code's, so
// the always-applied user rule (cursor-rules) is what steers the agent to ctx_* tools.
const CONTEXT_MODE_VERSION = '1.0.169';
const cursorContextMode = {
  id: 'cursor-context-mode', host: 'cursor', mirrors: 'context-mode', title: 'Context Mode for Cursor (MCP server)', evidence: 'reported',
  plan: `npm install -g context-mode@${CONTEXT_MODE_VERSION} if missing (needs Node >= 22.5; if this machine's own Node is older, nvm installs a second, pinned Node 22 just for this, leaving the default node alone); add a "context-mode" entry to ~/.cursor/mcp.json (MCP tools only; Cursor does not run its hooks)`,
  detect(ctx) {
    if (!ctx.cursorPaths) return noCursor;
    const entry = cursor.mcpServers(ctx)['context-mode'], exe = !!ctx.which('context-mode');
    if (entry && (exe || entry.command !== 'context-mode')) return { state: 'ok', detail: 'MCP entry present in mcp.json' };
    if (entry) return { state: 'partial', detail: 'MCP entry present but `context-mode` is not on PATH' };
    return exe ? { state: 'partial', detail: 'installed, no MCP entry in mcp.json' } : { state: 'missing', detail: 'not installed' };
  },
  install(ctx) {
    needCursor(ctx);
    const pinned = !ctx.dry && !nodeOk(ctx.nodeVersion) ? ensurePinnedNode(ctx) : null;
    const pre = pinned ? isPinnedEntry(cursor.mcpServers(ctx)['context-mode']) : !!ctx.which('context-mode');
    if (!pre) {
      const npmCmd = pinned ? path.join(pinned.dir, process.platform === 'win32' ? 'npm.cmd' : 'npm') : 'npm';
      if (!pinned && !ctx.which('npm') && !ctx.dry) throw new Error('npm not found; install Node.js (npm ships with it), then re-run');
      const env = pinned ? { PATH: `${pinned.dir}${path.delimiter}${process.env.PATH || ''}` } : undefined;
      const r = ctx.act(`${pinned ? `${pinned.node} ` : ''}npm install -g context-mode@${CONTEXT_MODE_VERSION}${pinned ? ' (pinned Node, not this machine\'s default)' : ''}`, npmCmd, ['install', '-g', `context-mode@${CONTEXT_MODE_VERSION}`], { inherit: true, timeout: 600000, env });
      if (!pinned) ctx.refreshPath();
      if (!ctx.dry && !r.ok) throw new Error(`npm install -g context-mode failed (exit ${r.status})`);
      if (!pinned && !ctx.dry && !ctx.which('context-mode')) throw new Error('context-mode installed but is not on PATH yet; open a new terminal and re-run `askai install`');
      // Recorded now, not after the MCP step: if that fails, uninstall --tools must still know the package is askai's.
      record(ctx, 'cursor-context-mode', { installedByAskai: true });
    }
    const entry = pinned ? { command: pinned.node, args: [path.join(pinned.dir, 'context-mode')] } : { command: 'context-mode' };
    const res = cursor.addMcp(ctx, 'context-mode', entry);
    if (res === 'present') ctx.log.info('cursor: mcp.json already has a context-mode entry, left as it is');
    record(ctx, 'cursor-context-mode', { installedByAskai: !pre || wasAdded(ctx, 'cursor-context-mode'), mcp: res === 'added' || !!cursorRec(ctx, 'cursor-context-mode').mcp });
  },
  update(ctx) {
    if (!ctx.cursorPaths || !ctx.manifest.components['cursor-context-mode']) return;
    const entry = cursor.mcpServers(ctx)['context-mode'];
    if (isPinnedEntry(entry)) {
      const dir = path.dirname(entry.command);
      return ctx.act('npm install -g context-mode@latest (pinned Node)', path.join(dir, process.platform === 'win32' ? 'npm.cmd' : 'npm'), ['install', '-g', 'context-mode@latest'], { inherit: true, timeout: 600000, env: { PATH: `${dir}${path.delimiter}${process.env.PATH || ''}` } });
    }
    if (!ctx.which('npm')) throw new Error('npm not found');
    ctx.act('npm install -g context-mode@latest', 'npm', ['install', '-g', 'context-mode@latest'], { inherit: true, timeout: 600000 });
  },
  uninstall(ctx) {
    if (!ctx.cursorPaths) return;
    const rec = cursorRec(ctx, 'cursor-context-mode');
    const entry = cursor.mcpServers(ctx)['context-mode'];
    if (entry) {
      if (ctx.opts.force || rec.mcp) { cursor.removeMcp(ctx, 'context-mode'); ctx.log.info(`cursor-context-mode: MCP entry removed from ${ctx.cursorPaths.mcp}`); }
      else ctx.log.info('cursor-context-mode: MCP entry was not added by askai, left in place (use --force to remove)');
    }
    if (!ctx.opts.tools) return;
    if (isPinnedEntry(entry)) {
      if (ctx.opts.force || rec.installedByAskai) { const dir = path.dirname(entry.command); ctx.act('npm uninstall -g context-mode (pinned Node)', path.join(dir, process.platform === 'win32' ? 'npm.cmd' : 'npm'), ['uninstall', '-g', 'context-mode'], { timeout: 300000, env: { PATH: `${dir}${path.delimiter}${process.env.PATH || ''}` } }); ctx.log.info('cursor-context-mode: the pinned Node it ran under (installed by nvm) is left in place; remove it yourself with `nvm uninstall 22` if nothing else uses it'); }
      return;
    }
    if (ctx.which('npm') && (ctx.opts.force || rec.installedByAskai)) ctx.act('npm uninstall -g context-mode', 'npm', ['uninstall', '-g', 'context-mode'], { timeout: 300000 });
    else if (ctx.which('context-mode')) ctx.log.info('cursor-context-mode: package was not installed by askai, left in place (use --force to remove)');
  },
};

// Serena's docs recommend the `ide` context and the working directory as the project for editor clients such as Cursor.
const CURSOR_SERENA_ARGS = ['start-mcp-server', '--context', 'ide', '--project-from-cwd', '--open-web-dashboard', 'False'];
const cursorSerena = {
  id: 'cursor-serena', host: 'cursor', mirrors: 'serena', title: 'Serena for Cursor (MCP server)', evidence: 'unmeasured',
  plan: 'winget install astral-sh.uv if missing; uv tool install -p 3.13 serena-agent; serena init; add a "serena" entry (--context ide, project from the working directory) to ~/.cursor/mcp.json',
  detect(ctx) {
    if (!ctx.cursorPaths) return noCursor;
    const exe = serenaExe(ctx), reg = !!cursor.mcpServers(ctx).serena;
    if (exe && isBrokenTrampoline(ctx, exe)) return { state: 'partial', detail: reg ? 'broken uv trampoline stub (MCP registered)' : 'broken uv trampoline stub' };
    if (exe && reg) return { state: 'ok', detail: 'installed, MCP entry present in mcp.json' };
    if (exe) return { state: 'partial', detail: 'installed, no MCP entry in mcp.json' };
    return { state: reg ? 'partial' : 'missing', detail: reg ? 'MCP entry present but serena binary not found' : 'not installed' };
  },
  install(ctx) {
    needCursor(ctx);
    const exe = ensureSerenaTool(ctx);
    const res = cursor.addMcp(ctx, 'serena', { command: exe || 'serena', args: CURSOR_SERENA_ARGS });
    if (res === 'present') ctx.log.info('cursor: mcp.json already has a serena entry, left as it is');
    record(ctx, 'cursor-serena', { mcp: res === 'added' || !!cursorRec(ctx, 'cursor-serena').mcp });
  },
  update() { /* the uv tool is upgraded by the serena component; the mcp.json entry does not change */ },
  // The uv tool belongs to the serena component (it goes with `uninstall --tools`); this removes only the mcp.json entry.
  uninstall(ctx) {
    if (!ctx.cursorPaths || !cursor.mcpServers(ctx).serena) return;
    if (ctx.opts.force || cursorRec(ctx, 'cursor-serena').mcp) { cursor.removeMcp(ctx, 'serena'); ctx.log.info(`cursor-serena: MCP entry removed from ${ctx.cursorPaths.mcp}`); }
    else ctx.log.info('cursor-serena: MCP entry was not added by askai, left in place (use --force to remove)');
  },
};

// Cursor documents machine-local user rules at ~/.cursor/rules. Writing them at install means every project on this
// machine gets the token rules without a second `askai project` step. `askai project` still writes the same files into
// one repo for git; using both loads the always-applied file twice.
function cursorRuleProfile(ctx) {
  try { return profiles.get(ctx.opts.profile || ctx.manifest.profile).name; } catch (_) { return profiles.DEFAULT; }
}
const cursorRules = {
  id: 'cursor-rules', host: 'cursor', mirrors: 'rules', title: 'Cursor user rules (~/.cursor/rules)', evidence: 'unmeasured',
  plan: 'writes ~/.cursor/rules/askai-*.mdc for the profile (always-applied token rules, plus glob-scoped code and document rules). Cursor loads these in every project on this machine. A file without the askai marker is left alone',
  detect(ctx) {
    if (!ctx.cursorPaths) return noCursor;
    const files = cursorProjectFiles(ctx, cursorRuleProfile(ctx));
    const rd = cursor.userRulesDir(ctx.cursorPaths.home);
    const differ = files.filter(f => cfg.readText(path.join(rd, f.name)) !== f.text);
    let names = [];
    try { names = fs.readdirSync(rd); } catch (_) { /* no rules dir yet */ }
    const wanted = new Set(files.map(f => f.name));
    const extra = names.filter(n => /^askai-.*\.mdc$/.test(n) && !wanted.has(n) && String(cfg.readText(path.join(rd, n)) || '').includes(rulesLib.MDC_MARKER));
    if (!differ.length && !extra.length) return { state: 'ok', detail: `${files.map(f => f.name).join(', ')} in ${rd}` };
    if (differ.length === files.length && !extra.length) return { state: 'missing', detail: `user rules not written in ${rd}` };
    return { state: 'partial', detail: `user rules in ${rd} differ from the ${cursorRuleProfile(ctx)} profile` };
  },
  install(ctx) {
    const rd = cursor.userRulesDir(needCursor(ctx).home);
    const files = cursorProjectFiles(ctx, cursorRuleProfile(ctx));
    const res = cursor.writeRulesAt(ctx, rd, files, !!ctx.opts.force);
    for (const [label, names] of [['written', res.written], ['unchanged', res.unchanged], ['removed', res.removed]]) {
      if (names.length) ctx.log.info(`cursor-rules: ${label} ${names.join(', ')}`);
    }
    if (res.skipped.length) ctx.log.warn(`cursor-rules: left in place (not written by askai): ${res.skipped.join(', ')} (use --force to overwrite)`);
    record(ctx, 'cursor-rules', { installedByAskai: true, files: files.map(f => f.name) });
  },
  update(ctx) {
    if (!ctx.cursorPaths || !ctx.manifest.components['cursor-rules'] || ctx.dry) return;
    if (cursorRules.detect(ctx).state !== 'ok') cursorRules.install(ctx);
  },
  uninstall(ctx) {
    if (!ctx.cursorPaths) return;
    if (!ctx.opts.force && !ctx.manifest.components['cursor-rules']) { ctx.log.info('cursor-rules: not set up by askai, left in place (use --force to remove)'); return; }
    const gone = cursor.removeRulesAt(ctx, cursor.userRulesDir(ctx.cursorPaths.home));
    if (gone.length) ctx.log.info(`cursor-rules: removed ${gone.join(', ')}`);
  },
};

// ---- derived text: which tools the CLAUDE.md block and the rule files may mention -----------------------------------------
// Ids of the tools the agent can use right now, for Claude Code (default) or Cursor. Cheap and read-only on purpose (settings.json,
// .claude.json, mcp.json, PATH): it runs on every install and must not shell out to the claude CLI.
const RULE_TOOLS = ['context-mode', 'serena', 'markitdown'];
function presence(ctx, host) {
  const has = [];
  if (host === 'cursor') {
    const servers = cursor.mcpServers(ctx);
    if (servers['context-mode']) has.push('context-mode');
    if (servers.serena && serenaExe(ctx)) has.push('serena');
  } else {
    const ep = ctx.settings().enabledPlugins;
    if (ep && typeof ep === 'object' && Object.entries(ep).some(([k, v]) => k.split('@')[0] === 'context-mode' && v !== false)) has.push('context-mode');
    if (mcpServers(ctx).serena && serenaExe(ctx)) has.push('serena');
  }
  if (uvToolExe(ctx, 'markitdown')) has.push('markitdown');
  return has.filter(id => RULE_TOOLS.includes(id));
}

const markitdown = {
  id: 'markitdown', host: 'any', title: 'markitdown (PDF and Office files to Markdown)', evidence: 'unmeasured', optIn: true, optInFlag: 'markitdown',
  plan: `winget install astral-sh.uv if missing; uv tool install -p 3.13 ${MARKITDOWN_SPEC} (Microsoft, runs locally; converts a document to Markdown once so it is read as text); add its bin dir to the user PATH`,
  detect(ctx) {
    const exe = uvToolExe(ctx, 'markitdown');
    if (!exe) return { state: 'missing', detail: 'not installed' };
    if (isBrokenTrampoline(ctx, exe)) {
      return { state: 'partial', detail: 'broken uv trampoline stub' };
    }
    return { state: 'ok', detail: 'installed' };
  },
  install(ctx) {
    let exe = uvToolExe(ctx, 'markitdown');
    const broken = isBrokenTrampoline(ctx, exe);
    const pre = !!exe && !broken;
    const adopt = pre && !wasAdded(ctx, 'markitdown') && interruptedUvInstall(ctx, 'markitdown');
    if (adopt) ctx.log.info('markitdown: an earlier askai run failed at the uv step and the tool was installed by hand afterwards; recording it as installed by askai');
    const desktopExtras=ctx.opts.desktopExtras && ctx.manifest.components?.markitdown?.desktopFormats!==1;
    if (!exe || broken || desktopExtras) {
      if (!ctx.which('uv')) wingetInstall(ctx, 'astral-sh.uv', () => !!ctx.which('uv'));
      const r = uvToolInstall(ctx, MARKITDOWN_SPEC,!!desktopExtras);
      if (!ctx.dry && !r.ok) throw new Error(`uv tool install ${MARKITDOWN_SPEC} failed (exit ${r.status})`);
      if (ctx._trampolineCache && exe) ctx._trampolineCache.delete(exe);
      delete ctx._uvToolList;
      exe = uvToolExe(ctx, 'markitdown');
      if (!ctx.dry && !exe) throw new Error('markitdown installed but its binary was not found; check `uv tool dir --bin`');
      record(ctx, 'markitdown', { installedByAskai: true });
    }
    uvBinPath(ctx, 'markitdown', exe);
    record(ctx, 'markitdown', { installedByAskai: !pre || adopt || wasAdded(ctx, 'markitdown') });
    if(ctx.opts.desktopExtras)record(ctx,'markitdown',{desktopFormats:1});
  },
  update(ctx) {
    if (!ctx.which('uv')) throw new Error('uv not found');
    ctx.act('uv tool upgrade markitdown', 'uv', ['tool', 'upgrade', 'markitdown'], { inherit: true, timeout: 900000 });
  },
  uninstall(ctx) {
    if (!ctx.opts.tools) return;
    const rec = ctx.manifest.components.markitdown || {};
    if (ctx.which('uv') && (ctx.opts.force || rec.installedByAskai)) ctx.act('uv tool uninstall markitdown', 'uv', ['tool', 'uninstall', 'markitdown'], { timeout: 300000 });
    else if (uvToolExe(ctx, 'markitdown')) ctx.log.info('markitdown: not installed by askai, left in place (use --force to remove)');
    uvBinUnpath(ctx, 'markitdown');
  },
};

// Usage and cost report over the local transcripts. It saves nothing itself; askai report shows its output next to the savings.
// Pinned to the version that was checked (MIT licence, no dependencies); `askai update` moves it to the latest release.
const CCUSAGE_VERSION = '20.0.24';
const ccusage = {
  id: 'ccusage', title: 'ccusage (usage and cost report from local transcripts)', evidence: 'none', optIn: true, optInFlag: 'ccusage',
  plan: `npm install -g ccusage@${CCUSAGE_VERSION} (third-party; reads the local ~/.claude transcripts; it may fetch model prices over the network when it runs)`,
  detect(ctx) {
    return ctx.which('ccusage') ? { state: 'ok', detail: 'installed' } : { state: 'missing', detail: 'not installed' };
  },
  install(ctx) {
    const pre = !!ctx.which('ccusage');
    if (!pre) {
      if (!ctx.which('npm') && !ctx.dry) throw new Error('npm not found; install Node.js (npm ships with it), then re-run');
      const r = ctx.act(`npm install -g ccusage@${CCUSAGE_VERSION}`, 'npm', ['install', '-g', `ccusage@${CCUSAGE_VERSION}`], { inherit: true, timeout: 600000 });
      ctx.refreshPath();
      if (!ctx.dry && !r.ok) throw new Error(`npm install -g ccusage failed (exit ${r.status})`);
      if (!ctx.dry && !ctx.which('ccusage')) throw new Error('ccusage installed but is not on PATH yet; open a new terminal and re-run `askai install --ccusage`');
    }
    record(ctx, 'ccusage', { installedByAskai: !pre || wasAdded(ctx, 'ccusage') });
  },
  update(ctx) {
    if (!ctx.which('npm')) throw new Error('npm not found');
    ctx.act('npm install -g ccusage@latest', 'npm', ['install', '-g', 'ccusage@latest'], { inherit: true, timeout: 600000 });
  },
  uninstall(ctx) {
    if (!ctx.opts.tools) return;
    if (ctx.which('npm') && (ctx.opts.force || wasAdded(ctx, 'ccusage'))) ctx.act('npm uninstall -g ccusage', 'npm', ['uninstall', '-g', 'ccusage'], { timeout: 300000 });
    else if (ctx.which('ccusage')) ctx.log.info('ccusage: not installed by askai, left in place (use --force to remove)');
  },
};

const caveman = {
  id: 'caveman', title: 'Caveman terse style + token rules (CLAUDE.md block)', evidence: 'unmeasured',
  plan: 'CLAUDE.md: managed block with token rules (only for the tools present) and the terse-output directive (skipped if CLAUDE.md already has one); backup first',
  detect(ctx) {
    const text = cfg.readText(ctx.paths.claudeMd) || '';
    if (text.includes(cfg.BEGIN.slice(0, 20))) return { state: 'ok', detail: 'managed block present' };
    return { state: 'missing', detail: cfg.hasTerseOutside(text) ? 'no managed block (terse directive already in CLAUDE.md)' : 'no managed block' };
  },
  install(ctx) {
    const level = ctx.opts.caveman || (ctx.manifest.components.caveman || {}).level || 'full';
    const text = cfg.readText(ctx.paths.claudeMd) || '';
    const body = cfg.buildBlockBody(text, level, presence(ctx));
    const { text: next, changed } = cfg.upsertBlock(text, body);
    if (!changed) { ctx.log.info('CLAUDE.md block already up to date'); return; }
    if (ctx.dry) { ctx.log.info(`would write managed block to ${ctx.paths.claudeMd} (caveman: ${level}${cfg.hasTerseOutside(text) ? ', terse directive already present outside block, not duplicated' : ''})`); return; }
    ctx.backup(ctx.paths.claudeMd);
    cfg.writeAtomic(ctx.paths.claudeMd, next);
    record(ctx, 'caveman', { level });
  },
  update(ctx) { caveman.install(ctx); },
  uninstall(ctx) {
    const text = cfg.readText(ctx.paths.claudeMd);
    if (text == null) return;
    const { text: next, changed } = cfg.removeBlock(text);
    if (!changed) return;
    if (ctx.dry) { ctx.log.info('would remove the managed block from CLAUDE.md'); return; }
    ctx.backup(ctx.paths.claudeMd);
    cfg.writeAtomic(ctx.paths.claudeMd, next);
  },
};

const cavemanPlugin = {
  id: 'caveman-plugin', title: 'Caveman plugin (optional, adds its own hooks)', evidence: 'unmeasured', optIn: true, optInFlag: 'cavemanPlugin',
  plan: 'claude plugin marketplace add JuliusBrussee/caveman; claude plugin install caveman@caveman (SessionStart + UserPromptSubmit hooks; may double the CLAUDE.md terse directive)',
  detect(ctx) {
    const st = pluginState(ctx, 'caveman');
    return { state: st === 'enabled' ? 'ok' : 'missing', detail: `plugin ${st}` };
  },
  install(ctx) {
    if (/^\s*#\s*Terse output/mi.test(cfg.readText(ctx.paths.claudeMd) || '')) ctx.log.warn('CLAUDE.md already has a terse-output directive; the plugin adds a second one (tokens on every session)');
    const pre = pluginState(ctx, 'caveman') === 'enabled';
    if (!pre) addPlugin(ctx, 'JuliusBrussee/caveman', 'caveman', 'caveman');
    record(ctx, 'caveman-plugin', { installedByAskai: !pre || wasAdded(ctx, 'caveman-plugin') });
  },
  update(ctx) { updatePlugin(ctx, 'caveman', 'caveman'); },
  uninstall(ctx) { uninstallPlugin(ctx, 'caveman', 'caveman-plugin'); },
};

const statusCommand = ctx => `node "${path.join(ctx.paths.app, 'askai.js').replace(/\\/g, '/')}" statusline`;
const statusline = {
  id: 'statusline', title: 'Status line (measured savings)', evidence: 'measured',
  plan: 'settings.json: statusLine -> `askai statusline` (RTK savings + Context Mode line); skipped if you already have a statusLine',
  detect(ctx) {
    const cur = ctx.settings().statusLine;
    if (!cur) return { state: 'missing', detail: 'no statusLine' };
    return cfg.setStatusLine({ statusLine: cur }, statusCommand(ctx)) === 'kept-other'
      ? { state: 'other', detail: 'another statusLine is set; askai leaves it alone' }
      : { state: 'ok', detail: 'askai statusline set' };
  },
  install(ctx) {
    let res;
    ctx.editSettings(s => { res = cfg.setStatusLine(s, statusCommand(ctx)); });
    if (res === 'kept-other') ctx.log.info('statusLine: existing one kept; use `askai status` for the savings view');
    else record(ctx, 'statusline', { set: true });
  },
  update(ctx) { statusline.install(ctx); },
  uninstall(ctx) {
    ctx.editSettings(s => { if (cfg.setStatusLine({ statusLine: s.statusLine }, 'x') !== 'kept-other' && s.statusLine) delete s.statusLine; });
  },
};

// ---- path-scoped rule files (~/.claude/rules/askai-<kind>.md) ---------------------------------------------------------------
// The kinds come from the profile in use: --profile, else the one recorded by the last install, else the default.
function ruleKinds(ctx) {
  try { return profiles.get(ctx.opts.profile || ctx.manifest.profile).rules; } catch (_) { return profiles.get().rules; }
}
const ruleFile = (ctx, kind) => path.join(ctx.paths.rules, rulesLib.fileName(kind));

// Writes the rule file of each kind for the tools present, and removes files of kinds that are no longer wanted.
// The manifest keeps a hash of what askai wrote: a file that no longer matches was edited by the user and is left alone
// (--force overwrites or removes it).
function syncRules(ctx, kinds) {
  const rec = ctx.manifest.components.rules || {};
  const files = { ...(rec.files || {}) };
  const present = presence(ctx);
  const mineUnchanged = (kind, have) => have !== null && files[kind] && rulesLib.sha(have) === files[kind];
  for (const kind of kinds) {
    const p = ruleFile(ctx, kind), want = rulesLib.render(kind, present);
    if (want === null) continue;
    const have = cfg.readText(p);
    if (have === want) { files[kind] = rulesLib.sha(want); continue; }
    if (have !== null && !ctx.opts.force && !mineUnchanged(kind, have)) {
      ctx.log.warn(`rules: ${p} was edited after askai wrote it, or is not askai's; left as is (--force overwrites it)`);
      continue;
    }
    if (ctx.dry) { ctx.log.plan(`write ${p} (${kind} rules)`); continue; }
    if (have !== null) ctx.backup(p);
    cfg.writeAtomic(p, want);
    files[kind] = rulesLib.sha(want);
    ctx.log.info(`rules: wrote ${p}`);
  }
  for (const kind of new Set([...Object.keys(files), ...(ctx.opts.force ? rulesLib.kinds() : [])])) {
    if (kinds.includes(kind)) continue;
    const p = ruleFile(ctx, kind), have = cfg.readText(p);
    if (have === null) { delete files[kind]; continue; }
    if (!ctx.opts.force && !mineUnchanged(kind, have)) { ctx.log.info(`rules: ${p} was edited after askai wrote it, left in place`); delete files[kind]; continue; }
    if (ctx.dry) { ctx.log.plan(`remove ${p}`); continue; }
    ctx.backup(p);
    fs.unlinkSync(p);
    delete files[kind];
    ctx.log.info(`rules: removed ${p}`);
  }
  if (!ctx.dry) record(ctx, 'rules', { installedByAskai: Object.keys(files).length > 0, files });
}

const rules = {
  id: 'rules', title: 'Path-scoped rules (~/.claude/rules)', evidence: 'unmeasured', optIn: true,
  plan: 'writes ~/.claude/rules/askai-<kind>.md for the profile (coding and/or docs). Each rule has a paths: list, so Claude loads it only when it reads a matching file; backup first',
  detect(ctx) {
    const kinds = ruleKinds(ctx);
    // Rule files askai wrote for a wider profile: reported as partial so that installing a narrower profile removes them.
    const stale = Object.keys((ctx.manifest.components.rules || {}).files || {}).filter(k => !kinds.includes(k) && fs.existsSync(ruleFile(ctx, k)));
    if (stale.length) return { state: 'partial', detail: `${stale.join(', ')} rules left from another profile` };
    if (!kinds.length) return { state: 'ok', detail: 'no rule files in this profile' };
    const have = kinds.filter(k => fs.existsSync(ruleFile(ctx, k)));
    if (have.length === kinds.length) return { state: 'ok', detail: `${kinds.join(' + ')} rules present` };
    return have.length ? { state: 'partial', detail: `${have.join(', ')} present, ${kinds.filter(k => !have.includes(k)).join(', ')} missing` } : { state: 'missing', detail: `${kinds.join(' + ')} rules not written` };
  },
  install(ctx) { syncRules(ctx, ruleKinds(ctx)); },
  update(ctx) { syncRules(ctx, Object.keys((ctx.manifest.components.rules || {}).files || {})); },
  uninstall(ctx) { syncRules(ctx, []); },
};

// ---- Cursor project rules (<dir>/.cursor/rules/askai-*.mdc) ------------------------------------------------------------------
// The rule files of one project for `profileName` and the tools Cursor has now -> [{ name, text }].
function cursorProjectFiles(ctx, profileName) {
  const prof = profiles.get(profileName);
  const level = ctx.opts.caveman || (ctx.manifest.components.caveman || {}).level || 'full';
  return cursor.projectFiles(prof, presence(ctx, 'cursor'), level);
}
// Writes them (and removes marked askai files that are no longer wanted). -> cursor.writeProject result.
function syncCursorProject(ctx, dir, profileName, force) {
  return cursor.writeProject(ctx, dir, cursorProjectFiles(ctx, profileName), !!force);
}

// The derived files (CLAUDE.md block, rule files, Cursor project rules) follow the set of tools that is present, so they are
// rewritten after any install, update or uninstall. Only what askai already manages is touched: an existing block, rule files it
// wrote, and the projects it was asked to set up (`askai project`).
function refreshDerived(ctx) {
  if (ctx.dry) return;
  const text = cfg.readText(ctx.paths.claudeMd) || '';
  if (text.includes(cfg.BEGIN.slice(0, 20))) caveman.install(ctx);
  // Refresh rule text only where askai's rule files still exist: after an uninstall removed them, nothing is re-created.
  const hasAskai = dir => { try { return fs.readdirSync(dir).some(f => /^askai-/.test(f)); } catch (_) { return false; } };
  const kinds = Object.keys((ctx.manifest.components.rules || {}).files || {});
  if (kinds.length && hasAskai(path.join(ctx.paths.home, 'rules'))) syncRules(ctx, kinds);
  for (const [dir, info] of Object.entries(ctx.manifest.cursorProjects || {})) {
    if (!fs.existsSync(dir)) continue;
    try { syncCursorProject(ctx, dir, info && info.profile); } catch (e) { ctx.log.warn(`cursor project ${dir}: ${e.message}`); }
  }
  if (ctx.cursorPaths && ctx.manifest.components['cursor-rules'] && hasAskai(cursor.userRulesDir(ctx.cursorPaths.home))) {
    try { cursor.writeRulesAt(ctx, cursor.userRulesDir(ctx.cursorPaths.home), cursorProjectFiles(ctx, cursorRuleProfile(ctx)), false); }
    catch (e) { ctx.log.warn(`cursor user rules: ${e.message}`); }
  }
}

// Codex, Antigravity, the cross-host handoff and the opt-in lean settings (lib/agents.js) use the helpers above.
const agentComps = require('./agents').make({ ensureRtk, ensureSerenaTool, serenaExe, uvToolExe, uvToolInstall, isBrokenTrampoline, addPlugin, pluginState });
const ALL = [claude, baseline, rtk, contextMode, serena, cursorRtk, cursorContextMode, cursorSerena, markitdown, cursorRules, ccusage, caveman, cavemanPlugin, rules, statusline, ...agentComps];
// token-kit runs first: it removes a previous standalone run before the components below write the same settings.
ALL.unshift(...ALL.splice(ALL.findIndex(c => c.id === 'token-kit'), 1));

module.exports = {
  ALL, byId: id => ALL.find(c => c.id === id), pluginState, serenaExe, uvToolExe, uvToolPython, rtkHooked, nodeOk, mcpServers, statusCommand,
  presence, refreshDerived, cursorProjectFiles, syncCursorProject, ruleKinds, ensureRtk, ensureSerenaTool, CCUSAGE_VERSION, CONTEXT_MODE_VERSION,
};
