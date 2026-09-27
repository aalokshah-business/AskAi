'use strict';
// The tools askai installs and wires up. askai contributes no hooks of its own: every hook that fires on a prompt
// or tool call comes from RTK (settings.json) or a plugin (Context Mode, optional Caveman plugin).
//
// ctx contract (built in askai.js, faked in tests):
//   paths, opts, dry, env, log, which(name), claudeBin(), probe(cmd,args,o) (read-only, always runs),
//   act(label,cmd,args,o) (mutating, skipped in dry-run), refreshPath(), settings(), editSettings(fn), backup(file),
//   editPath(dir, add) (user PATH; returns 'changed' | 'unchanged' | 'planned' | 'skipped (...)' | 'error: ...'),
//   manifest, nodeVersion
// Each component: { id, title, evidence, plan, detect(ctx) -> {state,detail}, install(ctx), update(ctx), uninstall(ctx) }
// state: ok | partial | missing | other.  evidence: measured | reported | unmeasured | none.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');

const WG = ['--exact', '--accept-package-agreements', '--accept-source-agreements'];

const firstLine = s => String(s || '').trim().split(/\r?\n/)[0];
function version(ctx, cmd, args = ['--version']) {
  const r = ctx.probe(cmd, args, { timeout: 20000 });
  return r.ok ? firstLine(r.stdout || r.stderr) : null;
}

function wingetInstall(ctx, id, present) {
  if (process.platform !== 'win32') throw new Error(`${id}: winget is Windows-only, install it manually (see README)`);
  if (!ctx.which('winget')) throw new Error(`winget not found; install ${id} manually, then re-run`);
  const r = ctx.act(`winget install ${id}`, 'winget', ['install', '--id', id, ...WG], { inherit: true, timeout: 900000 });
  ctx.refreshPath();
  if (ctx.dry) return;
  if (!present()) {
    throw new Error(r.ok
      ? `${id} installed but is not on PATH yet; open a new terminal and re-run \`askai install\``
      : `winget install ${id} failed (exit ${r.status})`);
  }
}
function wingetUpgrade(ctx, id) {
  if (!ctx.which('winget')) return;
  ctx.act(`winget upgrade ${id}`, 'winget', ['upgrade', '--id', id, ...WG], { inherit: true, timeout: 900000 });
  ctx.refreshPath();
}
function wingetUninstall(ctx, id) {
  if (ctx.which('winget')) ctx.act(`winget uninstall ${id}`, 'winget', ['uninstall', '--id', id, '--exact'], { inherit: true, timeout: 600000 });
}

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
    return b ? { state: 'ok', detail: version(ctx, b) || b } : { state: 'missing', detail: 'claude CLI not found' };
  },
  install(ctx) {
    wingetInstall(ctx, 'Anthropic.ClaudeCode', () => !!ctx.claudeBin());
    record(ctx, 'claude', { installedByAskai: true });
  },
  update(ctx) { wingetUpgrade(ctx, 'Anthropic.ClaudeCode'); },
  uninstall(ctx) { if (ctx.opts.tools && wasAdded(ctx, 'claude')) wingetUninstall(ctx, 'Anthropic.ClaudeCode'); },
};

const baseline = {
  id: 'baseline', title: 'Settings baseline', evidence: 'none',
  plan: 'settings.json: add (never override) CLAUDE_CODE_SUBAGENT_MODEL=sonnet, autoCompactWindow=150000, name-only skillOverrides; remove leftover self-built askai hook registrations',
  detect(ctx) {
    const probe = JSON.parse(JSON.stringify(ctx.settings()));
    const missing = cfg.applyBaseline(probe).length;
    return missing ? { state: 'partial', detail: `${missing} baseline key(s) not set` } : { state: 'ok', detail: 'all baseline keys present' };
  },
  install(ctx) {
    let added = [], legacy = 0;
    ctx.editSettings(s => { added = cfg.applyBaseline(s); legacy = cfg.removeLegacyHooks(s); });
    const seen = new Map((ctx.manifest.settings || []).map(e => [e.key, e]));
    for (const a of added) seen.set(a.key, a);
    ctx.manifest.settings = [...seen.values()];
    ctx.log.info(`baseline: ${added.length} key(s) added${legacy ? `, ${legacy} legacy askai hook(s) removed` : ''}`);
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
const rtk = {
  id: 'rtk', title: 'RTK (Bash output compression)', evidence: 'measured',
  plan: 'winget install rtk-ai.rtk; check `rtk gain` works; winget install BurntSushi.ripgrep.MSVC if rg is missing; `rtk init -g --auto-patch` (registers a PreToolUse hook on Bash)',
  detect(ctx) {
    if (!ctx.which('rtk')) return { state: 'missing', detail: 'rtk not on PATH' };
    const v = version(ctx, 'rtk');
    if (!ctx.probe('rtk', ['gain'], { timeout: 20000 }).ok) return { state: 'partial', detail: `${v || 'rtk'} but \`rtk gain\` fails: wrong package ("Rust Type Kit") or broken install` };
    if (!rtkHooked(ctx)) return { state: 'partial', detail: `${v || 'rtk'} installed, hook not registered` };
    return { state: 'ok', detail: `${v || 'rtk'}, PreToolUse hook registered` };
  },
  install(ctx) {
    const pre = !!ctx.which('rtk');
    if (!pre) wingetInstall(ctx, 'rtk-ai.rtk', () => !!ctx.which('rtk'));
    if (!ctx.dry && !ctx.probe('rtk', ['gain'], { timeout: 20000 }).ok) {
      throw new Error('`rtk gain` fails: this is not rtk-ai/rtk (probably the unrelated "Rust Type Kit"). Uninstall it and install rtk-ai.rtk');
    }
    if (!ctx.which('rg')) {
      try { wingetInstall(ctx, 'BurntSushi.ripgrep.MSVC', () => !!ctx.which('rg')); } catch (e) { ctx.log.warn(`ripgrep not installed (some RTK filters need rg): ${e.message}`); }
    }
    let ranInit = false;
    if (!rtkHooked(ctx)) {
      ranInit = true;
      ctx.backup(ctx.paths.settings);
      ctx.backup(ctx.paths.claudeMd);
      const r = ctx.act('rtk init -g --auto-patch', 'rtk', ['init', '-g', '--auto-patch'], { timeout: 120000 });
      if (!ctx.dry && !r.ok) throw new Error(`rtk init failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      if (!ctx.dry && !rtkHooked(ctx)) throw new Error('rtk init ran but no rtk hook is registered in settings.json; run `rtk init -g --show`');
    }
    record(ctx, 'rtk', { installedByAskai: !pre || wasAdded(ctx, 'rtk'), hook: ranInit || !!(ctx.manifest.components.rtk && ctx.manifest.components.rtk.hook) });
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
const contextMode = {
  id: 'context-mode', title: 'Context Mode (sandboxed tool output + session memory)', evidence: 'reported',
  plan: 'claude plugin marketplace add mksglu/context-mode; claude plugin install context-mode@context-mode (plugin hooks + ctx_* MCP tools; needs Node >= 22.5)',
  detect(ctx) {
    const st = pluginState(ctx, 'context-mode');
    if (st === 'enabled') return { state: nodeOk(ctx.nodeVersion) ? 'ok' : 'partial', detail: nodeOk(ctx.nodeVersion) ? 'plugin enabled' : `plugin enabled but Node ${ctx.nodeVersion} < 22.5` };
    return { state: st === 'disabled' ? 'partial' : 'missing', detail: st === 'unknown' ? 'claude CLI not found' : `plugin ${st}` };
  },
  install(ctx) {
    if (!nodeOk(ctx.nodeVersion)) throw new Error(`Node ${ctx.nodeVersion} is too old for Context Mode (needs >= 22.5); install Node LTS`);
    const pre = pluginState(ctx, 'context-mode') === 'enabled';
    if (!pre) addPlugin(ctx, 'mksglu/context-mode', 'context-mode', 'context-mode');
    record(ctx, 'context-mode', { installedByAskai: !pre || wasAdded(ctx, 'context-mode') });
  },
  update(ctx) { updatePlugin(ctx, 'context-mode', 'context-mode'); },
  uninstall(ctx) { uninstallPlugin(ctx, 'context-mode', 'context-mode'); },
};

function serenaExe(ctx) {
  const onPath = ctx.which('serena');
  if (onPath) return onPath;
  const uv = ctx.which('uv');
  if (!uv) return null;
  const r = ctx.probe(uv, ['tool', 'dir', '--bin'], { timeout: 20000 });
  if (!r.ok) return null;
  const exe = path.join(firstLine(r.stdout), process.platform === 'win32' ? 'serena.exe' : 'serena');
  return fs.existsSync(exe) ? exe : null;
}
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

function uvToolInstall(ctx) {
  const label = 'uv tool install -p 3.13 serena-agent', args = ['tool', 'install', '-p', '3.13', 'serena-agent'];
  const live = { inherit: true, timeout: 900000 };
  repairUvLinks(ctx);
  let r = ctx.act(label, 'uv', args, live);
  if (ctx.dry || r.ok) return r;
  // Run again with the output captured, so the reason is known and a named stale link can be repaired (uv caches the download).
  ctx.log.info('uv tool install failed; re-running with the output captured to find the cause');
  r = ctx.act(label, 'uv', args, { timeout: 900000 });
  if (!r.ok && repairUvLinks(ctx, `${r.stdout}\n${r.stderr}`).length) r = ctx.act(label, 'uv', args, live);
  return r;
}

// Put the dir holding the serena binary on the user PATH so `serena` works in a shell too (the MCP entry uses the absolute
// path and does not need it). Only an entry askai actually added is recorded, so uninstall never removes one the user had.
function serenaPath(ctx, exe) {
  if (!exe) return;
  const dir = path.dirname(exe);
  const res = ctx.editPath(dir, true);
  if (res !== 'planned') ctx.log.info(`user PATH: ${res} (${dir})`);
  if (res === 'changed') record(ctx, 'serena', { pathDir: dir });
  else if (/^error/.test(res)) ctx.log.warn(`could not add ${dir} to the user PATH; \`serena\` still works through the MCP entry`);
}

// An earlier askai run that failed at the uv step was followed by a manual uv install of the same tool: askai owns it.
const interruptedUvInstall = ctx => (ctx.manifest.runs || []).some(run => (run.results || []).some(x => x.id === 'serena' && x.result === 'failed' && /uv tool install/.test(x.detail || '')));

const serena = {
  id: 'serena', title: 'Serena (symbol-level code navigation)', evidence: 'unmeasured',
  plan: 'winget install astral-sh.uv if missing; uv tool install -p 3.13 serena-agent (a stale uv python link is repaired if it blocks this); serena init; add its bin dir to the user PATH; claude mcp add --scope user serena (dashboard auto-open off)',
  detect(ctx) {
    const exe = serenaExe(ctx), reg = !!mcpServers(ctx).serena;
    if (exe && reg) return { state: 'ok', detail: 'installed, MCP registered (user scope)' };
    if (exe) return { state: 'partial', detail: 'installed, MCP server not registered' };
    return { state: reg ? 'partial' : 'missing', detail: reg ? 'MCP registered but serena binary not found' : 'not installed' };
  },
  install(ctx) {
    const claudeBin = ctx.claudeBin();
    if (!claudeBin && !ctx.dry) throw new Error('claude CLI not found; install Claude Code first (component "claude")');
    let exe = serenaExe(ctx);
    const pre = !!exe;
    // Present before this run only because an earlier askai run got as far as `uv tool install` and was finished by hand: still askai's.
    const adopt = pre && !wasAdded(ctx, 'serena') && interruptedUvInstall(ctx);
    if (adopt) ctx.log.info('serena: an earlier askai run failed at the uv step and the tool was installed by hand afterwards; recording it as installed by askai');
    if (!exe) {
      if (!ctx.which('uv')) wingetInstall(ctx, 'astral-sh.uv', () => !!ctx.which('uv'));
      const r = uvToolInstall(ctx);
      if (!ctx.dry && !r.ok) throw new Error(`uv tool install serena-agent failed (exit ${r.status})`);
      exe = serenaExe(ctx);
      if (!ctx.dry && !exe) throw new Error('serena installed but serena binary not found; check `uv tool dir --bin`');
      // Recorded now, not after the MCP step: if a later step fails, uninstall --tools must still know this tool is askai's.
      record(ctx, 'serena', { installedByAskai: true });
      const init = ctx.act('serena init', exe || 'serena', ['init'], { timeout: 90000 });
      if (!ctx.dry && !init.ok) ctx.log.warn(`serena init did not finish cleanly (${firstLine(init.stderr || init.error) || `exit ${init.status}`}); Serena creates its config on first use`);
    }
    serenaPath(ctx, exe);
    const mine = !pre || adopt || wasAdded(ctx, 'serena');
    if (!mcpServers(ctx).serena) {
      ctx.backup(ctx.paths.userJson);
      const r = ctx.act('claude mcp add serena', claudeBin || 'claude', ['mcp', 'add', '--scope', 'user', 'serena', '--', exe || 'serena', ...MCP_ARGS], { timeout: 60000 });
      if (!ctx.dry && !r.ok && !/already/i.test(r.stdout + r.stderr)) throw new Error(`claude mcp add serena failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      record(ctx, 'serena', { installedByAskai: mine, mcp: true });
    } else record(ctx, 'serena', { installedByAskai: mine });
  },
  update(ctx) {
    if (!ctx.which('uv')) throw new Error('uv not found');
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
    if (rec.pathDir) ctx.log.info(`user PATH: ${ctx.editPath(rec.pathDir, false)} (${rec.pathDir}, added by askai)`);
  },
};

const caveman = {
  id: 'caveman', title: 'Caveman terse style + token rules (CLAUDE.md block)', evidence: 'unmeasured',
  plan: 'CLAUDE.md: managed block with token rules and the terse-output directive (skipped if CLAUDE.md already has one); backup first',
  detect(ctx) {
    const text = cfg.readText(ctx.paths.claudeMd) || '';
    if (text.includes(cfg.BEGIN.slice(0, 20))) return { state: 'ok', detail: 'managed block present' };
    return { state: 'missing', detail: cfg.hasTerseOutside(text) ? 'no managed block (terse directive already in CLAUDE.md)' : 'no managed block' };
  },
  install(ctx) {
    const level = ctx.opts.caveman || 'full';
    const text = cfg.readText(ctx.paths.claudeMd) || '';
    const body = cfg.buildBlockBody(text, level);
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
  id: 'caveman-plugin', title: 'Caveman plugin (optional, adds its own hooks)', evidence: 'unmeasured', optIn: true,
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

const ALL = [claude, baseline, rtk, contextMode, serena, caveman, cavemanPlugin, statusline];

module.exports = { ALL, byId: id => ALL.find(c => c.id === id), pluginState, serenaExe, rtkHooked, nodeOk, mcpServers, statusCommand };
