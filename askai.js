#!/usr/bin/env node
'use strict';
// askai: installs and wires up existing token-saving tools (RTK, Context Mode, Serena, markitdown, Caveman, path-scoped rules,
// optionally ccusage) for Claude Code, Cursor, OpenAI Codex and Google Antigravity on Windows, macOS, Linux and WSL, by kind of work (profiles), and shows the savings those tools measure. It
// registers no hooks of its own; see README.md.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const cfg = require('./lib/claude-config');
const S = require('./lib/sys');
const comps = require('./lib/components');
const cursor = require('./lib/cursor');
const profiles = require('./lib/profiles');
const suggestLib = require('./lib/suggest');
const status = require('./lib/status');
const winpath = require('./lib/winpath');
const agents = require('./lib/agents');
const session = require('./lib/session');
const scaffold = require('./lib/scaffold');
const tips = require('./lib/tips');
const check = require('./lib/check');
const kb = require('./lib/kb');
const usage = require('./lib/usage');
const help = require('./lib/help');
const project = require('./lib/project');
const models = require('./lib/models');
const promptLib = require('./lib/prompt');
const guide = require('./lib/guide');
const mcpLib = require('./lib/mcp');
const audit = require('./lib/audit');
const infra = require('./lib/infra');
const plugins = require('./lib/plugins');
const launch = require('./lib/launch');
const hookLib = require('./lib/hook');
const todo = require('./lib/todo');

const VERSION = '1.0.0';
const SRC = __dirname;

const HELP = `askai ${VERSION}: make AI coding usage last longer. Installs and wires up token-saving tools for Claude Code, Cursor,
Every command in full: askai help all   One command: askai help <command>   Each plugin: askai plugins info <id>
Install or refresh from GitHub: README, Quick start (get.sh, get.ps1). askai upgrade fetches the latest AskAI and re-applies your profile.
OpenAI Codex and Google Antigravity, by kind of work, and keeps a hook-free session ledger so any agent can pick a task up again.

Usage: askai <command> [options]

Setup
  install     install/wire up the tools of a profile (default: coding) for every host in play; skips what is already ok
  update      upgrade the installed tools (winget/brew, plugin update, uv tool upgrade, npm)
  uninstall   remove only what askai added (backups are kept)
  restore [stamp]  list backups, or restore a backed-up settings / rules / MCP file
  profiles    list the profiles and what each installs
  suggest [dir]  which profile fits a directory (counts code and document files; read-only)
  scaffold [dir] write AGENTS.md, CLAUDE.md, docs/ai/PROJECT_PROFILE.md, .cursorignore and .ai-work/ into a repo (never overwrites)
  project [dir]  optional: copy the Cursor rules into one repo (dir/.cursor/rules) for git; --print shows them, --remove deletes them

Every day
  check [dir]       audit this machine (and a repo) against the token guidelines; each gap with the command that fixes it (--fix: repo)
  ask <words>       offline answers on etiquette and the research: askai ask compact | askai ask coming back after a break
  start | break | resume   session shortcuts: ledger entry; before-break checklist; time away, advice and the resume prompt (--copy)
  usage [days]      what Claude Code and Codex spent, from their local data (Antigravity, Cursor: their own views)
  help <command>    detailed help for one command (also: askai <command> --help); docs/ARCHITECTURE.md has all of it

Project and sessions (AskAI as the mediator)
  init [dir]        project knowledge pack: AGENTS.md router (<333 lines), CLAUDE.md, GEMINI.md, docs/ai/*, subagents and skills for all four tools
  map [dir]         regenerate docs/ai/PROJECT_MAP.md (folders, languages, commands, entry points; keeps your purposes)
  go <tool> "task"  start claude | codex | cursor | agy with the tier's model and effort fixed for the session (--tier lead|build|chore)
  prompt "ask"      turn a rough or dictated ask into a structured prompt (--tier --files --done --mode blunt|brutal|...; --output-safe CMD; --resume)
  models            model and effort per tier and tool (models set <tool>.<tier> <model>[:<effort>]; models verify)
  mcp               MCP servers in all four tools, on, off or parked (mcp off <name>, mcp on <name>)
  audit [dir]       the seven-point token audit: memory, tools, model, hooks, subagents, scheduled work, cache
  infra [dir]       everything AskAI set up, per tool and for the repo, with usage evidence
  guide [moment]    etiquette for install | start | work | break | resume | clear | compact | cache | models | subagents | mcp | output | prompts | docs | plugins | peak
  plugins           every token tool: evidence and state; plugins info <id> (commands, checks, savings, off switch), plugins install <id>, plugins decisions
  savings [days]    run each installed plugin's own savings report (rtk gain, ccusage, headroom stats, ...)
  todo              everything only you can do, per tool and for the repository (askai todo done <id> marks one)
  convert <file>    PDF, Office, HTML or a YouTube URL to Markdown (MarkItDown)
  clear [compact]   is it safe to /clear now (fresh handoff?) and the native command for the tool (--tool)
  work · etiquette  the working etiquette · all of it (same as askai guide work / askai guide all)
  continue          coming back: same as askai resume     checkpoint: record a ledger entry (--summary --next)
  diff · graph      git diff summary and whitespace check · the project's architecture diagram (docs/ai/ARCHITECTURE.md)
  context <pct>     what to do at this context level (or --used N --window M)
  docs [name]       where the install, architecture and guide documents are (--print shows one)
  session <action>  init | start | pause | resume | status | finish | measure | report  (local ledger in <repo>/.ai-work)
  tips [host]       offline cheat sheet: claude | codex | agy | cursor | session | habits (default: all)
  peak              is Claude in its peak hours now, and the peak window in your local time

Seeing what is saved
  status      profile, per-tool state, what is wired where, and the savings the tools measure
  doctor      health and billing-safety checks (exit 1 on a failure)
  report [h]  everything in one: status, doctor, cache and context per session, ccusage (if installed), transcript spend for h hours
  statusline  one line for Claude Code's statusLine (reads session JSON on stdin)

Install options
  --yes, -y            do not ask for confirmation            --dry-run   show what would happen; nothing is written or installed
  --target WHERE       auto | claude | cursor | both | codex | agy | all, or a list like claude,codex (default auto: Claude Code plus
                       every other host found on this machine)
  --profile NAME       minimal | coding | docs | full (default coding; the last install's profile is kept)
  --only a,b / --skip a,b   pick components (see README for the ids)
  --markitdown --ccusage    add those tools to the profile
  --rtk --context-mode      opt in to RTK / Context Mode (off by default: paired benchmarks found no net saving)
  --lsp ts,py               install Claude Code's official code-intelligence plugins (ts, py, kotlin, ruby, swift) and language servers
  --lean-git           also drop Claude Code's git instructions from every turn (lean settings are in every profile)
  --main-model M       Claude Code model when settings.json has none: haiku (default) | sonnet | opus | keep | a full model id
  --subagent-model M   CLAUDE_CODE_SUBAGENT_MODEL when unset (default haiku)
  --codex-model M      also set Codex's model when config.toml has none (for example a Luna-class model for routine work)
  --caveman LEVEL      lite | full | ultra | off (default full): terse-output directive in every host's rules
  --caveman-plugin     also install the Caveman plugin (adds its own hooks; off by default)
  --no-statusline --no-path --tools --force --print --remove --json --hours N   (see README)
  --claude-home DIR --cursor-home DIR --codex-home DIR --agy-home DIR   sandbox folders for testing (RTK's own init may still write
                       to the real ~/.claude, ~/.cursor, ~/.codex or ~/.gemini)

Session options
  --repo DIR (default: current directory)  --tool T  --model M  --effort E  --task "..."  --difficulty simple|moderate|hard
  --summary "..."  --next "..."  --result "..."  --minutes N  --input-tokens N  --output-tokens N  --cached-tokens N
  --success 0|1  --rework-minutes N  --usage-source "/usage|ccusage|dashboard|estimate"  --notes "..."
`;

// ---- args --------------------------------------------------------------------------------------------------------
const BOOL = { yes: 'yes', y: 'yes', 'dry-run': 'dry', json: 'json', 'no-statusline': 'noStatusline', 'no-path': 'noPath', 'caveman-plugin': 'cavemanPlugin', markitdown: 'markitdown', ccusage: 'ccusage', tools: 'tools', force: 'force', print: 'print', remove: 'remove', lean: 'lean', rtk: 'rtk', 'context-mode': 'contextMode', 'lean-git': 'leanGit', copy: 'copy', fix: 'fix', refresh: 'refresh', resume: 'resume', 'base-tools': 'baseTools', headroom: 'headroom', graphify: 'graphify', context7: 'context7', repomix: 'repomix', 'codebase-memory': 'codebaseMemory', 'claude-mem': 'claudeMem', all: 'all', help: 'help', h: 'help' };
const VAL = { output: 'output', kind: 'kind', about: 'about', type: 'type', tier: 'tier', files: 'files', done: 'done', mode: 'mode', used: 'used', window: 'window', 'output-safe': 'outputSafe', out: 'out', project: 'project', build: 'build', test: 'test', only: 'only', skip: 'skip', caveman: 'caveman', profile: 'profile', target: 'target', 'claude-home': 'claudeHome', 'cursor-home': 'cursorHome', hours: 'hours',
  'codex-home': 'codexHome', 'agy-home': 'agyHome', 'main-model': 'mainModel', 'subagent-model': 'subagentModel', 'codex-model': 'codexModel',
  repo: 'repo', tool: 'tool', model: 'model', effort: 'effort', task: 'task', difficulty: 'difficulty', summary: 'summary', next: 'next',
  result: 'result', minutes: 'minutes', 'input-tokens': 'inputTokens', 'output-tokens': 'outputTokens', 'cached-tokens': 'cachedTokens',
  success: 'success', 'rework-minutes': 'reworkMinutes', 'usage-source': 'usageSource', notes: 'notes', lsp: 'lsp' };
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
  if (o.profile !== undefined) profiles.get(o.profile); // throws with the known names
  if (o.target !== undefined && !cursor.targetValid(o.target)) throw new Error(`--target must be one of: ${cursor.TARGETS.join(', ')}, or a comma list of ${cursor.HOSTS.join(', ')}`);
  for (const k of ['mainModel', 'subagentModel', 'codexModel']) if (o[k] !== undefined && !String(o[k]).trim()) throw new Error('a model option needs a value');
  if (o.success !== undefined && !['0', '1'].includes(String(o.success))) throw new Error('--success must be 0 or 1');
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

  // Cursor's config directory: --cursor-home, else the real ~/.cursor. A sandboxed run without --cursor-home has none (null), so it
  // can never touch the real one by accident.
  const cursorHome = o.cursorHome ? path.resolve(o.cursorHome) : (sandbox ? null : cursor.defaultCursorHome());
  // Codex (~/.codex or CODEX_HOME) and Antigravity (~/.gemini) follow the same rule: a sandboxed run uses them only when named.
  const codexHome = o.codexHome ? path.resolve(o.codexHome) : (sandbox ? null : agents.defaultCodexHome());
  const agyHome = o.agyHome ? path.resolve(o.agyHome) : (sandbox ? null : agents.defaultAgyHome());

  // Read-modify-write of one JSON file under a config directory: nothing is written when fn changes nothing; dry-run only logs.
  const editJson = (file, fn) => {
    const j = cfg.readJson(file);
    const before = JSON.stringify(j);
    fn(j);
    if (JSON.stringify(j) === before) return false;
    if (dry) { log.plan(`update ${file}`); return true; }
    backup(file);
    cfg.writeJson(file, j);
    return true;
  };

  const ctx = {
    paths, opts: o, dry, env, log, sandbox, manifest, backup, editJson,
    cursorPaths: cursorHome ? cursor.cursorPaths(cursorHome) : null,
    codexPaths: codexHome ? agents.codexPaths(codexHome, sandbox || !!o.codexHome) : null,
    agyPaths: agyHome ? agents.agyPaths(agyHome) : null,
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
    editSettings: fn => editJson(paths.settings, fn),
    // Add/remove one dir on the Windows user PATH. Returns 'changed' | 'unchanged' | 'planned' | 'skipped (...)' | 'error: ...'.
    editPath(dir, add) {
      if (!S.IS_WIN) return 'skipped (not Windows)';
      if (o.noPath) return 'skipped (--no-path)';
      if (sandbox) return 'skipped (custom claude home)';
      if (dry) { log.plan(`${add ? 'add' : 'remove'} ${dir} ${add ? 'to' : 'from'} user PATH`); return 'planned'; }
      return winpath.editUserPath(S.run, dir, add);
    },
  };
  // Hosts in play, for components that write per host (handoff). Commands that need a hard error call cursor.hosts themselves.
  try { ctx.hostSel = cursor.hosts(ctx); } catch (_) { ctx.hostSel = { target: o.target || 'auto', claude: true, cursor: false, codex: false, agy: false }; }
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

// Which components a command works on. mode 'install': --only, else the profile (--profile, else the one the last install
// recorded, else the default) plus the opt-in flags, limited to the hosts in play (hostSel = { claude, cursor } from
// cursor.hosts; omitted = Claude Code only). A Cursor component is in a profile when the Claude tool it mirrors is.
// 'update' and 'uninstall': every component (update skips what is not installed, uninstall only removes what askai added),
// narrowed by --only / --skip; uninstall runs in reverse order.
function select(o, mode, recordedProfile, hostSel) {
  const known = comps.ALL.map(c => c.id);
  const only = list(o.only), skip = list(o.skip);
  for (const id of [...only, ...skip]) if (!known.includes(id)) throw new Error(`unknown component "${id}" (known: ${known.join(', ')})`);
  const on = hostSel || { claude: true, cursor: false };
  let sel;
  if (only.length) sel = comps.ALL.filter(c => only.includes(c.id));
  else if (mode === 'install') {
    const prof = profiles.get(o.profile || recordedProfile);
    // A host twin follows the tool it mirrors, including a tool the user opted into with its flag (--rtk, --context-mode).
    const flagOn = id => { const m = comps.byId(id); return !!(m && m.optInFlag && o[m.optInFlag]); };
    const inProfile = c => prof.components.includes(c.id) || (c.mirrors && (prof.components.includes(c.mirrors) || flagOn(c.mirrors))) || (c.optInFlag && o[c.optInFlag]);
    const onHost = c => c.host === 'any' || on[c.host || 'claude'];
    sel = comps.ALL.filter(c => inProfile(c) && onHost(c));
  } else sel = [...comps.ALL];
  if (o.noStatusline && !only.length) sel = sel.filter(c => c.id !== 'statusline');
  sel = sel.filter(c => !skip.includes(c.id));
  return mode === 'uninstall' ? [...sel].reverse() : sel;
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
  for (const d of ['lib', 'commands', 'standalone']) {
    if (!fs.existsSync(path.join(SRC, d))) continue; // standalone/ is absent in a stripped checkout
    fs.rmSync(path.join(dest, d), { recursive: true, force: true });
    fs.cpSync(path.join(SRC, d), path.join(dest, d), { recursive: true });
  }
  fs.mkdirSync(path.join(dest, 'hooks'), { recursive: true });
  for (const f of ['askai.js', 'package.json', path.join('hooks', 'askai-report.js')]) {
    if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(dest, f));
  }
  // Templates for `askai scaffold` and `askai session` (missing in a stripped checkout: those commands then say so).
  if (fs.existsSync(path.join(SRC, 'templates'))) {
    fs.rmSync(path.join(dest, 'templates'), { recursive: true, force: true });
    fs.cpSync(path.join(SRC, 'templates'), path.join(dest, 'templates'), { recursive: true });
  }
  // The Markdown documents and the diagram, so `askai docs` works from any terminal (PDF and Word stay in the download).
  if (fs.existsSync(path.join(SRC, 'docs'))) {
    fs.rmSync(path.join(dest, 'docs'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dest, 'docs'), { recursive: true });
    for (const n of fs.readdirSync(path.join(SRC, 'docs'))) if (/\.(md|png)$/i.test(n)) fs.copyFileSync(path.join(SRC, 'docs', n), path.join(dest, 'docs', n));
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
const CCUSAGE_LINES = 60;
const firstLineOf = s => String(s || '').split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';

// The profile name the last install recorded, if it is still a known one.
function recordedProfile(ctx) {
  try { profiles.get(ctx.manifest.profile); return ctx.manifest.profile; } catch (_) { return undefined; }
}

// One line naming the hosts a command works on.
const hostLine = (ctx, h) => [h.claude && `Claude Code (${ctx.paths.home})`, h.cursor && `Cursor (${ctx.cursorPaths.home})`,
  h.codex && `Codex (${ctx.codexPaths.home})`, h.agy && `Antigravity (${ctx.agyPaths.home})`].filter(Boolean).join(' + ');
const hostNames = h => [h.claude && 'Claude Code', h.cursor && 'Cursor', h.codex && 'Codex', h.agy && 'Antigravity'].filter(Boolean);

// Component plans name winget; off Windows, say what will really run (Homebrew, the vendor script, cargo or a manual step).
const planText = (ctx, plan) => (S.IS_WIN ? plan : plan.replace(/winget install ([A-Za-z0-9.-]+)/g, (m, id) => require('./lib/pkg').describe(ctx, id)));

async function cmdInstall(o) {
  if (o.profile === 'max' && !o.lsp) o.lsp = 'ts,py'; // the max profile includes Claude Code's TypeScript and Python code intelligence
  const ctx = buildCtx(o);
  preflight(ctx);
  const hosts = cursor.hosts(ctx);
  ctx.hostSel = hosts;
  const sel = select(o, 'install', recordedProfile(ctx), hosts);
  const prof = profiles.get(o.profile || recordedProfile(ctx));
  const skipOf = (c, d) => d.state === 'other' || (d.state === 'ok' && !o.force && !(c.id === 'caveman' && o.caveman));
  const rows = sel.map(c => { const d = safeDetect(c, ctx); return { c, d, skip: skipOf(c, d) }; });

  console.log(`askai install${o.dry ? ' (dry-run: nothing is written or installed)' : ''}   for ${hostLine(ctx, hosts)}`);
  console.log(list(o.only).length ? `components chosen with --only; the ${prof.name} profile is not applied\n` : `profile: ${prof.name}: ${prof.summary}\n`);
  if (!rows.length) { console.log('Nothing selected.'); return 0; }
  const w = Math.max(...rows.map(r => r.c.id.length));
  for (const r of rows) {
    console.log(`  ${pad(r.c.id, w)}  ${pad(r.d.state, 7)}  ${r.skip ? `skip: ${r.d.detail}` : `will install/wire: ${planText(ctx, r.c.plan)}`}`);
  }
  if (rows.some(r => r.c.id === 'token-kit' && !r.skip)) console.log('  note: token-kit runs first; every component after it is checked again and re-applies what the takeover removed');
  console.log(`  ${pad('askai', w)}          copy to ${ctx.paths.app}, shim in ${ctx.paths.bin}${o.noPath || ctx.sandbox || !S.IS_WIN ? '' : ' (added to user PATH)'}${hosts.claude ? ', /askai-status, /askai-report and /askai-handoff commands' : ''}`);
  const files = [hosts.claude && 'settings.json, CLAUDE.md, .claude.json', hosts.cursor && "Cursor's mcp.json and hooks.json", hosts.codex && "Codex's config.toml and AGENTS.md", hosts.agy && "Antigravity's GEMINI.md and mcp_config.json"].filter(Boolean);
  console.log(`\nBacks up ${files.join('; ')} before every change; existing keys, entries and hooks are kept.`);
  if (!await confirm(o, '\nProceed?')) { console.log('Aborted, nothing changed.'); return 1; }

  const results = [];
  console.log(`\n[askai] app, shim${hosts.claude ? ', commands' : ''}`);
  try {
    console.log(`  app: ${copyApp(ctx)}`);
    writeShim(ctx);
    if (hosts.claude) console.log(`  slash commands: ${installCommands(ctx)} written`);
    console.log(`  user PATH: ${pathStep(ctx, true)}`);
    results.push({ id: 'askai', result: o.dry ? 'planned' : 'ok' });
  } catch (e) { console.error(`  failed: ${e.message}`); results.push({ id: 'askai', result: 'failed', detail: e.message }); }

  let takenOver = false;
  for (const r of rows) {
    // token-kit removes a previous standalone run, which can take away settings that the components below had found in
    // place when the plan was made: check them again once it has run.
    if (takenOver && !o.dry) { r.d = safeDetect(r.c, ctx); r.skip = skipOf(r.c, r.d); }
    if (r.c.id === 'token-kit' && !r.skip) takenOver = true;
    if (r.skip) { results.push({ id: r.c.id, result: 'skipped', detail: r.d.detail }); continue; }
    console.log(`\n[${r.c.id}] ${r.c.title}`);
    try { r.c.install(ctx); results.push({ id: r.c.id, result: o.dry ? 'planned' : 'ok' }); }
    catch (e) { console.error(`  failed: ${e.message}`); results.push({ id: r.c.id, result: 'failed', detail: e.message }); }
  }

  const failed = results.filter(r => r.result === 'failed');
  // The profile is remembered so later runs (install, status, doctor) judge the machine against it; --only is a partial run.
  if (!o.dry && !list(o.only).length) ctx.manifest.profile = prof.name;
  if (!o.dry && !list(o.only).length && o.target) ctx.manifest.target = o.target;
  try { comps.refreshDerived(ctx); } catch (e) { ctx.log.warn(`could not refresh derived files: ${e.message}`); }
  try { saveManifest(ctx, 'install', results); } catch (e) { console.error(`could not save manifest: ${e.message}`); }

  console.log('\nSummary');
  for (const r of results) {
    const after = o.dry || r.id === 'askai' || r.result === 'failed' ? '' : `  now: ${safeDetect(comps.byId(r.id), ctx).state}`;
    console.log(`  ${pad(r.id, w)}  ${pad(r.result, 8)}${r.detail ? ` ${r.detail}` : ''}${after}`);
  }
  if (o.dry) console.log('\nDry-run only. Re-run without --dry-run to apply.');
  else if (failed.length) console.log(`\n${failed.length} component(s) failed. Fix the cause and re-run \`askai install\`: finished components are skipped.`);
  else {
    console.log(`\nDone. Open a NEW ${hostNames(hosts).join(' / ')} session so hooks, plugins and MCP servers load${hosts.claude ? ', then run /askai-status' : ''}.`);
    if (hosts.cursor) console.log('Cursor user rules are in ~/.cursor/rules and apply in every project on this machine. Restart Cursor so it reads the hooks, MCP servers and rules. `askai project` writes the same files into one repo for git; skip it here, or the always-applied rule is loaded twice.');
  }
  if (o.project) { console.log(''); project.init(path.resolve(o.project), { yes: true, dry: o.dry, about: o.about, type: o.type }, ctx); }
  if (!o.dry) { console.log('Check it: askai infra (everything set up, per tool), askai check (gaps), and /askai-status inside Claude Code.'); try { const dir = o.project ? path.resolve(o.project) : null; const list = todo.items(ctx, dir); const n = todo.open(list).length; if (n && dir) console.log(`\nThings only you can do (${n}); askai todo ${dir} shows them again:\n${todo.render(list)}`); else if (n) console.log(`Next: askai todo lists the ${n} thing(s) only you can do (sign-ins, restarts, app settings, project files).`); } catch (_) { /* best effort */ } }
  return failed.length ? 1 : 0;
}

async function cmdUpdate(o) {
  const ctx = buildCtx(o);
  preflight(ctx);
  console.log(`askai update${o.dry ? ' (dry-run)' : ''}\n`);
  let failed = 0;
  if (!o.dry) { try { copyApp(ctx); installCommands(ctx); } catch (e) { console.error(`  app refresh failed: ${e.message}`); failed++; } }
  for (const c of select(o, 'update')) {
    const d = safeDetect(c, ctx);
    if (d.state === 'missing') { console.log(`[${c.id}] not installed, skipped`); continue; }
    // Cursor wiring is touched only where askai set it up.
    if (['cursor', 'codex', 'agy'].includes(c.host) && !ctx.manifest.components[c.id]) { console.log(`[${c.id}] not set up by askai, skipped`); continue; }
    console.log(`[${c.id}]`);
    try { c.update(ctx); } catch (e) { console.error(`  failed: ${e.message}`); failed++; }
  }
  try { comps.refreshDerived(ctx); } catch (e) { ctx.log.warn(`could not refresh derived files: ${e.message}`); }
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

// The profiles and what each installs; the one in effect is marked.
function cmdProfiles(o) {
  const ctx = buildCtx(o, true);
  const cur = status.profileInfo(ctx);
  const rows = profiles.names().map(n => ({ ...profiles.get(n), current: n === cur.name }));
  if (o.json) { console.log(JSON.stringify({ current: cur.name, source: cur.source, profiles: rows }, null, 2)); return 0; }
  console.log(`profile in effect: ${cur.name} (${cur.source})\n`);
  for (const p of rows) {
    console.log(`${p.current ? '*' : ' '} ${pad(p.name, 8)} ${p.summary}`);
    console.log(`  ${pad('', 8)} installs: ${p.components.join(', ')}`);
    console.log(`  ${pad('', 8)} path rules: ${p.rules.length ? p.rules.join(' + ') : 'none'}`);
  }
  console.log('\nInstall one with `askai install --profile NAME`; `askai suggest [dir]` picks by what a directory holds.');
  console.log('A profile only adds: switching to a smaller one never uninstalls tools; it keeps what is there and removes only the rule files it no longer wants.');
  console.log('For Cursor, cursor-rtk / cursor-context-mode / cursor-serena follow rtk / context-mode / serena, and cursor-rules (with the rules component) writes ~/.cursor/rules for every project. `askai project` copies those rules into one repo.');
  return 0;
}

// Read-only: which profile fits a directory.
function cmdSuggest(o) {
  const dir = path.resolve(o._[1] || process.cwd());
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch (_) { /* missing */ }
  if (!isDir) { console.error(`askai: ${dir} is not a directory`); return 1; }
  const r = suggestLib.suggest(dir);
  if (o.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  console.log(`${dir}\n  ${r.counts.code} code, ${r.counts.textDocs} text documents, ${r.counts.binaryDocs} PDF/Office files${r.counts.truncated ? ' (scan stopped at the entry limit)' : ''}`);
  console.log(`  suggested profile: ${r.profile}: ${r.reason}`);
  console.log(`\nClaude Code: askai install --profile ${r.profile}\nCursor:      askai install --profile ${r.profile} writes ~/.cursor/rules for every project. \`askai project\` copies the same files into one repo.`);
  return 0;
}

// Cursor: write (or show, or remove) the token rules of a project in <dir>/.cursor/rules.
function cmdProject(o) {
  const ctx = buildCtx(o);
  const dir = path.resolve(o._[1] || process.cwd());
  let isDir = false;
  try { isDir = fs.statSync(dir).isDirectory(); } catch (_) { /* missing */ }
  if (!isDir) { console.error(`askai: ${dir} is not a directory`); return 1; }
  const known = (ctx.manifest.cursorProjects || {})[dir];
  const save = () => { try { saveManifest(ctx, 'project', []); } catch (e) { console.error(`could not save manifest: ${e.message}`); } };

  if (o.remove) {
    const gone = cursor.removeProject(ctx, dir);
    console.log(gone.length ? `removed ${gone.join(', ')} from ${cursor.rulesDir(dir)}` : `no askai rules in ${cursor.rulesDir(dir)}`);
    if (known && !o.dry) { delete ctx.manifest.cursorProjects[dir]; save(); }
    return 0;
  }

  // --profile, else the one this project already has, else the one its files suggest.
  let name = o.profile || (known && known.profile), why = o.profile ? '--profile' : 'set earlier for this project';
  if (!name) { const s = suggestLib.suggest(dir); name = s.profile; why = `suggested: ${s.reason}`; }
  const prof = profiles.get(name);

  if (o.print) {
    for (const f of comps.cursorProjectFiles(ctx, prof.name)) console.log(`--- ${path.join(cursor.rulesDir(dir), f.name)}\n${f.text}`);
    return 0;
  }
  console.log(`askai project${o.dry ? ' (dry-run)' : ''}   ${dir}\n  profile: ${prof.name} (${why})`);
  const res = comps.syncCursorProject(ctx, dir, prof.name, o.force);
  for (const [label, names] of [['written', res.written], ['unchanged', res.unchanged], ['removed (no longer in the profile)', res.removed]]) {
    if (names.length) console.log(`  ${label}: ${names.join(', ')}`);
  }
  if (res.skipped.length) console.log(`  skipped, not written by askai: ${res.skipped.join(', ')} (use --force to overwrite)`);
  if (!o.dry && (res.written.length || res.unchanged.length)) {
    ctx.manifest.cursorProjects = { ...(ctx.manifest.cursorProjects || {}), [dir]: { profile: prof.name } };
    save();
  }
  console.log('\nCursor loads askai-tokens.mdc in every chat; the code and document rules only when matching files are in play. `askai project --remove` deletes them.');
  return res.skipped.length && !res.written.length && !res.unchanged.length ? 1 : 0;
}

// One view of everything: tool status and measured savings, health checks, cache and context per session, the ccusage report
// when that tool is installed, then the transcript-based spend ledger. Each part is independent, so one failing does not hide
// the others.
function cmdReport(o) {
  const hours = String(o.hours || o._[1] || '6');
  const ctx = buildCtx(o, true);
  ctx.refreshPath();
  const part = fn => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } };
  const st = part(() => status.renderStatus(ctx));
  const dr = part(() => status.doctor(ctx));
  const ca = part(() => status.renderCache(ctx, hours));
  const hs = part(() => cursor.hosts(ctx));
  // ccusage prints its own table; its format is not parsed, only shown (first lines).
  const cu = part(() => {
    if (!ctx.which('ccusage')) return null;
    const r = ctx.probe('ccusage', ['daily'], { timeout: 90000 });
    if (!r.ok) throw new Error(firstLineOf(r.stderr || r.stdout) || 'ccusage failed');
    const lines = String(r.stdout).replace(/\s+$/, '').split(/\r?\n/);
    return { text: lines.slice(0, CCUSAGE_LINES).join('\n'), truncated: lines.length > CCUSAGE_LINES };
  });

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
      hosts: hs.ok ? hs.value : { error: hs.error },
      tools: st.ok ? st.value.rows : { error: st.error },
      health: dr.ok ? dr.value : { error: dr.error },
      cache: ca.ok ? (ca.value ? ca.value.rows : null) : { error: ca.error },
      ccusage: cu.ok ? cu.value : { error: cu.error },
      spend: spend.ok ? spendJson : { error: spend.error },
    }, null, 2));
    return spend.ok ? 0 : 1;
  }

  // Numbered as printed: the ccusage section exists only when that tool is installed.
  let n = 0;
  const showCu = !cu.ok || !!cu.value;
  const total = 4 + (showCu ? 1 : 0);
  const head = t => `\n${'='.repeat(78)}\n${++n}/${total}  ${t}\n${'='.repeat(78)}`;
  console.log(head('TOOLS AND MEASURED SAVINGS  (askai status)'));
  console.log(st.ok ? st.value.lines.join('\n') : `unavailable: ${st.error}`);
  console.log(head('HEALTH  (askai doctor)'));
  console.log(dr.ok ? doctorLines(dr.value).join('\n') : `unavailable: ${dr.error}`);
  console.log(head(`CACHE AND CONTEXT PER SESSION, LAST ${hours}h  (from the askai status line)`));
  if (!ca.ok) console.log(`unavailable: ${ca.error}`);
  else if (ca.value) console.log(ca.value.lines.join('\n'));
  else console.log('No snapshots yet. The askai status line records cache hit and context use per session (Claude Code only); it fills in as sessions run.');
  if (showCu) {
    console.log(head('USAGE AND COST BY DAY  (ccusage, its own output)'));
    if (!cu.ok) console.log(`unavailable: ${cu.error}`);
    else console.log(cu.value.text + (cu.value.truncated ? `\n... first ${CCUSAGE_LINES} lines; run \`ccusage\` for the rest` : ''));
  }
  console.log(head(`SPEND FROM TRANSCRIPTS, LAST ${hours}h  (where tokens actually went)`));
  console.log(spend.ok ? spend.text.trimEnd() : `unavailable: ${spend.error}`);
  if (hs.ok && hs.value.cursor) {
    console.log('\nNote: Cursor is wired, but askai measures Claude Code only. The cache, ccusage and spend sections do not include Cursor usage; use Cursor\'s own usage view for that.');
  }
  return spend.ok ? 0 : 1;
}

async function cmdUninstall(o) {
  const ctx = buildCtx(o);
  preflight(ctx);
  const sel = select(o, 'uninstall');
  const mine = (c, d) => {
    const rec = ctx.manifest.components[c.id] || {};
    if (c.id === 'baseline') return (ctx.manifest.settings || []).length > 0;
    if (['caveman', 'statusline', 'codex-rules', 'agy-rules'].includes(c.id)) return d.state === 'ok';
    if (c.id === 'codex-baseline' || c.id === 'agy-baseline') return (rec.keys || []).length > 0;
    if (c.id === 'prompt-hooks') return !!rec.on || d.state !== 'missing';
    if (['headroom', 'context7'].includes(c.id)) return (rec.hosts || []).length > 0;
    if (c.id === 'graphify' || c.id === 'base-tools') return !!rec.installedByAskai;
    if (c.id === 'lean') return (rec.keys || []).length > 0 || (rec.deny || []).length > 0;
    if (c.id === 'handoff') return (rec.files || []).length > 0;
    if (c.id === 'agy-path-rules') return d.state !== 'missing';
    if (c.id === 'code-intel') return (rec.plugins || []).length > 0;
    return !!(rec.installedByAskai || rec.hook || rec.mcp) || !!o.force;
  };
  const rows = sel.map(c => { const d = safeDetect(c, ctx); return { c, d, mine: d.state !== 'missing' && mine(c, d) }; });

  console.log(`askai uninstall${o.dry ? ' (dry-run)' : ''}   claude home: ${ctx.paths.home}${ctx.cursorPaths ? `   cursor home: ${ctx.cursorPaths.home}` : ''}\n`);
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
  // A full uninstall also removes the Cursor rule files `askai project` wrote (only files carrying askai's marker), before
  // refreshDerived could rewrite them.
  if (!list(o.only).length) {
    for (const dir of Object.keys(ctx.manifest.cursorProjects || {})) {
      try {
        const gone = cursor.removeProject(ctx, dir);
        console.log(`\n[cursor project] ${dir}: ${gone.length ? `removed ${gone.join(', ')}` : 'no askai rules there'}`);
        if (!o.dry) delete ctx.manifest.cursorProjects[dir];
      } catch (e) { console.error(`  failed: ${e.message}`); failed++; }
    }
  }
  try { comps.refreshDerived(ctx); } catch (e) { ctx.log.warn(`could not refresh derived files: ${e.message}`); }
  console.log('\n[askai] commands, shim, PATH, app');
  try {
    removeCommands(ctx);
    console.log(`  user PATH: ${pathStep(ctx, false)}`);
    if (!o.dry) {
      for (const d of [ctx.paths.bin, ctx.paths.cache, ctx.paths.sessions]) fs.rmSync(d, { recursive: true, force: true });
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
function scheduleSelfRemoval(ctx) { for (const d of [ctx.paths.app, path.join(ctx.paths.askaiDir || path.dirname(ctx.paths.app), 'src')]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* Windows may hold a handle; harmless leftover */ } } }

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
  // Cursor's files share the backup folder by basename; they can only be put back where the Cursor directory is known.
  if (ctx.cursorPaths) { map['mcp.json'] = ctx.cursorPaths.mcp; map['hooks.json'] = ctx.cursorPaths.hooks; }
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
// ---- everyday commands ------------------------------------------------------------------------------------------------
// askai upgrade: fetch the latest AskAI from GitHub into ~/.claude/askai/src (git), then run its install with the profile and
// target recorded last time. Always the latest (the default branch); ASKAI_REPO_URL / ASKAI_REPO point at a fork or a test copy.
function cmdUpgrade(o, rest) {
  const cp = require('child_process'); const ctx = buildCtx(o, true);
  const src = path.join(ctx.paths.askaiDir, 'src');
  const url = process.env.ASKAI_REPO_URL || `https://github.com/${process.env.ASKAI_REPO || 'aalokshah-business/AskAi'}.git`;
  const git = ctx.which('git');
  if (!git) { console.log('git is not installed. Run the one-line installer again instead (README, Quick start); it downloads the latest AskAI without git.'); return 1; }
  const exists = fs.existsSync(path.join(src, '.git'));
  if (o.dry) { console.log(`would ${exists ? 'update' : 'clone'} ${url} (latest) in ${src}, then run its install --yes${ctx.manifest.profile ? ` --profile ${ctx.manifest.profile}` : ''}${ctx.manifest.target ? ` --target ${ctx.manifest.target}` : ''}`); return 0; }
  const run = args => cp.spawnSync(git, args, { stdio: 'inherit' }).status;
  if (exists) { if (run(['-C', src, 'fetch', '--quiet', '--depth', '1', 'origin', 'HEAD']) || run(['-C', src, 'checkout', '--quiet', 'FETCH_HEAD'])) return 1; }
  else { fs.rmSync(src, { recursive: true, force: true }); fs.mkdirSync(path.dirname(src), { recursive: true }); if (run(['clone', '--quiet', '--depth', '1', url, src])) return 1; }
  let v = '?'; try { v = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version; } catch (_) { /* keep ? */ }
  console.log(`AskAI ${VERSION} -> ${v} (${src})`);
  const fwd = [...rest];
  const args = [path.join(src, 'askai.js'), 'install', '--yes'];
  if (ctx.manifest.profile && !fwd.includes('--profile')) args.push('--profile', ctx.manifest.profile);
  if (ctx.manifest.target && !fwd.includes('--target')) args.push('--target', ctx.manifest.target);
  const r = cp.spawnSync(process.execPath, [...args, ...fwd], { stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}
function cmdDiff(o) {
  const repo = path.resolve(o.repo || o._[1] || '.'); const g = a => require('child_process').spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  const st = g(['diff', '--stat']); if (st.status !== 0) { console.log(`not a git repository: ${repo}`); return 1; }
  const staged = g(['diff', '--cached', '--stat']).stdout.trim(); const check = g(['diff', '--check']);
  console.log(st.stdout.trim() || '(no unstaged changes)'); if (staged) console.log(`\nstaged:\n${staged}`);
  console.log(`\nwhitespace check: ${check.status === 0 ? 'ok' : `problems\n${String(check.stdout).slice(0, 1500)}`}`);
  console.log('Review the full diff yourself; give the agent only the files it needs, not the whole diff.');
  return check.status === 0 ? 0 : 1;
}
function cmdGraph(o) {
  const f = path.join(path.resolve(o.repo || o._[1] || '.'), 'docs', 'ai', 'ARCHITECTURE.md');
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch (_) { console.log(`no ${f}: run askai init`); return 1; }
  const blocks = [...t.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map(m => m[1]);
  if (!blocks.length) { console.log('ARCHITECTURE.md has no Mermaid diagram yet (ask the agent to use the architecture-map skill).'); return 1; }
  console.log(blocks.join('\n\n')); console.log('\n(the curated diagram from docs/ai/ARCHITECTURE.md; paste into any Mermaid viewer to see it drawn)'); return 0;
}
function cmdModels(o) {
  const ctx = buildCtx(o, true); const a = o._[1];
  if (a === 'set') { const r = models.set(ctx, o._[2], o._[3]); console.log(`saved ${o._[2]} = ${o._[3]} in ${models.prefsFile(ctx)}. Rewrite a repo's agent files: askai init --refresh`); if (r.warning) console.log(`warning: ${r.warning}`); return 0; }
  if (a === 'verify') {
    const t = o._[2];
    if (!t || t === 'cursor') { const b = ctx.which('agent') ? 'agent' : ctx.which('cursor-agent') ? 'cursor-agent' : null; if (b) { const r = ctx.probe(b, ['models'], { timeout: 20000 }); console.log(`Cursor models on this account (${b} models):\n${r.ok ? r.stdout : r.stderr}`); } else console.log('Cursor CLI not found: model IDs are in Cursor, Settings, Models.'); }
    if (!t || t === 'agy') { if (ctx.which('agy')) { const r = ctx.probe('agy', ['models'], { timeout: 20000 }); console.log(`Antigravity (agy models):\n${r.ok ? r.stdout : r.stderr}`); } else console.log('Antigravity CLI not found.'); }
    if (!t || t === 'codex') console.log(`Codex: known model IDs (October 2026): ${models.CODEX_KNOWN.join(', ')}. Run /model inside Codex for the ones your plan allows; an unsupported ID fails with a 400 error.`);
    if (!t || t === 'claude') console.log('Claude Code: the aliases sonnet, opus, haiku and fable always point at the current models.');
    return 0;
  }
  console.log(models.render(models.load(ctx))); return 0;
}
function cmdPrompt(o) {
  let text;
  if (o.outputSafe) text = promptLib.outputSafe(o.outputSafe);
  else if (o.resume && !o._[1]) text = promptLib.resume(path.resolve(o.repo || '.'));
  else { const r = promptLib.task({ ask: o._.slice(1).join(' '), tier: o.tier, tool: o.tool, files: o.files, done: o.done, mode: o.mode, kind: o.kind, output: o.output, resume: o.resume }); text = r.text; }
  console.log(text);
  if (o.copy) { const via = require('./lib/session').copyText ? require('./lib/session').copyText(text) : null; if (via) console.log(`(copied with ${via})`); }
  return 0;
}
function cmdMcp(o) {
  const ctx = buildCtx(o, true); const a = o._[1] || 'list';
  if (a === 'list') { console.log(mcpLib.render(mcpLib.list(ctx).filter(r => !o.tool || r.tool === o.tool))); return 0; }
  if (a === 'on' || a === 'off') {
    const name = o._[2]; if (!name) { console.log('which server? askai mcp off <name> [--tool claude|codex|cursor|agy]'); return 1; }
    const tools = o.tool ? [o.tool] : [...new Set(mcpLib.list(ctx).filter(r => r.name === name).map(r => r.tool))];
    if (!tools.length) { console.log(`no MCP server "${name}" found`); return 1; }
    for (const t of tools) console.log(`  ${t}: ${mcpLib.setState(ctx, t, name, a === 'on', o.dry)}${o.dry ? ' (dry-run)' : ''}`);
    console.log('Takes effect in the next session (a change mid-session would rebuild the prompt cache).'); return 0;
  }
  console.log('askai mcp [list | on <name> | off <name>] [--tool claude|codex|cursor|agy]'); return 1;
}
function cmdDocs(o) {
  const DOCS = { install: 'INSTALL.md', architecture: 'ARCHITECTURE.md', guide: 'ASKAI_GUIDE.md', cheatsheet: 'CHEAT_SHEET.md', changelog: 'CHANGELOG.md', preview: 'PREVIEW_MATRIX.md' };
  const name = o._[1];
  if (!name || !DOCS[name]) { for (const [k, v] of Object.entries(DOCS)) console.log(`  askai docs ${k.padEnd(13)} ${path.join(SRC, 'docs', v)}`); console.log('  (add --print to show one in the terminal)'); return name ? 1 : 0; }
  const f = path.join(SRC, 'docs', DOCS[name]);
  if (!fs.existsSync(f)) { console.log(`${f} is not in this copy of AskAI (docs live in the downloaded folder)`); return 1; }
  console.log(o.print ? fs.readFileSync(f, 'utf8') : f); return 0;
}
function cmdConvert(o) {
  const ctx = buildCtx(o, true); const src = o._[1];
  if (!src) { console.log('askai convert <file|url> [--out file.md]: PDF, Word, PowerPoint, Excel, HTML, YouTube URL -> Markdown (Microsoft MarkItDown, local)'); return 1; }
  if (!ctx.which('markitdown')) { console.log('MarkItDown is not installed: askai install --only markitdown (or --profile docs). Videos other than YouTube need a transcriber first (graphifyy[video] or Whisper).'); return 1; }
  const isUrl = /^https?:\/\//.test(src);
  const out = o.out || path.join(process.cwd(), 'docs', 'ai', 'inputs', `${(isUrl ? src.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_') : path.basename(src, path.extname(src))).slice(0, 80)}.md`);
  if (fs.existsSync(out)) { console.log(`${out} exists; choose another --out`); return 1; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = require('child_process').spawnSync('markitdown', [src, '-o', out], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status === 0) { const n = fs.readFileSync(out, 'utf8').length; console.log(`wrote ${out} (~${Math.ceil(n / 4).toLocaleString('en-US')} tokens). Point the agent at the section it needs, not the whole file.`); }
  return r.status || 0;
}
function cmdCheck(o) {
  const ctx = buildCtx(o, true);
  const dir = o._[1] ? path.resolve(o._[1]) : null;
  return check.run(ctx, dir, o);
}
function cmdAsk(o) {
  const q = o._.slice(1).join(' ');
  const hits = kb.search(q, 3);
  if (!hits.length) { console.log(`No rule matches "${q}". Topics: ${kb.KB.map(x => x.id).join(', ')}`); return q ? 1 : 0; }
  console.log(hits.map(kb.render).join('\n\n'));
  return 0;
}
function cmdUsage(o) {
  const days = Number(o._[1] || o.hours || 7) || 7;
  const ctx = buildCtx(o, true);
  console.log(`=== Claude Code, last ${days} day(s) ===`);
  if (ctx.which('ccusage')) {
    const r = ctx.probe('ccusage', ['daily', '--since', new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, '')], { timeout: 90000 });
    console.log(r.ok ? String(r.stdout).trimEnd().split(/\r?\n/).slice(0, 40).join('\n') : `ccusage failed: ${firstLineOf(r.stderr || r.stdout)}`);
  } else {
    const script = path.join(SRC, 'hooks', 'askai-report.js');
    const r = require('child_process').spawnSync(process.execPath, [script, '--hours', String(days * 24)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...(o.claudeHome ? { CLAUDE_CONFIG_DIR: ctx.paths.home } : {}) } });
    console.log(r.status === 0 ? String(r.stdout).trimEnd().split(/\r?\n/).slice(0, 30).join('\n') : 'No Claude Code transcripts readable here. Install ccusage (askai install --ccusage) or use /usage in Claude Code.');
  }
  console.log(`\n=== Codex, last ${days} day(s) ===`);
  console.log(ctx.codexPaths ? usage.renderCodex(usage.codex(ctx.codexPaths.home, days)) : 'No Codex folder (sandboxed run without --codex-home).');
  console.log('\n=== Antigravity and Cursor ===\nNo local usage log to read: Antigravity /usage (per-model quota) and /credits; Cursor Dashboard, Usage tab (tokens per request).');
  return 0;
}
function cmdSession(o) {
  try { return session.run(o._[1], o); } catch (e) { console.error(`askai session: ${e.message}`); return 1; }
}
function cmdScaffold(o) {
  try { return scaffold.run(o._[1], o); } catch (e) { console.error(`askai scaffold: ${e.message}`); return 1; }
}
function cmdTips(o) {
  try { console.log(tips.render(o._[1])); return 0; } catch (e) { console.error(`askai tips: ${e.message}`); return 1; }
}
function cmdPeak(o) {
  const lines = tips.peak(new Date());
  if (o.json) console.log(JSON.stringify({ peak: tips.isPeak(new Date()), lines }, null, 2)); else console.log(lines.join('\n'));
  return 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let o;
  try { o = parseArgs(rest); } catch (e) { console.error(`askai: ${e.message}`); return 2; }
  o._.unshift(cmd);
  if (cmd === 'help' && o._[1] === 'all') { console.log(`askai ${VERSION}: every command in full\n\n` + help.names().map(n => help.render(n)).join(`\n\n${'-'.repeat(72)}\n\n`)); return 0; }
  if (cmd === 'help' && o._[1]) { const t = help.render(o._[1]); console.log(t || `No help for "${o._[1]}". Commands: ${help.names().join(', ')}`); return t ? 0 : 1; }
  if (o.help && cmd && help.has(cmd)) { console.log(help.render(cmd)); return 0; }
  if (!cmd || cmd === 'help' || o.help) { console.log(HELP); return cmd ? 0 : 2; }
  switch (cmd) {
    case 'install': return cmdInstall(o);
    case 'update': return cmdUpdate(o);
    case 'status': return cmdStatus(o);
    case 'doctor': return cmdDoctor(o);
    case 'report': return cmdReport(o);
    case 'profiles': return cmdProfiles(o);
    case 'suggest': return cmdSuggest(o);
    case 'project': return cmdProject(o);
    case 'uninstall': return cmdUninstall(o);
    case 'restore': return cmdRestore(o);
    case 'statusline': return cmdStatusline(o);
    case 'session': return cmdSession(o);
    case 'init': { const dir = path.resolve(o._[1] || '.'); const ctx = buildCtx(o, true); const oo = await project.ask(dir, o); project.init(dir, { ...oo, dry: o.dry }, ctx); return 0; }
    case 'map': project.map(o._[1] || '.', { dry: o.dry }); return 0;
    case 'models': return cmdModels(o);
    case 'go': return launch.run(buildCtx(o, true), o._[1], { ...o, ask: o._.slice(2).join(' ') });
    case 'prompt': return cmdPrompt(o);
    case 'mcp': return cmdMcp(o);
    case 'audit': return audit.run(buildCtx(o, true), o._[1] ? path.resolve(o._[1]) : process.cwd(), o);
    case 'infra': { const ctx = buildCtx(o, true); const r = infra.collect(ctx, path.resolve(o._[1] || '.')); console.log(o.json ? JSON.stringify(r, null, 2) : infra.render(r)); return 0; }
    case 'guide': { const t = guide.render(o._[1]); console.log(t || `No guide for "${o._[1]}". Topics: ${guide.ORDER.join(', ')}`); return t ? 0 : 1; }
    case 'docs': return cmdDocs(o);
    case 'plugins': { const ctx = buildCtx(o, true); const a = o._[1] || 'list'; if (a === 'decisions') { console.log(plugins.decisions()); return 0; }
      if (a === 'info' || a === 'use') { if (!o._[2]) { console.log(`which one? askai plugins info <id>   ids: ${require('./lib/plugins').P.map(p => p.id).join(', ')}`); return 1; } const r = plugins.info(o._[2]); console.log(`\nHow to use it\n${require('./lib/usage-guide').render(o._[2])}`); return r; }
      return a === 'install' ? plugins.install(ctx, o._[2], o) : plugins.list(ctx); }
    case 'upgrade': return cmdUpgrade(o, rest);
    case 'savings': { const ctx = buildCtx(o, true); console.log(require('./lib/savings').report(ctx, Number(o._[1]) || 7, path.resolve(o.repo || '.'))); return 0; }
    case 'convert': return cmdConvert(o);
    case 'clear': { const g = guide.clearGate(path.resolve(o.repo || '.'), o.tool || 'claude', o._[1] === 'compact' ? 'compact' : 'clear'); console.log(g.text); return g.fresh ? 0 : 1; }
    case 'context': { const pct = o.used !== undefined && o.window ? 100 * Number(o.used) / Number(o.window) : Number(o._[1]); if (!isFinite(pct)) { console.log('Give the level: askai context 62, or askai context --used 124000 --window 200000 (read it from /context or /status). Claude Code: the AskAI status line shows it live.'); return 1; } console.log(`Context ${Math.round(pct)}%: ${guide.advice(pct)}.`); return 0; }
    case 'todo': { const ctx = buildCtx(o, true); const dir = path.resolve(o._[2] && o._[1] !== 'done' && o._[1] !== 'undo' ? o._[2] : (o._[1] && !['done', 'undo'].includes(o._[1]) ? o._[1] : (o.repo || '.')));
      if (o._[1] === 'done' || o._[1] === 'undo') { if (!o._[2]) { console.log('which item? askai todo done <id>'); return 1; } todo.mark(ctx, o._[2], o._[1] === 'done'); console.log(`${o._[1] === 'done' ? 'marked done' : 'reopened'}: ${o._[2]}`); return 0; }
      console.log(todo.render(todo.items(ctx, dir), o.all)); return 0; }
    case 'work': { console.log(guide.render('work')); try { const ctx = buildCtx(o, true); const open = todo.open(todo.items(ctx, path.resolve(o.repo || '.'))); if (open.length) console.log(`\nYour open to-dos (${open.length}): ${open.slice(0, 3).map(i => i.text).join('; ')}${open.length > 3 ? '; ...' : ''}\nAll of them: askai todo`); } catch (_) { /* no context */ } } console.log('\nMore: askai guide <moment> (start, break, resume, clear, compact, cache, models, subagents, mcp, output, prompts, docs, plugins, security, peak) · askai ask <words>'); return 0;
    case 'etiquette': console.log(guide.render('all')); return 0;
    case 'continue': return session.run('resume', o);
    case 'checkpoint': return session.run('pause', o);
    case 'diff': return cmdDiff(o);
    case 'graph': return cmdGraph(o);
    case 'hook': { let input = ''; try { input = fs.readFileSync(0, 'utf8'); } catch (_) { /* no stdin */ } const out = hookLib.run(buildCtx(o, true), o._[1], input); if (out) process.stdout.write(out + '\n'); return 0; }
    case 'check': return cmdCheck(o);
    case 'ask': return cmdAsk(o);
    case 'usage': return cmdUsage(o);
    case 'start': case 'break': case 'resume': return session.run(o._[0], o);
    case 'scaffold': return cmdScaffold(o);
    case 'tips': return cmdTips(o);
    case 'peak': return cmdPeak(o);
    case 'version': case '--version': console.log(VERSION); return 0;
    default: console.error(`askai: unknown command "${cmd}"\n\n${HELP}`); return 2;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code || 0; }, e => { console.error(`askai: ${e.message}`); process.exitCode = 1; });
}
module.exports = { parseArgs, buildCtx, select, main, VERSION };
