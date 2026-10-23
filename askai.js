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
const projectReview = require('./lib/project-review');
const cliPrepare = require('./lib/cli-prepare');
const registry = require('./lib/project-registry');
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

const VERSION = '1.2.5';
const SRC = __dirname;

const HELP = `askai ${VERSION}: token-saving setup for Claude Code, Cursor, Codex and Google Antigravity.
askai help <command> for one command. askai help all for every command. --help on a command does the same. askai plugins info <id> for one plugin.

Setup: install, update, tools update, uninstall, restore, profiles, suggest, scaffold, project, set
Every day: check, why, test, ask, next, handoff, weigh, run, errors, stop, break, resume, usage, go, prompt
Project: init, review, map, refresh, models, mcp, audit, setup, todo, convert, clear, diff, graph, context, snapshot
Reference: status, doctor, report, savings, infra, guide, tips, docs, session, chat, statusline, bootstrap, route

Flags: --yes --dry-run --profile (default ${profiles.DEFAULT}) --add --list --host --brief --quiet --no-color
       --target --only --skip --main-model (default claude-haiku-5-5) --subagent-model --codex-model --effort --json --seed-only --ignore-originals
       --no-statusline --no-path --tools --force --print --remove --hours --claude-home --cursor-home --codex-home --agy-home --repo --project
       --minutes --input-tokens --output-tokens --cached-tokens --success --rework-minutes --usage-source --notes --summary --next --result
       --tool --model --caveman --lsp --lean-git --markitdown --ccusage --rtk --context-mode --base-tools --headroom --graphify --context7
       --repomix --codebase-memory --claude-mem --caveman-plugin --output --kind --about --type --tier --files --done --mode --used --window
       --output-safe --out --name --path --build --test --threshold --for --include-untracked --personal --shared --undo --review --week --fill
       --cache --plugins --full --agents --demo --launch --prepare --clear --offline --copy --fix --refresh --resume --import-cursor --env --save
Profiles: minimal | code | docs | full | experimental. Aliases: coding = code, max = experimental.
Old names stay: askai upgrade = update, askai tools update = components.
`;

// ---- args --------------------------------------------------------------------------------------------------------
const BOOL = { yes: 'yes', y: 'yes', 'dry-run': 'dry', offline: 'offline', json: 'json', launch: 'launch', prepare: 'prepare', clear: 'clear', 'no-statusline': 'noStatusline', 'no-path': 'noPath', 'caveman-plugin': 'cavemanPlugin', markitdown: 'markitdown', ccusage: 'ccusage', tools: 'tools', force: 'force', print: 'print', remove: 'remove', lean: 'lean', rtk: 'rtk', 'context-mode': 'contextMode', 'lean-git': 'leanGit', copy: 'copy', fix: 'fix', refresh: 'refresh', resume: 'resume', 'base-tools': 'baseTools', headroom: 'headroom', graphify: 'graphify', context7: 'context7', repomix: 'repomix', 'codebase-memory': 'codebaseMemory', 'claude-mem': 'claudeMem', all: 'all', help: 'help', h: 'help', agents: 'agents', demo: 'demo', cache: 'cache', plugins: 'plugins', full: 'full', undo: 'undo', review: 'review', week: 'week', shared: 'shared', personal: 'personal', 'include-untracked': 'includeUntracked', 'seed-only': 'seedOnly', fill: 'fill', brief: 'brief', quiet: 'quiet', 'no-color': 'noColor', list: 'list', 'ignore-originals': 'ignoreOriginals', env: 'env' };
const VAL = { output: 'output', kind: 'kind', about: 'about', type: 'type', tier: 'tier', files: 'files', done: 'done', mode: 'mode', used: 'used', window: 'window', 'output-safe': 'outputSafe', out: 'out', project: 'project', p: 'project', name: 'name', path: 'path', build: 'build', test: 'test', only: 'only', skip: 'skip', caveman: 'caveman', profile: 'profile', target: 'target', 'claude-home': 'claudeHome', 'cursor-home': 'cursorHome', hours: 'hours', 'import-cursor': 'importCursor', save: 'save',
  'codex-home': 'codexHome', 'agy-home': 'agyHome', 'main-model': 'mainModel', 'subagent-model': 'subagentModel', 'codex-model': 'codexModel',
  repo: 'repo', tool: 'tool', model: 'model', effort: 'effort', task: 'task', difficulty: 'difficulty', summary: 'summary', next: 'next',
  result: 'result', minutes: 'minutes', 'input-tokens': 'inputTokens', 'output-tokens': 'outputTokens', 'cached-tokens': 'cachedTokens',
  success: 'success', 'rework-minutes': 'reworkMinutes', 'usage-source': 'usageSource', notes: 'notes', lsp: 'lsp', threshold: 'threshold', for: 'for', host: 'host', add: 'add' };
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
const registryHome = o => registry.folder(o);
function projectDir(o, positional, fallback = true) {
  const found = registry.resolve(registryHome(o), o.project || o.repo || positional);
  return found ? found.path : fallback ? process.cwd() : null;
}
function registerProject(o, dir) {
  if (o.dry) return;
  const data = registry.read(registryHome(o));
  const existing = Object.entries(data.projects).find(([, p]) => process.platform === 'win32' ? p.toLowerCase() === dir.toLowerCase() : p === dir);
  const name = o.name || (existing && existing[0]) || path.basename(dir);
  if (existing && existing[0].toLowerCase() === name.toLowerCase()) { console.log(`  registered project ${existing[0]} -> ${existing[1]}`); return; }
  const result = registry.register(registryHome(o), name, dir);
  console.log(`  registered project ${result.name} -> ${result.path}`);
}
function registrationName(o, dir) {
  const data = registry.read(registryHome(o));
  const canonical = registry.canonical(dir);
  const existing = Object.entries(data.projects).find(([, p]) => process.platform === 'win32' ? p.toLowerCase() === canonical.toLowerCase() : p === canonical);
  const name = o.name || (existing && existing[0]) || path.basename(canonical);
  registry.canRegister(registryHome(o), name, canonical);
  return name;
}

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
  const env = { RTK_TELEMETRY_DISABLED: '1', CLAUDE_CODE_DISABLE_TELEMETRY: '1', DISABLE_TELEMETRY: '1', ...(o.claudeHome ? { CLAUDE_CONFIG_DIR: home } : {}) };
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
    // Add/remove one dir on the user PATH. Windows uses the registry. macOS and Linux write ~/.bashrc and ~/.profile.
    editPath(dir, add) {
      if (o.noPath) return 'skipped (--no-path)';
      if (sandbox) return 'skipped (custom claude home)';
      if (dry) { log.plan(`${add ? 'add' : 'remove'} ${dir} ${add ? 'to' : 'from'} user PATH`); return 'planned'; }
      if (!S.IS_WIN) return cfg.editUnixPath(dir, add);
      return winpath.editUserPath(S.run, dir, add);
    },
    // Git Bash doesn't do PATHEXT resolution, so bare `askai` (vs `askai.cmd`) fails to resolve there even
    // though it's on PATH. Idempotently add/remove an alias in ~/.bashrc so Claude/Cursor/Codex/Antigravity
    // sessions backed by Git Bash can run bare `askai`. Returns 'changed' | 'unchanged' | 'planned' | 'skipped (...)'.
    editBashAlias(add) {
      if (!S.IS_WIN) return 'skipped (not Windows)';
      if (o.noPath) return 'skipped (--no-path)';
      if (sandbox) return 'skipped (custom claude home)';
      if (!S.which('bash')) return 'skipped (no bash on PATH)';
      if (dry) { log.plan(`${add ? 'add' : 'remove'} askai alias in ~/.bashrc`); return 'planned'; }
      return cfg.editBashrcAlias(add);
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
  const only = list(o.only), skip = list(o.skip), extra = list(o.add);
  for (const id of [...only, ...skip, ...extra]) if (!known.includes(id)) throw new Error(`unknown component "${id}" (known: ${known.join(', ')})`);
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
  if (extra.length) {
    const have = new Set(sel.map(c => c.id));
    for (const c of comps.ALL) if (extra.includes(c.id) && !have.has(c.id)) sel.push(c);
  }
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
  fs.mkdirSync(path.join(dest, 'scripts'), { recursive: true });
  for (const n of ['gen-docs.js', 'validate-install.js']) if (fs.existsSync(path.join(SRC, 'scripts', n))) fs.copyFileSync(path.join(SRC, 'scripts', n), path.join(dest, 'scripts', n));
  fs.mkdirSync(path.join(dest, 'hooks'), { recursive: true });
  for (const f of ['askai.js', 'package.json', path.join('hooks', 'askai-report.js')]) {
    if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(dest, f));
  }
  // Templates for `askai scaffold` and `askai session` (missing in a stripped checkout: those commands then say so).
  if (fs.existsSync(path.join(SRC, 'knowledge'))) {
    fs.rmSync(path.join(dest, 'knowledge'), { recursive: true, force: true });
    fs.cpSync(path.join(SRC, 'knowledge'), path.join(dest, 'knowledge'), { recursive: true });
  }
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

function installCommands(ctx, hosts = ctx.hostSel) {
  const files = ctx.manifest.files = (ctx.manifest.files || []);
  const source = path.join(SRC, 'commands');
  const hostEntries = (file, skillName, skillDescription) => {
    const raw = fs.readFileSync(path.join(source, file), 'utf8');
    const skill = raw.replace(/^---\n[\s\S]*?\n---\n/, `---\nname: ${skillName}\ndescription: ${skillDescription}\n---\n`);
    const out = [];
    if (hosts.claude) out.push({ target: path.join(ctx.paths.home, 'commands', file), text: raw });
    if (hosts.cursor) out.push({ target: path.join(ctx.cursorPaths.home, 'commands', file), text: cursor.cursorCommandText(raw) });
    if (hosts.codex) {
      out.push({ target: path.join(ctx.codexPaths.home, 'prompts', file), text: raw.replace('disable-model-invocation: true\n', '') });
      out.push({ target: path.join(ctx.codexPaths.skills, skillName, 'SKILL.md'), text: skill });
    }
    if (hosts.agy) for (const dir of [ctx.agyPaths.cliSkills, ctx.agyPaths.appSkills]) out.push({ target: path.join(dir, skillName, 'SKILL.md'), text: skill });
    return out;
  };
  const entries = [
    ...hostEntries('askai-cli.md', 'askai-cli', 'Set up a project with AskAI and AI review, then open its terminal. Use when the user invokes askai-cli.'),
    ...hostEntries('askai-plugins.md', 'askai-plugins', 'Use the connected token tools in this chat. Use when the user invokes askai-plugins.'),
  ];
  // Retire only launchers recorded in AskAI's manifest. Keep edited or user-owned files.
  const old = [
    ...(hosts.claude ? ['askai.md', 'askai-status.md', 'askai-report.md', 'askai-handoff.md'].map(n => path.join(ctx.paths.home, 'commands', n)) : []),
    hosts.cursor && path.join(ctx.cursorPaths.home, 'commands', 'askai-handoff.md'),
    hosts.cursor && path.join(ctx.cursorPaths.home, 'commands', 'askai.md'),
    hosts.codex && path.join(ctx.codexPaths.home, 'prompts', 'askai.md'), hosts.codex && path.join(ctx.codexPaths.skills, 'askai', 'SKILL.md'),
    ...(hosts.agy ? [path.join(ctx.agyPaths.cliSkills, 'askai', 'SKILL.md'), path.join(ctx.agyPaths.appSkills, 'askai', 'SKILL.md')] : [])].filter(Boolean);
  if ((ctx.manifest.components.handoff || {}).files?.length) comps.byId('handoff').uninstall(ctx);
  for (const target of old) {
    const i = files.findIndex(f => f.path === target);
    if (i < 0) continue;
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current !== null && sha(current) !== files[i].sha) { ctx.log.warn(`${target} was edited after askai wrote it, left in place`); continue; }
    if (ctx.dry) { ctx.log.plan(`remove ${target}`); continue; }
    if (current !== null) { ctx.backup(target); fs.rmSync(target); }
    files.splice(i, 1);
  }
  if (!ctx.dry) for (const target of old) {
    const parent = path.dirname(target);
    if (path.basename(parent) !== 'askai') continue;
    try { if (!fs.readdirSync(parent).length) fs.rmdirSync(parent); } catch (_) { /* absent or not empty */ }
  }
  let changed = 0;
  for (const entry of entries) {
    const target = entry.target;
    const text = entry.text.replace(/\{\{ASKAI\}\}/g, () => askaiCmd(ctx));
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === text) continue;
    const owned = files.find(f => f.path === target);
    if (current !== null && (!owned || owned.sha !== sha(current)) && !ctx.opts.force) { ctx.log.warn(`${target} exists and was not written by askai; left in place (use --force to overwrite)`); continue; }
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
  if (o.list) { for (const c of comps.ALL) console.log(c.id); return 0; }
  if (o.seedOnly && (!o.target || o.target === 'auto')) o.target = 'claude';
  if (o.profile === 'max' && !o.lsp) o.lsp = 'ts,py'; // the max profile includes Claude Code's TypeScript and Python code intelligence
  if (o.project) registrationName(o, projectDir(o, o.project));
  const ctx = buildCtx(o);
  preflight(ctx);
  const hosts = cursor.hosts(ctx);
  ctx.hostSel = hosts;
  const sel = select(o, 'install', recordedProfile(ctx), hosts);
  const prof = profiles.get(o.profile || recordedProfile(ctx));
  const skipOf = (c, d) => d.state === 'other' || (d.state === 'ok' && !o.force && !(c.id === 'caveman' && o.caveman));
  const rows = sel.map(c => { const d = safeDetect(c, ctx); return { c, d, skip: skipOf(c, d) }; });

  console.log(`askai install${o.dry ? ' (dry-run: nothing is written or installed)' : ''}${o.seedOnly ? ' (seed-only: settings for a host that may not be installed yet)' : ''}   for ${hostLine(ctx, hosts)}`);
  console.log(list(o.only).length ? `components chosen with --only; the ${prof.name} profile is not applied\n` : `profile: ${prof.name}: ${prof.summary}\n`);
  if ((o.profile || recordedProfile(ctx)) === 'max') console.log('note: max is the previous name of experimental. This run keeps max. Measure each extra tool with askai usage before adding it.');
  if (!rows.length) { console.log('Nothing selected.'); return 0; }
  const installing = rows.filter(r => !r.skip);
  const skipping = rows.filter(r => r.skip);
  const skipWhy = r => r.c.id === 'context-mode' && !comps.nodeOk(ctx.nodeVersion) ? 'Node < 22.5' : r.d.detail;
  console.log(`will install ${installing.length} · will skip ${skipping.length}${skipping.length ? ` (${skipping.slice(0, 6).map(r => `${r.c.id}: ${skipWhy(r)}`).join('; ')})` : ''}`);
  const w = Math.max(...rows.map(r => r.c.id.length));
  for (const r of rows) {
    console.log(`  ${pad(r.c.id, w)}  ${pad(r.d.state, 7)}  ${r.skip ? `skip: ${r.d.detail}` : `will install/wire: ${planText(ctx, r.c.plan)}`}`);
  }
  if (rows.some(r => r.c.id === 'token-kit' && !r.skip)) console.log('  note: token-kit runs first; every component after it is checked again and re-applies what the takeover removed');
  console.log(`  ${pad('askai', w)}          copy to ${ctx.paths.app}, shim in ${ctx.paths.bin}${o.noPath || ctx.sandbox ? '' : ' (added to user PATH)'}${S.IS_WIN && !o.noPath && !ctx.sandbox && S.which('bash') ? ', askai alias in ~/.bashrc for Git Bash' : ''}, command entry points in selected hosts`);
  const files = [hosts.claude && 'settings.json, CLAUDE.md, .claude.json', hosts.cursor && "Cursor's mcp.json and hooks.json", hosts.codex && "Codex's config.toml and AGENTS.md", hosts.agy && "Antigravity's GEMINI.md and mcp_config.json"].filter(Boolean);
  console.log(`\nBacks up ${files.join('; ')} before every change; existing keys, entries and hooks are kept.`);
  if (!await confirm(o, '\nProceed?')) { console.log('Aborted, nothing changed.'); return 1; }

  const results = [];
  console.log('\n[askai] app, shim, commands');
  try {
    console.log(`  app: ${copyApp(ctx)}`);
    writeShim(ctx);
    console.log(`  command entry points: ${installCommands(ctx, hosts)} written`);
    console.log(`  user PATH: ${pathStep(ctx, true)}`);
    console.log(`  Git Bash alias (~/.bashrc): ${ctx.editBashAlias(true)}`);
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
    console.log(`\nDone. Open a NEW ${hostNames(hosts).join(' / ')} session so hooks, plugins and MCP servers load.`);
    if (!hosts.claude) console.log(`AskAI's own program is in ${ctx.paths.askaiDir}. A Cursor-only install uses that folder too. It is not a Claude Code setup.`);
    if (hosts.cursor) console.log('Cursor user rules are in ~/.cursor/rules and apply in every project on this machine. Restart Cursor so it reads the hooks, MCP servers and rules. `askai project` writes the same files into one repo for git; skip it here, or the always-applied rule is loaded twice.');
    if (hosts.cursor) console.log('In Cursor chat, type / and choose askai-cli. Cursor reads <project>/.cursor/commands/askai-cli.md. On SSH or a devcontainer it does not read ~/.cursor/commands from the remote home. Open the project folder itself, not its parent, then reload the window.');
  }
  if (o.project) { console.log(''); const dir = projectDir(o, o.project); const name = registrationName(o, dir); const references = await project.research(dir, { offline: o.offline, dry: o.dry }); project.init(dir, { yes: true, dry: o.dry, about: o.about, type: o.type, references }, ctx); registerProject({ ...o, name }, dir); }
  ensureSessionTerminal(o, false, ctx.sandbox);
  if (!o.dry) { console.log('Check this machine: askai setup' + (o.project ? ` ${o.project}` : ' <repo>') + '.'); console.log('In a new chat: /askai-cli sets up the project (Codex: $askai-cli). /askai-plugins finishes one-time plugin setup and says when each tool is called.'); try { const dir = o.project ? projectDir(o, o.project) : null; const list = todo.items(ctx, dir); const n = todo.open(list).length; if (n && dir) console.log(`\nRemaining setup and review steps (${n}); askai todo ${dir} shows them again:\n${todo.render(list)}`); else if (n) console.log(`Next: askai todo lists ${n} remaining setup and review steps.`); } catch (_) { /* best effort */ } }
  return failed.length ? 1 : 0;
}

function hintOnce(ctx, key, line) {
  if (process.env.ASKAI_QUIET) return;
  const f = path.join(ctx.paths.askaiDir, 'hints.json');
  let j = {};
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* first hint */ }
  const day = new Date().toISOString().slice(0, 10);
  if (j[key] === day) return;
  j[key] = day;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); } catch (_) { /* still say it */ }
  console.error(line);
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
  ensureSessionTerminal(o, false, ctx.sandbox);
  console.log(failed ? `\n${failed} failure(s).` : '\nDone. AskAI itself: askai update.');
  return failed ? 1 : 0;
}

function cmdStatus(o) {
  const ctx = buildCtx(o, false);
  ctx.refreshPath();
  if (o.json) { console.log(JSON.stringify(status.collect(ctx), null, 2)); return 0; }
  console.log(status.renderStatus(ctx, projectDir(o)).lines.join('\n'));
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
  if (o._[1] === 'migrate') {
    const before = Object.keys(ctx.manifest.components || {}).sort().join(',');
    if (ctx.manifest.profile !== 'max') { console.log('No recorded max profile. Nothing renamed.'); return 0; }
    ctx.manifest.profile = 'experimental';
    saveManifest(ctx, 'profiles migrate', []);
    const after = Object.keys(ctx.manifest.components || {}).sort().join(',');
    if (before !== after) { console.error('profiles migrate changed the tool list'); return 1; }
    console.log('note: recorded profile max is now experimental. Installed tools were not changed.');
    return 0;
  }
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
  const dir = projectDir(o, o._[1]);
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

function cmdProjects(o) {
  const data = registry.read(registryHome(o));
  const rows = Object.entries(data.projects).map(([name, dir]) => ({ name, path: dir,
    active: process.env.ASKAI_PROJECT === name, default: data.default === name, exists: fs.existsSync(dir) }));
  if (o.json) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(rows.length ? rows.map(r => `${r.active ? '*' : ' '} ${r.name}${r.default ? ' (default)' : ''} -> ${r.path}${r.exists ? '' : ' (missing; askai project path NAME NEW_PATH)'}`).join('\n') : 'No projects registered. Run askai init --name NAME --path FOLDER.');
    console.log('Selection: askai set project NAME; one project: askai project show.');
  }
  return 0;
}
function cmdSet(o) {
  const area = o._[1];
  if (area === 'project') {
    if (o.clear) { delete process.env.ASKAI_PROJECT; console.log('Cleared active project in this AskAI process.'); return 0; }
    if (!o._[2]) { console.error('askai set project NAME | --clear'); return 1; }
    const chosen = registry.select(registryHome(o), o._[2]);
    process.env.ASKAI_PROJECT = chosen.name;
    console.log(`Active project: ${chosen.name} -> ${chosen.path}`);
    return 0;
  }
  if (area === 'default') {
    const name = registry.setDefault(registryHome(o), o.clear ? null : o._[2]);
    console.log(name ? `Default project: ${name}` : 'Cleared default project.'); return 0;
  }
  console.error('askai set project NAME | project --clear | default NAME | default --clear'); return 1;
}
async function cmdProjectRegistry(o) {
  const dir = registryHome(o); const action = o._[1];
  if (action === 'show') {
    const found = registry.resolve(dir, o.project || o._[2]);
    console.log(found ? `${found.name || '(unregistered folder)'} -> ${found.path}` : 'No project selected. Run askai project list or askai init <folder>.');
    return found ? 0 : 1;
  }
  if (action === 'rename') {
    if (!o._[2] || !o._[3]) throw new Error('usage: askai project rename OLD NEW');
    const result = registry.rename(dir, o._[2], o._[3]);
    if (process.env.ASKAI_PROJECT && process.env.ASKAI_PROJECT.toLowerCase() === o._[2].toLowerCase()) process.env.ASKAI_PROJECT = result.name;
    console.log(`Renamed project: ${result.name} -> ${result.path}`); return 0;
  }
  if (action === 'path') {
    if (!o._[2] || !o._[3]) throw new Error('usage: askai project path NAME NEW_PATH');
    const result = registry.move(dir, o._[2], o._[3]); console.log(`Moved project: ${result.name} -> ${result.path}`); return 0;
  }
  if (action === 'remove') {
    if (!o._[2]) throw new Error('usage: askai project remove NAME');
    const result = registry.remove(dir, o._[2]);
    if (process.env.ASKAI_PROJECT && process.env.ASKAI_PROJECT.toLowerCase() === result.name.toLowerCase()) delete process.env.ASKAI_PROJECT;
    console.log(`Unregistered ${result.name}; project files kept at ${result.path}`); return 0;
  }
  if (action === 'switch') {
    if (o._[2]) return cmdSet({ ...o, _: ['set', 'project', o._[2]] });
    const names = Object.keys(registry.read(dir).projects);
    if (!names.length) { console.error('No projects registered. Run askai init <folder>.'); return 1; }
    if (!process.stdin.isTTY) { console.error('Run askai project switch NAME, or askai set project NAME.'); return 1; }
    console.log(names.map((name, i) => `  ${i + 1}. ${name}`).join('\n'));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question('Project number or name: ', resolve)); rl.close();
    const chosen = names[Number(answer) - 1] || answer.trim();
    return cmdSet({ ...o, _: ['set', 'project', chosen] });
  }
  return 1;
}
function cmdShell(o) {
  const shell = require('./lib/project-shell');
  if (o._[1] === 'init') { console.log(shell.init(o._[2])); return 0; }
  if (o._[1] === 'install') {
    if (!o.path) throw new Error('usage: askai shell install powershell|bash|zsh --path PROFILE');
    console.log(`AskAI shell integration installed in ${shell.install(registryHome(o), o.path, o._[2], path.join(SRC, 'askai.js'))}`); return 0;
  }
  if (o._[1] === 'uninstall') { console.log(`Removed AskAI shell integration from ${shell.uninstall(registryHome(o)).length} profile(s).`); return 0; }
  console.error('askai shell init|install powershell|bash|zsh [--path PROFILE] | uninstall'); return 1;
}

// Cursor: write (or show, or remove) the token rules of a project in <dir>/.cursor/rules.
function cmdProject(o) {
  if (!o._[1] && !o.print && !o.remove && !o.profile && !o.force) return cmdProjectRegistry({ ...o, _: ['project', 'show'] });
  if (o._[1] === 'refresh') {
    const dir = projectDir(o, o._[2]);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch (_) { /* missing */ }
    if (!isDir) { console.error(`askai: ${dir} is not a directory`); return 1; }
    const result = require('./lib/project-refresh').run(dir, { dry: !!o.dry, ctx: buildCtx(o, true) });
    console.log(result.text);
    return 0;
  }
  if (o._[1] === 'hide-local') {
    const dir = projectDir(o, o._[2]);
    const result = require('./lib/daily').hideLocal(dir, o);
    console.log(result.text);
    return result.code;
  }
  if (o._[1] === 'rules') o = { ...o, _: ['project', ...o._.slice(2)] };
  if (o._[1] === 'list') return cmdProjects(o);
  if (['show', 'rename', 'path', 'remove', 'switch'].includes(o._[1])) return cmdProjectRegistry(o);
  const ctx = buildCtx(o);
  const dir = projectDir(o, o._[1]);
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

// report is usage --full plus one check --brief line. It has no sections of its own.
function cmdReport(o) {
  const code = cmdUsage({ ...o, full: true });
  const lines = [];
  check.run(buildCtx(o, true), projectDir(o, null, false), { brief: true }, line => lines.push(line));
  if (lines.length) console.log(lines.join('\n'));
  return code;
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
    if (!o.dry) try { require('./lib/project-shell').uninstall(registryHome(o)); } catch (e) { console.error(`  shell integration removal failed: ${e.message}`); failed++; }
  }
  try { comps.refreshDerived(ctx); } catch (e) { ctx.log.warn(`could not refresh derived files: ${e.message}`); }
  console.log('\n[askai] commands, shim, PATH, app');
  try {
    removeCommands(ctx);
    console.log(`  user PATH: ${pathStep(ctx, false)}`);
    console.log(`  Git Bash alias (~/.bashrc): ${ctx.editBashAlias(false)}`);
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
function diagramOpenable(platform = process.platform, env = process.env, tty = !!(process.stdin.isTTY && process.stdout.isTTY)) {
  if (!tty) return false;
  if (platform === 'linux') return !!(env.DISPLAY || env.WAYLAND_DISPLAY || env.BROWSER);
  return platform === 'win32' || platform === 'darwin';
}
function suggestCommand(cmd) {
  const names = help.names();
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    return d[a.length][b.length];
  };
  let best = null; let bestD = 3;
  for (const n of names) { const d = dist(cmd, n); if (d < bestD) { best = n; bestD = d; } }
  return best;
}
function cmdStatusline(o) {
  if (process.stdin.isTTY && !o.demo) {
    console.log('Reads Claude Code status JSON on stdin. Try: askai statusline --demo.');
    return 0;
  }
  let line = 'askai';
  try {
    let input = '';
    if (o.demo) input = '{"context_window":{"used_percentage":42},"prompt_cache":{"hit_ratio":0.5}}';
    else if (!process.stdin.isTTY) { try { input = fs.readFileSync(0, 'utf8'); } catch (_) { /* no stdin */ } }
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
  if (o.dry) { console.log(`would ${exists ? 'update' : 'clone'} ${url} (latest) in ${src}, then run its install --yes${ctx.manifest.profile ? ` --profile ${ctx.manifest.profile}` : ''}${ctx.manifest.target ? ` --target ${ctx.manifest.target}` : ''}`); if (o.agents) console.log('then open Claude Code, Cursor and Codex in sequence for review, synthesis and verified changes (uses model tokens)'); return 0; }
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
  if (r.status === null || r.status) return r.status === null ? 1 : r.status;
  if (!o.agents) return 0;
  const agentCtx = buildCtx(o, true);
  const agents = [
    ['claude', 'Review AskAI setup, installer safety and project templates. Record specific source-backed findings in .ai-work/upgrade-claude.md. Do not edit product code.'],
    ['cursor', 'Review AskAI command UX, plugin activation evidence and token costs. Record specific source-backed findings in .ai-work/upgrade-cursor.md. Do not edit product code.'],
    ['codex', 'Read the two upgrade reviews, verify findings against source and tests, then implement the smallest justified improvements. Update help, docs and tests; run the narrow tests and docs check. Leave unsupported suggestions in .ai-work/upgrade-followup.md.'],
  ];
  const missing = agents.map(([tool]) => launch.plan(agentCtx, tool).cmd).filter(cmd => !agentCtx.which(cmd));
  if (missing.length) { console.log(`Upgrade installed AskAI, but agent review needs these CLIs on PATH: ${missing.join(', ')}. Run askai upgrade --agents after installing them.`); return 1; }
  console.log('Starting Claude Code, Cursor and Codex in sequence. Each session uses model tokens. Exit each session to continue.');
  for (const [tool, ask] of agents) {
    const result = launch.run(agentCtx, tool, { tier: 'lead', repo: src, ask });
    if (result) return result;
    if (tool !== 'codex') {
      const report = path.join(src, '.ai-work', `upgrade-${tool}.md`);
      if (!fs.existsSync(report)) { console.log(`${tool} session ended without ${report}; review stopped. Run askai upgrade --agents after recording the report.`); return 1; }
    }
  }
  return 0;
}
function cmdDiff(o) {
  const repo = projectDir(o, o._[1]); const g = a => require('child_process').spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  const st = g(['diff', '--stat']); if (st.status !== 0) { console.log(`not a git repository: ${repo}`); return 1; }
  const staged = g(['diff', '--cached', '--stat']).stdout.trim(); const check = g(['diff', '--check']);
  console.log(st.stdout.trim() || '(no unstaged changes)'); if (staged) console.log(`\nstaged:\n${staged}`);
  const short = g(['status', '--short', '--untracked-files=all']);
  const extra = String(short.stdout || '').split(/\n/).filter(l => l.startsWith('??'));
  const ai = extra.filter(l => /^\?\? (\.agents\/|\.claude\/|\.codex\/|\.cursor\/|\.ai-work\/|\.cursorignore|AGENTS\.md|CLAUDE\.md|GEMINI\.md|docs\/ai\/)/.test(l));
  if (extra.length) console.log(`+${extra.length} untracked (${ai.length} AI/tool files) not in this diff`);
  console.log(`\nwhitespace check: ${check.status === 0 ? 'ok' : `problems\n${String(check.stdout).split(/\n/).slice(0, 40).join('\n')}`}`);
  console.log('Review the full diff yourself; give the agent only the files it needs, not the whole diff.');
  if (o.review) {
    const names = String(g(['diff', '--name-only']).stdout || '').split(/\n/).map(s => s.trim()).filter(Boolean).slice(0, 12);
    console.log(['', 'Review only these files:', ...names.map(n => `  ${n}`), 'Say what is wrong. Do not rewrite files that are not in this list.'].join('\n'));
  }
  return check.status === 0 ? 0 : 1;
}
function cmdGraph(o) {
  const repo = projectDir(o, o._[1]);
  const f = path.join(repo, 'docs', 'ai', 'ARCHITECTURE.md');
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch (_) { console.log(`no ${f}: run askai init`); return 1; }
  const blocks = [...t.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map(m => m[1]);
  if (!blocks.length) { console.log('ARCHITECTURE.md has no Mermaid diagram yet (ask the agent to use the architecture-map skill).'); return 1; }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><meta charset="utf-8"><title>Architecture</title><script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"; mermaid.initialize({ startOnLoad: true });</script><pre class="mermaid">${esc(blocks[0])}</pre>\n`;
  const out = path.join(repo, '.ai-work', 'architecture.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(blocks.join('\n\n'));
  if (diagramOpenable() && !o.dry && !o.print) {
    const cp = require('child_process');
    const open = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', out]] : process.platform === 'darwin' ? ['open', [out]] : ['xdg-open', [out]];
    const child = cp.spawn(open[0], open[1], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); child.unref();
    console.log(`\nOpened ${out}`);
  } else console.log(`\n${out}\nNo display here. Open it with: cursor "${out}"`);
  return 0;
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
  else if (o.resume && !o._[1]) text = promptLib.resume(projectDir(o));
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
  const DOCS = { install: 'INSTALL.md', architecture: 'ARCHITECTURE.md', projects: 'PROJECT_MANAGEMENT.md', guide: 'ASKAI_GUIDE.md', cheatsheet: 'CHEAT_SHEET.md', changelog: 'CHANGELOG.md', preview: 'PREVIEW_MATRIX.md' };
  const name = o._[1];
  if (name === 'check') {
    const script = path.join(SRC, 'scripts', 'gen-docs.js');
    if (!fs.existsSync(script)) { console.error('Documentation checker is missing from this AskAI copy. Reinstall AskAI.'); return 1; }
    const r = require('child_process').spawnSync(process.execPath, [script, '--check'], { stdio: 'inherit' });
    return r.status === 0 ? 0 : 1;
  }
  if (!name || !DOCS[name]) { for (const [k, v] of Object.entries(DOCS)) console.log(`  askai docs ${k.padEnd(13)} ${path.join(SRC, 'docs', v)}`); console.log('  askai docs check      validate generated command documentation'); console.log('  (add --print to show one in the terminal)'); return name ? 1 : 0; }
  const f = path.join(SRC, 'docs', DOCS[name]);
  if (!fs.existsSync(f)) { console.log(`${f} is not in this copy of AskAI (docs live in the downloaded folder)`); return 1; }
  console.log(o.print ? fs.readFileSync(f, 'utf8') : f); return 0;
}
function cmdConvert(o) {
  const ctx = buildCtx(o, true);
  if (o._[1] === 'scan') { console.log(require('./lib/daily').scanOffice(projectDir(o), o)); return 0; }
  const src = o._[1];
  if (!src) { console.log('askai convert <file|url> [--out file.md]: PDF, Word, PowerPoint, Excel, HTML, YouTube URL -> Markdown (Microsoft MarkItDown, local)'); return 1; }
  if (!ctx.which('markitdown')) { console.log('MarkItDown is not installed: askai install --only markitdown (or --profile docs). Videos other than YouTube need a transcriber first (graphifyy[video] or Whisper).'); return 1; }
  const isUrl = /^https?:\/\//.test(src);
  const out = o.out || path.join(projectDir(o), 'docs', 'ai', 'inputs', `${(isUrl ? src.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_') : path.basename(src, path.extname(src))).slice(0, 80)}.md`);
  if (fs.existsSync(out)) { console.log(`${out} exists; choose another --out`); return 1; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = require('child_process').spawnSync('markitdown', [src, '-o', out], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status === 0) { const n = fs.readFileSync(out, 'utf8').length; console.log(`wrote ${out} (~${Math.ceil(n / 4).toLocaleString('en-US')} tokens). Point the agent at the section it needs, not the whole file.`); }
  return r.status || 0;
}
async function cmdSetup(o) {
  const ctx = buildCtx(o, true);
  ctx.refreshPath();
  const dir = projectDir(o, o._[1]);
  ensureSessionTerminal(o, false, ctx.sandbox);
  const result = require('./lib/setup').report(ctx, dir);
  console.log(result.text);
  let go = !!o.yes;
  if (!go && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise(res => rl.question('Continue? [Y/n] ', res));
    rl.close();
    go = ans.trim() === '' || /^y(es)?$/i.test(ans.trim());
  } else if (!go) go = true;
  if (!go) return result.code;
  console.log('Wizard: install, then init.');
  if (o.dry) {
    console.log('would run: askai install --yes');
    console.log(`would run: askai init ${dir}`);
    return result.code;
  }
  const code = await cmdInstall({ ...o, yes: true, _: ['install'] });
  if (code) return code;
  return cmdInit({ ...o, _: ['init', dir] }) || 0;
}
function cmdWhy(o) {
  const id = o._[1];
  if (!id) { console.log('Usage: askai why <finding-id>'); return 1; }
  const findings = require('./lib/findings');
  const text = findings.why(findings.collectFindings(buildCtx(o, true), projectDir(o)), id);
  let rule = '';
  if (text !== `No finding ${id}.`) {
    try {
      const topic = require('./lib/knowledge').load(path.join(__dirname, 'knowledge'), id);
      if (topic && topic.rule) rule = `\nRule: ${topic.rule}`;
    } catch (_) { /* this finding has no knowledge topic */ }
  }
  console.log(text + rule);
  return text === `No finding ${id}.` ? 1 : 0;
}
function cmdTest(o) {
  const selftest = require('./lib/selftest');
  const cwd = projectDir(o);
  const result = selftest.run({ cwd, out: o.out, version: VERSION, json: !!o.json });
  if (o.json) console.log(JSON.stringify({ file: result.file, failedToRun: !!result.failedToRun, header: result.header, commands: result.results.length }, null, 2));
  else console.log(result.summary);
  return result.failedToRun ? 1 : 0;
}
function cmdCheck(o) {
  if (o.env) {
    console.log(require('./lib/platform').envReport({ dir: projectDir(o) || process.cwd() }));
    return 0;
  }
  const ctx = buildCtx(o, true);
  const dir = projectDir(o, o._[1], false);
  return check.run(ctx, dir, o);
}
function cmdAsk(o) {
  const q = o._.slice(1).join(' ').trim();
  if (!q) { console.log(`Usage: askai ask <topic>\n\n${kb.topics()}`); return 0; }
  const hits = kb.search(q, 3);
  if (!hits.length) { console.log(`No rule matches "${q}".\n\n${kb.topics()}`); return 1; }
  console.log(kb.render(hits[0]));
  if (hits.length > 1) console.log(`\nRelated: ${hits.slice(1).map(h => h.id).join(', ')}`);
  return 0;
}
function cmdUsage(o) {
  if (o.importCursor) {
    try { console.log(usage.importCursorCsv(o.importCursor)); return 0; }
    catch (e) { console.error(e.message); return 1; }
  }
  const days = o.week ? 7 : Number(o._[1] || o.hours || 7) || 7;
  const ctx = buildCtx(o, true);
  const summary = () => {
    let claudeText = '';
    let claudeError = '';
    if (ctx.which('ccusage')) {
      const r = ctx.probe('ccusage', ['daily', '--since', new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, '')], { timeout: 90000 });
      if (r.ok) claudeText = String(r.stdout).trimEnd().split(/\r?\n/).slice(0, 40).join('\n');
      else claudeError = `ccusage failed: ${firstLineOf(r.stderr || r.stdout)}`;
    } else {
      const script = path.join(SRC, 'hooks', 'askai-report.js');
      const r = require('child_process').spawnSync(process.execPath, [script, '--hours', String(days * 24)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...(o.claudeHome ? { CLAUDE_CONFIG_DIR: ctx.paths.home } : {}) } });
      if (r.status === 0) claudeText = String(r.stdout || '').trimEnd().split(/\r?\n/).slice(0, 30).join('\n');
    }
    const codex = ctx.codexPaths ? usage.codex(ctx.codexPaths.home, days) : { files: 0 };
    const claudeInstalled = !!(ctx.which && ctx.which('claude')) || fs.existsSync(ctx.paths.settings);
    const codexInstalled = !!(ctx.which && ctx.which('codex')) || !!(ctx.codexPaths && fs.existsSync(ctx.codexPaths.home));
    return usage.summarizeUsage({ days, claudeText, claudeError, codex, claudeInstalled, codexInstalled });
  };
  if (o.full) {
    console.log(usage.fullText({
      summary: summary(),
      cache: usage.cacheText(status.renderCache(ctx, days * 24), days),
      plugins: require('./lib/savings').pluginLines(ctx, projectDir(o)),
    }));
    return 0;
  }
  if (o.cache) {
    console.log(usage.cacheText(status.renderCache(ctx, days * 24), days));
    return 0;
  }
  if (o.plugins) {
    console.log(require('./lib/savings').pluginLines(ctx, projectDir(o)));
    return 0;
  }
  const text = summary();
  if (!o.week) { console.log(text); return 0; }
  const top = require('./lib/findings').collectFindings(ctx, projectDir(o)).filter(f => f.severity === 'now' || f.severity === 'later').slice(0, 3);
  console.log([text, '', 'Top findings', ...(top.length ? top.map(f => `  ${f.id}  ${f.message}`) : [`  ${require('./lib/platform').mark('ok')} none`])].join('\n'));
  return 0;
}
function cmdSession(o) {
  try {
    const args = o._[1] === 'report' && o._.length > 2 ? [...o._.slice(0, 2), ...o._.slice(2).map(name => projectDir({ ...o, project: name }))] : o._;
    return session.run(o._[1], { ...o, _: args, repo: projectDir(o) });
  } catch (e) { console.error(`askai session: ${e.message}`); return 1; }
}
function cmdScaffold(o) {
  try { return scaffold.run(projectDir(o, o._[1]), o); } catch (e) { console.error(`askai scaffold: ${e.message}`); return 1; }
}
function cmdChat(o) {
  try { console.log(require('./lib/chat').render(o._[1])); return 0; }
  catch (e) { console.error(e.message); return 1; }
}
function cmdTips(o) {
  if (o._[1] === 'peak') return cmdPeak(o);
  try { console.log(tips.render(o._[1])); return 0; } catch (e) { console.error(`askai tips: ${e.message}`); return 1; }
}
function cmdPeak(o) {
  const lines = tips.peak(new Date());
  if (o.json) console.log(JSON.stringify({ peak: tips.isPeak(new Date()), lines }, null, 2)); else console.log(lines.join('\n'));
  return 0;
}

function cliArgs(line) {
  const args = []; let word = '', quote = null, started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && line[i + 1] === quote) word += line[++i];
      else word += c;
    } else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { args.push(word); word = ''; started = false; } }
    else { word += c; started = true; }
  }
  if (quote) throw new Error('unclosed quote');
  if (started) args.push(word);
  return args;
}
function commandOnPath(name) {
  if (!/^[a-z0-9.+-]+$/i.test(name)) return false;
  const cp = require('child_process');
  const found = cp.spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return found.status === 0 && !!String(found.stdout || '').trim();
}
function cliInstallPlan(env) {
  if (env.dry || env.sandbox || env.test || env.skip || env.need) return 'skip';
  return 'max';
}
async function installMaxFromCli(o) {
  const ctx = buildCtx({ ...o, yes: true }, true);
  const plan = cliInstallPlan({
    dry: !!o.dry,
    sandbox: !!ctx.sandbox,
    test: !!process.env.NODE_TEST_CONTEXT || process.env.ASKAI_CLI_INSTALL === '0',
    need: false,
  });
  if (plan === 'skip') return { profile: 'max', skipped: true };
  const target = o.target || ctx.manifest.target;
  const installOpts = { ...o, yes: true, profile: 'max', only: undefined, skip: undefined, project: undefined };
  if (target) installOpts.target = target;
  console.error(`Installing profile max${target ? ` for ${target}` : ''}. Already healthy components are skipped.`);
  const prev = console.log;
  console.log = console.error;
  let code = 1;
  try { code = await cmdInstall(installOpts) || 0; }
  catch (e) { console.error(`askai cli: max install failed: ${e.message}`); code = 1; }
  finally { console.log = prev; }
  return { profile: 'max', target: target || 'auto', code };
}
function launchPlan(env) {
  if (env.platform === 'win32' || env.platform === 'darwin') return env.platform;
  if ((env.display || env.wayland) && env.xterm) return 'x-terminal-emulator';
  if (env.tmux) return 'tmux';
  if (env.screen) return 'screen';
  if (env.tty) return 'tty';
  return 'message';
}
function sessionTerminalPlan(env) {
  if (env.platform === 'win32' || env.platform === 'darwin') return 'skip';
  if (env.display || env.wayland) return 'skip';
  if (env.tmux || env.screen) return 'skip';
  if (env.dry) return 'dry';
  if (env.root && env.apt) return 'apt';
  if (env.root && env.dnf) return 'dnf';
  if (env.root && env.apk) return 'apk';
  if (env.sudo && env.apt) return 'sudo-apt';
  if (env.sudo && env.dnf) return 'sudo-dnf';
  if (env.sudo && env.apk) return 'sudo-apk';
  return 'manual';
}
function ensureSessionTerminal(o, report, sandbox) {
  if (sandbox) return;
  if (process.platform === 'win32' || process.platform === 'darwin') {
    if (report) console.log('session terminal: not used on this OS');
    return;
  }
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  const plan = sessionTerminalPlan({
    platform: process.platform,
    display: process.env.DISPLAY,
    wayland: process.env.WAYLAND_DISPLAY,
    tmux: commandOnPath('tmux'),
    screen: commandOnPath('screen'),
    dry: !!(o && o.dry),
    root,
    apt: commandOnPath('apt-get'),
    dnf: commandOnPath('dnf') || commandOnPath('microdnf'),
    apk: commandOnPath('apk'),
    sudo: !root && commandOnPath('sudo'),
  });
  if (plan === 'skip') {
    if (report) console.log(`session terminal: ${commandOnPath('tmux') ? 'tmux' : commandOnPath('screen') ? 'screen' : 'not needed'}`);
    return;
  }
  if (plan === 'dry') { console.log('would install tmux so askai cli --launch can open a session on this headless machine'); return; }
  if (plan === 'manual') {
    console.log('tmux is not installed, and this user cannot install packages without a password. Run: sudo apt-get install -y tmux');
    return;
  }
  const cp = require('child_process');
  const dnfBin = commandOnPath('dnf') ? 'dnf' : 'microdnf';
  const spec = {
    apt: ['apt-get', ['install', '-y', 'tmux']],
    dnf: [dnfBin, ['install', '-y', 'tmux']],
    apk: ['apk', ['add', '--no-cache', 'tmux']],
    'sudo-apt': ['sudo', ['-n', 'apt-get', 'install', '-y', 'tmux']],
    'sudo-dnf': ['sudo', ['-n', dnfBin, 'install', '-y', 'tmux']],
    'sudo-apk': ['sudo', ['-n', 'apk', 'add', '--no-cache', 'tmux']],
  }[plan];
  const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
  console.log(`Installing tmux so askai cli --launch works on this headless machine (${spec[0]} ${spec[1].join(' ')})`);
  if (plan === 'apt' || plan === 'sudo-apt') {
    const update = plan === 'apt' ? ['apt-get', ['update']] : ['sudo', ['-n', 'apt-get', 'update']];
    cp.spawnSync(update[0], update[1], { stdio: 'inherit', env, timeout: 120000 });
  }
  const r = cp.spawnSync(spec[0], spec[1], { stdio: 'inherit', env, timeout: 180000 });
  if (r.status !== 0 || !commandOnPath('tmux')) console.log('tmux was not installed. Run: sudo apt-get install -y tmux');
  else console.log('tmux installed. After askai cli --launch, attach with: tmux attach -t askai');
}
function launchInMultiplexer(cp, script, kind) {
  const session = 'askai';
  const args = [process.execPath, script, 'cli'];
  const tty = !!(process.stdin.isTTY && process.stdout.isTTY);
  if (kind === 'tmux') {
    const has = cp.spawnSync('tmux', ['has-session', '-t', session], { encoding: 'utf8' });
    if (has.status !== 0) {
      const started = cp.spawnSync('tmux', ['new-session', '-d', '-s', session, ...args], { encoding: 'utf8' });
      if (started.status !== 0) {
        console.error(`Could not start a tmux session. In the Cursor terminal run: askai cli. ${String(started.stderr || (started.error && started.error.message) || '').trim()}`);
        return 1;
      }
    }
    console.log('AskAI CLI is running in tmux session "askai". In the Cursor terminal: tmux attach -t askai');
    if (tty && !process.env.TMUX) {
      const attached = cp.spawnSync('tmux', ['attach', '-t', session], { stdio: 'inherit' });
      if (attached.status === 0) return 0;
    }
    return 0;
  }
  const listed = cp.spawnSync('screen', ['-ls'], { encoding: 'utf8' });
  if (!new RegExp(`\\.${session}\\b`).test(`${listed.stdout || ''}\n${listed.stderr || ''}`)) {
    const started = cp.spawnSync('screen', ['-dmS', session, ...args], { encoding: 'utf8' });
    if (started.status !== 0) {
      console.error(`Could not start a screen session. In the Cursor terminal run: askai cli. ${String(started.stderr || (started.error && started.error.message) || '').trim()}`);
      return 1;
    }
  }
  console.log('AskAI CLI is running in screen session "askai". In the Cursor terminal: screen -r askai');
  if (tty && !process.env.STY) {
    const attached = cp.spawnSync('screen', ['-r', session], { stdio: 'inherit' });
    if (attached.status === 0) return 0;
  }
  return 0;
}
function launchCli() {
  const cp = require('child_process');
  const script = path.join(SRC, 'askai.js');
  const unix = process.platform !== 'win32' && process.platform !== 'darwin';
  const displayed = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const xterm = unix && displayed && commandOnPath('x-terminal-emulator');
  const plan = launchPlan({
    platform: process.platform,
    display: process.env.DISPLAY,
    wayland: process.env.WAYLAND_DISPLAY,
    xterm,
    tmux: unix && !xterm && commandOnPath('tmux'),
    screen: unix && !xterm && commandOnPath('screen'),
    tty: !!(process.stdin.isTTY && process.stdout.isTTY),
  });
  let r;
  if (plan === 'win32') {
    const ps = `& '${process.execPath.replace(/'/g, "''")}' '${script.replace(/'/g, "''")}' cli`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process powershell.exe -ArgumentList '-NoExit','-NoProfile','-EncodedCommand','${encoded}'`], { encoding: 'utf8' });
  } else if (plan === 'darwin') {
    const cmd = [process.execPath, script, 'cli'].map(x => `'${x.replace(/'/g, "'\\''")}'`).join(' ');
    r = cp.spawnSync('osascript', ['-e', `tell application "Terminal" to do script "${cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`], { encoding: 'utf8' });
  } else if (plan === 'x-terminal-emulator') {
    r = cp.spawnSync('x-terminal-emulator', ['-e', process.execPath, script, 'cli'], { encoding: 'utf8' });
  } else if (plan === 'tmux' || plan === 'screen') {
    return launchInMultiplexer(cp, script, plan);
  } else if (plan === 'tty') {
    console.log('No graphical terminal. Starting AskAI CLI in this terminal.');
    r = cp.spawnSync(process.execPath, [script, 'cli'], { stdio: 'inherit' });
    return r.status || 0;
  } else {
    console.log('No graphical terminal on this machine, and tmux is not installed. A devcontainer cannot open a new window. In the Cursor terminal run: askai cli');
    console.log('askai upgrade or askai setup installs tmux when this user can. Otherwise run: sudo apt-get install -y tmux');
    return 0;
  }
  if (r.status !== 0) { console.error(`Could not open a terminal. Run askai cli in the Cursor terminal. ${String(r.stderr || (r.error && r.error.message) || '').trim()}`); return 1; }
  console.log('Opened AskAI CLI.'); return 0;
}
async function cmdPrepare(o) {
  const log = console.log;
  if (o.json) console.log = () => {};
  try {
    const picked = cliPrepare.select(o);
    const text = body => [
      body.need ? body.question : `project: ${body.project || path.basename(body.path)} (${body.how})`,
      body.need === 'project' ? (body.candidates || []).map(c => `  ${c.name}  ${c.path}`).join('\n') : `path: ${body.path}`,
      body.default ? `default: ${body.default}` : '',
      body.action ? `action: ${body.action}` : '',
      body.init ? `init: ${body.init}` : '',
      ...(body.questions || []).map(q => `ask: ${q.ask}`),
      body.instruction || '',
    ].filter(Boolean).join('\n');
    const emit = (code, body) => { console.log = log; log(o.json ? JSON.stringify(body, null, 2) : text(body)); return code; };
    if (picked.need) return emit(2, picked);
    const dir = picked.path;
    const review = projectReview.status(dir);
    const required = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorignore', 'docs/ai/PROJECT_MAP.md',
      'docs/ai/SOURCE_INDEX.md', 'docs/ai/ARCHITECTURE.md', 'docs/ai/FEATURES.md',
      'docs/ai/REFERENCES.md', 'docs/ai/WORK_ORDER.md', 'docs/ai/MODELS.md', '.ai-work/HANDOFF.md',
      ...Object.keys(project.agentFiles(models.DEFAULTS)), ...Object.keys(project.skillFiles())];
    const initialized = fs.existsSync(path.join(dir, session.DIR, 'askai-init.json'));
    const missing = required.filter(rel => !fs.existsSync(path.join(dir, rel)));
    const reviewing = review.state !== 'current' || !!o.refresh || missing.length > 0;
    if (reviewing && !String(o.about || '').trim()) {
      const detected = project.detect(dir);
      return emit(2, {
        need: 'about', question: 'What is this project about, in one or two sentences?', default: detected.about || '',
        project: picked.project, path: dir, how: picked.how,
        instruction: 'Ask the user. Dictation in the chat is enough. Run again with --about "their words", or pass the default text when they accept it. Do not review until --about is set. AskAI cannot open a microphone.',
      });
    }
    const install = await installMaxFromCli(o);
    let init = 'skipped';
    let info = project.detect(dir);
    if (reviewing) {
        const name = registrationName({ ...o, name: o.name || picked.project }, dir);
        picked.project = name;
        const ctx = buildCtx({ ...o, yes: true }, true);
        const references = await project.research(dir, { offline: o.offline || o.dry, dry: o.dry });
        const result = project.init(dir, { ...o, yes: true, refresh: !!o.refresh || initialized, references }, ctx);
        if (!o.dry) registerProject({ ...o, name }, dir);
        info = result.info;
        init = o.dry ? 'planned' : 'ran';
    }
    const action = reviewing ? 'review' : 'launch';
    return emit(0, {
      action, init, install, project: picked.project, path: dir, how: picked.how,
      review: { state: review.state, changedCount: review.changedCount, removedCount: review.removedCount,
        changed: review.changed, removed: review.removed, pathsTruncated: review.pathsTruncated,
        skipped: review.skippedFiles, missing },
      detected: { type: info.type, about: info.about || '', commands: info.commands },
      read: ['docs/ai/SOURCE_INDEX.md', 'docs/ai/PROJECT_MAP.md', 'docs/ai/ARCHITECTURE.md', 'docs/ai/FEATURES.md', 'docs/ai/REFERENCES.md', 'AGENTS.md'],
      questions: action === 'review' ? cliPrepare.questions(info) : [],
      instruction: action === 'launch'
        ? 'The pack matches the last AI review. Open the terminal with askai cli --launch.'
        : 'Start with changed and missing paths; use the source index for targeted lookup. If pathsTruncated, run askai review status --all --json. Fill evidence-backed gaps. Ask one bundled question only for facts code and chat cannot establish. Then askai review done and askai cli --launch.',
    });
  } finally { console.log = log; }
}
async function cmdCli(o) {
  if (o.prepare) return cmdPrepare(o);
  if (o.launch) return launchCli();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const keys = () => { if (process.stdin.isTTY && process.stdin.setRawMode) { try { process.stdin.setRawMode(true); } catch (_) { /* a child command released the console */ } } };
  console.log('AskAI CLI. Type a command for Claude Code, Codex, Antigravity or Cursor; exit to leave.');
  rl.setPrompt('askai> '); rl.prompt();
  for await (const line of rl) {
    rl.pause();
    try {
      const args = cliArgs(line);
      if (args[0] === 'exit' || args[0] === 'quit') break;
      if (args.length && args[0] !== 'cli') {
        const previous = process.argv; process.argv = [previous[0], previous[1], ...args];
        try { await main(); } finally { process.argv = previous; }
      } else if (args[0] === 'cli') console.log('Already in AskAI CLI.');
    } catch (e) { console.error(`askai: ${e.message}`); }
    keys(); rl.resume(); rl.prompt();
  }
  rl.close(); return 0;
}
async function main() {
  const nodeLine = require('./lib/platform').nodeNotice();
  if (nodeLine && !process.env.ASKAI_QUIET) console.error(nodeLine);
  const [cmd, ...rest] = process.argv.slice(2);
  let o;
  try { o = parseArgs(rest); } catch (e) { console.error(`askai: ${e.message}`); return 2; }
  if (o.noColor) process.env.NO_COLOR = '1';
  if (o.quiet) process.env.ASKAI_QUIET = '1';
  o._.unshift(cmd);
  if (cmd === 'help' && o.help) { console.log(help.render('help')); return 0; }
  if (cmd === 'help' && o._[1] === 'all') { console.log(`askai ${VERSION}: every command in full\n\n` + help.names().map(n => help.render(n)).join(`\n\n${'-'.repeat(72)}\n\n`)); return 0; }
  if (cmd === 'help' && !o._[1]) { console.log(help.names().slice().sort().join('\n')); console.log('\naskai help <command>    usage for one command\naskai help all          every command in full\naskai update updates AskAI itself; askai tools update upgrades installed tools.'); return 0; }
  if (cmd === 'help' && o._[1]) { const t = help.render(o._[1]); console.log(t || `No help for "${o._[1]}". Commands: ${help.names().slice().sort().join(', ')}`); return t ? 0 : 1; }
  if (o.help && cmd && help.has(cmd)) { console.log(help.render(cmd)); return 0; }
  if (!cmd || cmd === 'help' || o.help) { console.log(HELP); return cmd ? 0 : 2; }
  switch (cmd) {
    case 'cli': return cmdCli(o);
    case 'install': return cmdInstall(o);
    case 'update': { const ctx = buildCtx(o, true); hintOnce(ctx, 'update-means-askai', 'askai update now updates AskAI itself. Installed tools: askai tools update'); return cmdUpgrade(o, rest); }
    case 'tools': { if ((o._[1] || '') !== 'update') { console.error('askai tools update'); return 1; } return cmdUpdate(o); }
    case 'status': return cmdStatus(o);
    case 'doctor': return cmdDoctor(o);
    case 'report': return cmdReport(o);
    case 'profiles': return cmdProfiles(o);
    case 'suggest': return cmdSuggest(o);
    case 'project': return cmdProject(o);
    case 'set': return cmdSet(o);
    case 'shell': return cmdShell(o);
    case 'uninstall': return cmdUninstall(o);
    case 'restore': return cmdRestore(o);
    case 'statusline': return cmdStatusline(o);
    case 'session': return cmdSession(o);
    case 'init': {
      const dir = projectDir(o, o.path || o._[1]); const name = registrationName(o, dir); const ctx = buildCtx(o, true); const oo = await project.ask(dir, o); const references = await project.research(dir, { offline: o.offline, dry: o.dry });
      project.init(dir, { ...oo, dry: o.dry, references }, ctx);
      if (!o.dry) {
        let chosen = o.profile;
        if (!chosen) { try { chosen = suggestLib.suggest(dir).profile; } catch (_) { chosen = null; } }
        status.rememberProjectProfile(dir, chosen);
      }
      registerProject({ ...o, name }, dir); return 0;
    }
    case 'review': { const action = o._[1] || 'status'; if (!['status', 'done'].includes(action)) throw new Error('askai review accepts status or done'); const dir = projectDir(o, o.path || o._[2]); const result = action === 'done' ? projectReview.done(dir) : projectReview.status(dir, { all: !!o.all }); console.log(o.json ? JSON.stringify(result, null, 2) : `AI review ${result.state}: ${result.scanned}/${result.eligible} source files scanned${result.skipped ? `, ${result.skipped} skipped` : ''}${action === 'status' ? `; ${result.changedCount} changed, ${result.removedCount} removed${result.pathsTruncated ? '; path list capped at 40 (use --all --json)' : ''}` : ''}`); return 0; }
    case 'map': project.map(projectDir(o, o._[1]), { dry: o.dry }); return 0;
    case 'models': return cmdModels(o);
    case 'go': return launch.run(buildCtx(o, true), o._[1], { ...o, repo: projectDir(o), ask: o._.slice(2).join(' ') });
    case 'prompt': return cmdPrompt(o);
    case 'mcp': return cmdMcp(o);
    case 'audit': return audit.run(buildCtx(o, true), projectDir(o, o._[1]), o);
    case 'infra': { const ctx = buildCtx(o, true); const r = infra.collect(ctx, projectDir(o, o._[1])); console.log(o.json ? JSON.stringify(r, null, 2) : infra.render(r)); return 0; }
    case 'guide': { const t = guide.render(o._[1], projectDir(o)); if (!t) { console.log(`No guide for "${o._[1]}". Topics: ${guide.ORDER.join(', ')}`); return 1; } console.log(t); if (o._[1] === 'work') { try { const ctx = buildCtx(o, true); const open = todo.open(todo.items(ctx, projectDir(o))); if (open.length) console.log(`\nYour open to-dos (${open.length}): ${open.slice(0, 3).map(i => i.text).join('; ')}${open.length > 3 ? '; ...' : ''}\nAll of them: askai todo`); } catch (_) { /* no context */ } } return 0; }
    case 'docs': return cmdDocs(o);
    case 'plugins': { const ctx = buildCtx(o, true); const a = o._[1] || 'list'; if (a === 'ready') { const ready = require('./lib/plugins-ready'); const report = ready.ready(ctx, projectDir(o, o.path || o._[2])); console.log(o.json ? JSON.stringify(report, null, 2) : ready.render(report)); return 0; } if (a === 'decisions') { console.log(plugins.decisions()); return 0; }
      if (a === 'info' || a === 'use') { if (!o._[2]) { console.log(`which one? askai plugins info <id>   ids: ${require('./lib/plugins').P.map(p => p.id).join(', ')}`); return 1; } const r = plugins.info(o._[2]); console.log(`\nHow to use it\n${require('./lib/usage-guide').render(o._[2])}`); return r; }
      return a === 'install' ? plugins.install(ctx, o._[2], o) : plugins.list(ctx); }
    case 'upgrade': { const ctx = buildCtx(o, true); hintOnce(ctx, 'upgrade-alias', 'askai upgrade is now askai update'); return cmdUpgrade(o, rest); }
    case 'savings': return cmdUsage({ ...o, plugins: true });
    case 'convert': return cmdConvert(o);
    case 'clear': {
      const dir = projectDir(o);
      const hs = require('./lib/session').handoffState(dir);
      if (hs.state === 'missing' || hs.state === 'template') require('./lib/daily').writeHandoff(dir);
      const g = guide.clearGate(dir, o.tool || 'claude', o._[1] === 'compact' ? 'compact' : 'clear');
      console.log(g.text); return g.fresh ? 0 : 1;
    }
    case 'context': {
      if ((o._[1] === undefined || o._[1] === '') && o.used === undefined) {
        const ctx = buildCtx(o, true);
        const snaps = status.sessionSnapshots(ctx, 24 * 14);
        const hit = snaps.find(s => s.ctxPct != null);
        if (!hit) { console.log('No context snapshot. Give the level: askai context 62. Claude Code: /context. Codex: /status. Cursor: the context ring.'); return 0; }
        const pct = hit.ctxPct;
        const band = pct < 40 ? 'fine' : pct < 60 ? 'finish the step, then handoff' : pct < 80 ? 'handoff, then clear' : 'handoff now';
        console.log(`Context ${Math.round(pct)}%: ${band}.`);
        return 0;
      }
      const pct = o.used !== undefined && o.window ? 100 * Number(o.used) / Number(o.window) : Number(o._[1]); if (!isFinite(pct)) { console.log('Give the level: askai context 62, or askai context --used 124000 --window 200000 (read it from /context or /status). Claude Code: the AskAI status line shows it live.'); return 1; } console.log(`Context ${Math.round(pct)}%: ${guide.advice(pct)}.`); return 0; }
    case 'todo': { const ctx = buildCtx(o, true); const dir = !['done', 'undo'].includes(o._[1]) ? projectDir(o, o._[1]) : null;
      if (o._[1] === 'done' && o.all) { const ids = todo.open(todo.items(ctx, projectDir(o))).map(i => i.id); for (const id of ids) todo.mark(ctx, id, true); console.log(ids.length ? `marked done: ${ids.join(', ')}` : 'nothing open'); return 0; }
      if (o._[1] === 'done' || o._[1] === 'undo') { if (!o._[2]) { console.log('which item? askai todo done <id>'); return 1; } todo.mark(ctx, o._[2], o._[1] === 'done'); console.log(`${o._[1] === 'done' ? 'marked done' : 'reopened'}: ${o._[2]}`); return 0; }
      console.log(todo.render(todo.items(ctx, dir), o.all)); return 0; }
    case 'diff': return cmdDiff(o);
    case 'graph': return cmdGraph(o);
    case 'hook': {
      if (process.stdin.isTTY) { console.log('askai hook is retired. It used to read Claude Code hook JSON. Use askai break and askai resume.'); return 0; }
      let input = ''; try { input = fs.readFileSync(0, 'utf8'); } catch (_) { /* no stdin */ } const out = hookLib.run(buildCtx(o, true), o._[1], input); if (out) process.stdout.write(out + '\n'); return 0;
    }
    case 'why': return cmdWhy(o);
    case 'next': { console.log(require('./lib/daily').next(buildCtx(o, true), projectDir(o))); return 0; }
    case 'handoff': { const r = require('./lib/daily').writeHandoff(projectDir(o), o); console.log(r.file); if (r.extra) console.log(r.extra); return 0; }
    case 'route': { const ask = o._.slice(1).join(' '); if (!ask) { console.log('Usage: askai route "task"'); return 1; } const tier = require('./lib/models').guessTier(ask); console.log(`tier: ${tier}\nCheaper first: chore, then build, then lead. Escalate after two failed attempts.`); return 0; }
    case 'weigh': { if (!o._[1]) { console.log('Usage: askai weigh <path>'); return 1; } const r = require('./lib/daily').weigh(o._[1], Number(o.threshold) || 8000); console.log(r.text); return r.ok ? 0 : 1; }
    case 'run': { const cmd = o._.slice(1).join(' '); if (!cmd) { console.log('Usage: askai run -- <command>'); return 1; } const r = require('./lib/daily').runCmd(projectDir(o), cmd, o); console.log(r.text); return r.code ? 1 : 0; }
    case 'errors': { console.log(require('./lib/daily').errors(o._[1] || require('path').join(projectDir(o), '.ai-work', 'last.log'))); return 0; }
    case 'snapshot': { console.log(require('./lib/daily').snapshot(projectDir(o), o)); return 0; }
    case 'stop': { const r = require('./lib/daily').stop(o); console.log(r.text); return r.code; }
    case 'bootstrap': { console.log(require('./lib/daily').bootstrap(projectDir(o), o.profile)); return 0; }
    case 'check': return cmdCheck(o);
    case 'test': return cmdTest(o);
    case 'setup': return cmdSetup(o);
    case 'ask': return cmdAsk(o);
    case 'usage': return cmdUsage(o);
    case 'start': case 'break': case 'resume': return session.run(o._[0], { ...o, repo: projectDir(o) });
    case 'scaffold': return cmdScaffold(o);
    case 'chat': return cmdChat(o);
    case 'tips': return cmdTips(o);
    case 'version': case '--version': console.log(o.all ? require('./lib/platform').supportText(VERSION) : VERSION); return 0;
    default: {
      const renamed = { continue: ['resume'], etiquette: ['guide', 'all'], checkpoint: ['session', 'pause'], work: ['guide', 'work'], peak: ['tips', 'peak'], projects: ['project', 'list'] };
      if (renamed[cmd]) {
        hintOnce(buildCtx(o, true), `alias-${cmd}`, `askai ${cmd} is now askai ${renamed[cmd].join(' ')}`);
        process.argv = [process.argv[0], process.argv[1], ...renamed[cmd], ...rest];
        return main();
      }
      const guess = suggestCommand(cmd);
      console.error(guess ? `Unknown command "${cmd}". Did you mean: ${guess}?` : `Unknown command "${cmd}".`);
      return 2;
    }
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code || 0; }, e => { console.error(`askai: ${e.message}`); process.exitCode = 1; });
}
module.exports = { parseArgs, buildCtx, select, main, launchPlan, sessionTerminalPlan, cliInstallPlan, diagramOpenable, suggestCommand, VERSION };
