#!/usr/bin/env node
'use strict';
// askai: installs and wires up existing token-saving tools (RTK, Context Mode, Serena, Caveman) for Claude Code and shows
// the savings those tools measure. It registers no hooks of its own; see README.md.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const cfg = require('./lib/claude-config');
const S = require('./lib/sys');
const comps = require('./lib/components');
const status = require('./lib/status');
const winpath = require('./lib/winpath');

const VERSION = '2.0.0';
const SRC = __dirname;

const HELP = `askai ${VERSION}: install and wire up token-saving tools for Claude Code

Usage: askai <command> [options]

Commands
  install     install/wire up RTK, Context Mode, Serena, Caveman block, status line (skips what is already ok)
  update      upgrade the installed tools (winget upgrade, plugin update, uv tool upgrade)
  status      per-tool state, what is wired where, and the savings the tools measure
  doctor      health checks (exit 1 on a failure)
  report [h]  everything in one: tool status + measured savings, health checks, transcript spend for the last h hours (default 6)
  uninstall   remove only what askai added (backups are kept)
  restore [stamp]  list backups, or restore settings.json / CLAUDE.md / .claude.json from one
  statusline  one line for Claude Code's statusLine (reads session JSON on stdin)

Options
  --yes, -y            do not ask for confirmation
  --dry-run            show what would happen; nothing is written or installed
  --only a,b           only these components (claude,baseline,rtk,context-mode,serena,caveman,caveman-plugin,statusline)
  --skip a,b           skip these components
  --caveman LEVEL      lite | full | ultra | off (default full): terse-output directive in the CLAUDE.md block
  --caveman-plugin     also install the Caveman plugin (adds its own hooks; off by default)
  --no-statusline      do not set the status line
  --no-path            do not add askai to the user PATH
  --tools              uninstall: also remove tools askai installed with winget/uv
  --force              install: re-run components that already look ok; uninstall: also remove tools askai did not add
  --claude-home DIR    use DIR instead of ~/.claude (testing aid; RTK's own \`init -g\` may still write to ~/.claude)
  --json               machine-readable output (status, doctor)
  --hours N            report window in hours
`;

// ---- args --------------------------------------------------------------------------------------------------------
const BOOL = { yes: 'yes', y: 'yes', 'dry-run': 'dry', json: 'json', 'no-statusline': 'noStatusline', 'no-path': 'noPath', 'caveman-plugin': 'cavemanPlugin', tools: 'tools', force: 'force', help: 'help', h: 'help' };
const VAL = { only: 'only', skip: 'skip', caveman: 'caveman', 'claude-home': 'claudeHome', hours: 'hours' };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') || a === '-') { o._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq < 0 ? a : a.slice(0, eq)).replace(/^--?/, '');
    if (has(BOOL, key)) o[BOOL[key]] = true;
    else if (has(VAL, key)) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) throw new Error(`option ${a} needs a value`);
      o[VAL[key]] = v;
    } else throw new Error(`unknown option ${a} (see askai help)`);
  }
  if (o.caveman !== undefined && !['lite', 'full', 'ultra', 'off'].includes(o.caveman)) throw new Error('--caveman must be lite, full, ultra or off');
  return o;
}
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

// ---- context -----------------------------------------------------------------------------------------------------
function makeLog(quiet) {
  const w = (fn, m) => { if (!quiet) fn(m); };
  return {
    info: m => w(console.log, `  ${m}`),
    warn: m => w(console.warn, `  warning: ${m}`),
    step: m => w(console.log, `  > ${m}`),
    plan: m => w(console.log, `  [dry-run] ${m}`),
  };
}

function buildCtx(o, quiet) {
  const sandbox = !!(o.claudeHome || process.env.CLAUDE_CONFIG_DIR);
  const home = path.resolve(o.claudeHome || cfg.defaultClaudeHome());
  const paths = cfg.claudePaths(home, sandbox);
  const dry = !!o.dry;
  const log = makeLog(quiet);
  const env = { RTK_TELEMETRY_DISABLED: '1', ...(o.claudeHome ? { CLAUDE_CONFIG_DIR: home } : {}) };
  const backup = dry ? () => null : cfg.makeBackup(paths, new Date().toISOString().replace(/[:.]/g, '-'));

  let manifest;
  try { manifest = cfg.loadManifest(paths); } catch (e) { log.warn(`${e.message}; starting a fresh manifest`); manifest = { version: 1, runs: [], settings: [], components: {} }; }

  const ctx = {
    paths, opts: o, dry, env, log, sandbox, manifest, backup,
    nodeVersion: process.versions.node,
    which: S.which,
    claudeBin: () => S.findClaude(),
    refreshPath: () => S.refreshPath(),
    probe: (cmd, args, opts) => S.run(cmd, args, { env, ...opts }),
    act(label, cmd, args, opts) {
      if (dry) { log.plan(label); return { ok: true, status: 0, stdout: '', stderr: '', error: null }; }
      log.step(label);
      return S.run(cmd, args, { env, ...opts });
    },
    settings: () => cfg.readJson(paths.settings),
    editSettings(fn) {
      const s = cfg.readJson(paths.settings);
      const before = JSON.stringify(s);
      fn(s);
      if (JSON.stringify(s) === before) return false;
      if (dry) { log.plan(`update ${paths.settings}`); return true; }
      backup(paths.settings);
      cfg.writeJson(paths.settings, s);
      return true;
    },
    // Add/remove one dir on the Windows user PATH. Returns 'changed' | 'unchanged' | 'planned' | 'skipped (...)' | 'error: ...'.
    editPath(dir, add) {
      if (!S.IS_WIN) return 'skipped (not Windows)';
      if (o.noPath) return 'skipped (--no-path)';
      if (sandbox) return 'skipped (custom claude home)';
      if (dry) { log.plan(`${add ? 'add' : 'remove'} ${dir} ${add ? 'to' : 'from'} user PATH`); return 'planned'; }
      return winpath.editUserPath(S.run, dir, add);
    },
  };
  return ctx;
}

function saveManifest(ctx, command, results) {
  if (ctx.dry) return;
  const m = ctx.manifest;
  m.askaiVersion = VERSION;
  m.runs = [...(m.runs || []), { at: new Date().toISOString(), command, results }].slice(-20);
  ctx.backup(ctx.paths.manifest);
  cfg.saveManifest(ctx.paths, m);
}

// Refuse to touch a settings/.claude.json file we cannot parse.
function preflight(ctx) {
  ctx.refreshPath(); // a shell opened before winget/uv changed the user PATH would otherwise report the tools as missing
  cfg.readJson(ctx.paths.settings);
  if (fs.existsSync(ctx.paths.userJson)) cfg.readJson(ctx.paths.userJson);
}

function select(o, forUninstall) {
  const known = comps.ALL.map(c => c.id);
  const only = list(o.only), skip = list(o.skip);
  for (const id of [...only, ...skip]) if (!known.includes(id)) throw new Error(`unknown component "${id}" (known: ${known.join(', ')})`);
  let sel = comps.ALL.filter(c => only.length ? only.includes(c.id) : (forUninstall || !c.optIn || o.cavemanPlugin));
  if (o.noStatusline && !only.length) sel = sel.filter(c => c.id !== 'statusline');
  sel = sel.filter(c => !skip.includes(c.id));
  return forUninstall ? [...sel].reverse() : sel;
}

function safeDetect(c, ctx) {
  try { return c.detect(ctx); } catch (e) { return { state: 'partial', detail: `check failed: ${e.message}` }; }
}

async function confirm(o, msg) {
  if (o.yes || o.dry) return true;
  if (!process.stdin.isTTY) { console.error(`${msg}\nNot interactive: re-run with --yes to proceed.`); return false; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(res => rl.question(`${msg} [y/N] `, res));
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const askaiCmd = ctx => `node "${path.join(ctx.paths.app, 'askai.js').replace(/\\/g, '/')}"`;

// ---- self install: app copy, shim, slash commands, PATH ---------------------------------------------------------------
function copyApp(ctx) {
  const dest = ctx.paths.app;
  if (path.resolve(SRC) === path.resolve(dest)) return 'running from the installed copy';
  if (ctx.dry) { ctx.log.plan(`copy askai to ${dest}`); return 'planned'; }
  fs.mkdirSync(dest, { recursive: true });
  for (const d of ['lib', 'commands']) {
    fs.rmSync(path.join(dest, d), { recursive: true, force: true });
    fs.cpSync(path.join(SRC, d), path.join(dest, d), { recursive: true });
  }
  fs.mkdirSync(path.join(dest, 'hooks'), { recursive: true });
  for (const f of ['askai.js', 'package.json', path.join('hooks', 'askai-report.js')]) {
    if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(dest, f));
  }
  return `copied to ${dest}`;
}

function writeShim(ctx) {
  const win = process.platform === 'win32';
  const file = path.join(ctx.paths.bin, win ? 'askai.cmd' : 'askai');
  const text = win ? '@echo off\r\nnode "%~dp0..\\app\\askai.js" %*\r\n' : '#!/bin/sh\nexec node "$(dirname "$0")/../app/askai.js" "$@"\n';
  if (ctx.dry) { ctx.log.plan(`write ${file}`); return; }
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  cfg.writeAtomic(file, text);
  if (!win) fs.chmodSync(file, 0o755);
}

function installCommands(ctx) {
  const dir = path.join(ctx.paths.home, 'commands');
  const files = ctx.manifest.files = (ctx.manifest.files || []);
  const names = fs.readdirSync(path.join(SRC, 'commands')).filter(n => n.endsWith('.md'));
  let changed = 0;
  for (const n of names) {
    const text = fs.readFileSync(path.join(SRC, 'commands', n), 'utf8').replace(/\{\{ASKAI\}\}/g, () => askaiCmd(ctx));
    const target = path.join(dir, n);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) continue;
    changed++;
    if (ctx.dry) { ctx.log.plan(`write ${target}`); continue; }
    ctx.backup(target);
    cfg.writeAtomic(target, text);
    const i = files.findIndex(f => f.path === target);
    const rec = { path: target, sha: sha(text) };
    if (i >= 0) files[i] = rec; else files.push(rec);
  }
  return changed;
}

function removeCommands(ctx) {
  const files = ctx.manifest.files || [];
  const kept = [];
  for (const f of files) {
    let text = null;
    try { text = fs.readFileSync(f.path, 'utf8'); } catch (_) { /* gone */ }
    if (text === null) continue;
    if (sha(text) !== f.sha) { ctx.log.warn(`${f.path} was edited after askai wrote it, left in place`); kept.push(f); continue; }
    if (ctx.dry) { ctx.log.plan(`remove ${f.path}`); kept.push(f); continue; }
    ctx.backup(f.path);
    fs.rmSync(f.path, { force: true });
  }
  ctx.manifest.files = kept;
}

const pathStep = (ctx, add) => ctx.editPath(ctx.paths.bin, add);

// ---- commands ----------------------------------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);

async function cmdInstall(o) {
  const ctx = buildCtx(o);
  preflight(ctx);
  const sel = select(o, false);
  const rows = sel.map(c => {
    const d = safeDetect(c, ctx);
    const skip = d.state === 'other' || (d.state === 'ok' && !o.force && !(c.id === 'caveman' && o.caveman));
    return { c, d, skip };
  });

  console.log(`askai install${o.dry ? ' (dry-run: nothing is written or installed)' : ''}   claude home: ${ctx.paths.home}\n`);
  const w = Math.max(...rows.map(r => r.c.id.length));
  for (const r of rows) {
    console.log(`  ${pad(r.c.id, w)}  ${pad(r.d.state, 7)}  ${r.skip ? `skip: ${r.d.detail}` : `will install/wire: ${r.c.plan}`}`);
  }
  console.log(`  ${pad('askai', w)}          copy to ${ctx.paths.app}, shim in ${ctx.paths.bin}${o.noPath || ctx.sandbox || !S.IS_WIN ? '' : ' (added to user PATH)'}, /askai-status and /askai-report commands`);
  console.log('\nBacks up settings.json, CLAUDE.md and .claude.json before every change; existing keys and hooks are kept.');
  if (!await confirm(o, '\nProceed?')) { console.log('Aborted, nothing changed.'); return 1; }

  const results = [];
  console.log('\n[askai] app, shim, commands');
  try {
    console.log(`  app: ${copyApp(ctx)}`);
    writeShim(ctx);
    console.log(`  slash commands: ${installCommands(ctx)} written`);
    console.log(`  user PATH: ${pathStep(ctx, true)}`);
    results.push({ id: 'askai', result: o.dry ? 'planned' : 'ok' });
  } catch (e) { console.error(`  failed: ${e.message}`); results.push({ id: 'askai', result: 'failed', detail: e.message }); }

  for (const r of rows) {
    if (r.skip) { results.push({ id: r.c.id, result: 'skipped', detail: r.d.detail }); continue; }
    console.log(`\n[${r.c.id}] ${r.c.title}`);
    try { r.c.install(ctx); results.push({ id: r.c.id, result: o.dry ? 'planned' : 'ok' }); }
    catch (e) { console.error(`  failed: ${e.message}`); results.push({ id: r.c.id, result: 'failed', detail: e.message }); }
  }

  const failed = results.filter(r => r.result === 'failed');
  try { saveManifest(ctx, 'install', results); } catch (e) { console.error(`could not save manifest: ${e.message}`); }

  console.log('\nSummary');
  for (const r of results) {
    const after = o.dry || r.id === 'askai' || r.result === 'failed' ? '' : `  now: ${safeDetect(comps.byId(r.id), ctx).state}`;
    console.log(`  ${pad(r.id, w)}  ${pad(r.result, 8)}${r.detail ? ` ${r.detail}` : ''}${after}`);
  }
  if (o.dry) console.log('\nDry-run only. Re-run without --dry-run to apply.');
  else if (failed.length) console.log(`\n${failed.length} component(s) failed. Fix the cause and re-run \`askai install\`: finished components are skipped.`);
  else console.log('\nDone. Open a NEW Claude Code session so hooks, plugins and MCP servers load, then run /askai-status.');
  if (!o.dry && !ctx.sandbox) console.log('Verify auto-firing: run any shell command in Claude Code, then `rtk gain`; `/context-mode:ctx-stats` shows Context Mode\'s numbers.');
  return failed.length ? 1 : 0;
}

async function cmdUpdate(o) {
  const ctx = buildCtx(o);
  preflight(ctx);
  console.log(`askai update${o.dry ? ' (dry-run)' : ''}\n`);
  let failed = 0;
  if (!o.dry) { try { copyApp(ctx); installCommands(ctx); } catch (e) { console.error(`  app refresh failed: ${e.message}`); failed++; } }
  for (const c of select(o, false)) {
    const d = safeDetect(c, ctx);
    if (d.state === 'missing') { console.log(`[${c.id}] not installed, skipped`); continue; }
    console.log(`[${c.id}]`);
    try { c.update(ctx); } catch (e) { console.error(`  failed: ${e.message}`); failed++; }
  }
  saveManifest(ctx, 'update', []);
  console.log(failed ? `\n${failed} failure(s).` : '\nDone. To update askai itself, pull its repo and re-run install.ps1.');
  return failed ? 1 : 0;
}

function cmdStatus(o) {
  const ctx = buildCtx(o, false);
  ctx.refreshPath();
  if (o.json) { console.log(JSON.stringify(status.collect(ctx), null, 2)); return 0; }
  console.log(status.renderStatus(ctx).lines.join('\n'));
  return 0;
}

function doctorLines(res) {
  const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  const n = l => res.filter(r => r.level === l).length;
  return [
    ...res.map(r => `${mark[r.level]}  ${pad(r.id, 14)} ${r.msg}`),
    '',
    `${n('ok')} ok, ${n('warn')} warning(s), ${n('fail')} failure(s)`,
  ];
}

function cmdDoctor(o) {
  const ctx = buildCtx(o, true);
  ctx.refreshPath();
  const res = status.doctor(ctx);
  if (o.json) console.log(JSON.stringify(res, null, 2));
  else console.log(doctorLines(res).join('\n'));
  return res.some(r => r.level === 'fail') ? 1 : 0;
}

// One view of everything: tool status and measured savings, health checks, then the transcript-based spend ledger.
// Each part is independent, so one failing does not hide the others.
function cmdReport(o) {
  const hours = String(o.hours || o._[1] || '6');
  const ctx = buildCtx(o, true);
  ctx.refreshPath();
  const part = fn => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } };
  const st = part(() => status.renderStatus(ctx));
  const dr = part(() => status.doctor(ctx));

  const script = path.join(SRC, 'hooks', 'askai-report.js');
  let spend = { ok: false, error: 'hooks/askai-report.js not found next to askai.js' };
  if (fs.existsSync(script)) {
    const r = require('child_process').spawnSync(process.execPath, [script, '--hours', hours, ...(o.json ? ['--json'] : [])], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    spend = r.status === 0 && !r.error ? { ok: true, text: r.stdout } : { ok: false, error: (r.error && r.error.message) || (r.stderr || '').trim() || `exit ${r.status}` };
  }

  if (o.json) {
    let spendJson = null;
    if (spend.ok) { try { spendJson = JSON.parse(spend.text); } catch (_) { spendJson = { raw: spend.text }; } }
    console.log(JSON.stringify({
      hours: Number(hours),
      tools: st.ok ? st.value.rows : { error: st.error },
      health: dr.ok ? dr.value : { error: dr.error },
      spend: spend.ok ? spendJson : { error: spend.error },
    }, null, 2));
    return spend.ok ? 0 : 1;
  }

  const head = t => `\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`;
  console.log(head('1/3  TOOLS AND MEASURED SAVINGS  (askai status)'));
  console.log(st.ok ? st.value.lines.join('\n') : `unavailable: ${st.error}`);
  console.log(head('2/3  HEALTH  (askai doctor)'));
  console.log(dr.ok ? doctorLines(dr.value).join('\n') : `unavailable: ${dr.error}`);
  console.log(head(`3/3  SPEND FROM TRANSCRIPTS, LAST ${hours}h  (where tokens actually went)`));
  console.log(spend.ok ? spend.text.trimEnd() : `unavailable: ${spend.error}`);
  return spend.ok ? 0 : 1;
}

async function cmdUninstall(o) {
  const ctx = buildCtx(o);
  preflight(ctx);
  const sel = select(o, true);
  const mine = (c, d) => {
    const rec = ctx.manifest.components[c.id] || {};
    if (c.id === 'baseline') return (ctx.manifest.settings || []).length > 0;
    if (c.id === 'caveman' || c.id === 'statusline') return d.state === 'ok';
    return !!(rec.installedByAskai || rec.hook || rec.mcp) || !!o.force;
  };
  const rows = sel.map(c => { const d = safeDetect(c, ctx); return { c, d, mine: d.state !== 'missing' && mine(c, d) }; });

  console.log(`askai uninstall${o.dry ? ' (dry-run)' : ''}   claude home: ${ctx.paths.home}\n`);
  const w = Math.max(...rows.map(r => r.c.id.length));
  for (const r of rows) {
    console.log(`  ${pad(r.c.id, w)}  ${pad(r.d.state, 7)}  ${r.mine ? 'remove' : 'keep (not added by askai, or not installed)'}`);
  }
  console.log('  Tools installed with winget/uv are kept unless --tools is given. Backups in ' + ctx.paths.backups + ' are kept.');
  if (!await confirm(o, '\nProceed?')) { console.log('Aborted, nothing changed.'); return 1; }

  let failed = 0;
  for (const r of rows) {
    if (!r.mine) continue;
    console.log(`\n[${r.c.id}]`);
    try { r.c.uninstall(ctx); } catch (e) { console.error(`  failed: ${e.message}`); failed++; }
  }
  console.log('\n[askai] commands, shim, PATH, app');
  try {
    removeCommands(ctx);
    console.log(`  user PATH: ${pathStep(ctx, false)}`);
    if (!o.dry) {
      for (const d of [ctx.paths.bin, ctx.paths.cache]) fs.rmSync(d, { recursive: true, force: true });
      if (path.resolve(SRC) !== path.resolve(ctx.paths.app)) fs.rmSync(ctx.paths.app, { recursive: true, force: true });
      else scheduleSelfRemoval(ctx);
    }
  } catch (e) { console.error(`  failed: ${e.message}`); failed++; }
  if (!o.dry && !failed) { try { ctx.backup(ctx.paths.manifest); fs.rmSync(ctx.paths.manifest, { force: true }); } catch (_) { /* keep */ } }
  else if (!o.dry) { ctx.manifest.components = {}; saveManifest(ctx, 'uninstall', []); }
  console.log(failed ? `\n${failed} failure(s); manifest kept.` : `\nDone. Backups: ${ctx.paths.backups}`);
  return failed ? 1 : 0;
}
// Running from the installed copy: node has read the script, so the files can go now; remove the app dir best effort.
function scheduleSelfRemoval(ctx) { try { fs.rmSync(ctx.paths.app, { recursive: true, force: true }); } catch (_) { /* Windows may hold a handle; harmless leftover */ } }

async function cmdRestore(o) {
  const ctx = buildCtx(o);
  const stamps = fs.existsSync(ctx.paths.backups) ? fs.readdirSync(ctx.paths.backups).filter(n => fs.statSync(path.join(ctx.paths.backups, n)).isDirectory()).sort() : [];
  const stamp = o._[1];
  if (!stamp) {
    if (!stamps.length) { console.log('No backups yet.'); return 0; }
    for (const s of stamps) console.log(`${s}   ${fs.readdirSync(path.join(ctx.paths.backups, s)).join(', ')}`);
    console.log('\nRestore with: askai restore <stamp>');
    return 0;
  }
  if (!stamps.includes(stamp)) { console.error(`no backup "${stamp}"; run \`askai restore\` to list them`); return 1; }
  const map = { 'settings.json': ctx.paths.settings, 'CLAUDE.md': ctx.paths.claudeMd, '.claude.json': ctx.paths.userJson };
  const dir = path.join(ctx.paths.backups, stamp);
  const todo = fs.readdirSync(dir).filter(n => has(map, n));
  if (!todo.length) { console.error('nothing restorable in that backup'); return 1; }
  console.log(`Will restore: ${todo.map(n => `${n} -> ${map[n]}`).join('; ')}\nThe current files are backed up first.`);
  if (!await confirm(o, 'Proceed?')) { console.log('Aborted.'); return 1; }
  for (const n of todo) {
    if (o.dry) { ctx.log.plan(`restore ${n}`); continue; }
    ctx.backup(map[n]);
    fs.copyFileSync(path.join(dir, n), map[n]);
    console.log(`restored ${map[n]}`);
  }
  return 0;
}

// Must never throw or print anything but the line: Claude Code shows whatever this writes.
function cmdStatusline(o) {
  let line = 'askai';
  try {
    let input = '';
    if (!process.stdin.isTTY) { try { input = fs.readFileSync(0, 'utf8'); } catch (_) { /* no stdin */ } }
    line = status.renderStatusline(buildCtx(o, true), input);
  } catch (_) { /* keep the fallback */ }
  process.stdout.write(line + '\n');
  return 0;
}

// ---- main --------------------------------------------------------------------------------------------------------
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let o;
  try { o = parseArgs(rest); } catch (e) { console.error(`askai: ${e.message}`); return 2; }
  o._.unshift(cmd);
  if (!cmd || cmd === 'help' || o.help) { console.log(HELP); return cmd ? 0 : 2; }
  switch (cmd) {
    case 'install': return cmdInstall(o);
    case 'update': return cmdUpdate(o);
    case 'status': return cmdStatus(o);
    case 'doctor': return cmdDoctor(o);
    case 'report': return cmdReport(o);
    case 'uninstall': return cmdUninstall(o);
    case 'restore': return cmdRestore(o);
    case 'statusline': return cmdStatusline(o);
    case 'version': case '--version': console.log(VERSION); return 0;
    default: console.error(`askai: unknown command "${cmd}"\n\n${HELP}`); return 2;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code || 0; }, e => { console.error(`askai: ${e.message}`); process.exitCode = 1; });
}
module.exports = { parseArgs, buildCtx, select, main, VERSION };
