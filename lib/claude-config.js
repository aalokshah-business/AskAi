'use strict';
// Safe edits of ~/.claude/settings.json and ~/.claude/CLAUDE.md: read fresh before every write, back up once per run,
// UTF-8 without BOM, atomic replace. Nothing here runs a hook of its own; askai only registers what other tools ship.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BEGIN = '<!-- askai:begin (managed by askai; `askai uninstall` removes this block, edits inside are overwritten) -->';
const END = '<!-- askai:end -->';

// Same values the previous askai installer used; only ever ADDED when absent, never overriding the user's choice.
const BASELINE = {
  autoCompactWindow: 150000,
  effortLevel: 'medium',
  env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' },
  skillOverrides: Object.fromEntries([
    'keybindings-help', 'artifact-design', 'artifact-diagramming', 'artifact-capabilities', 'claude-api', 'dataviz',
    'workflow-authoring', 'loop', 'schedule', 'fewer-permission-prompts', 'init', 'security-review', 'simplify', 'run',
    'update-config', 'code-review', 'caveman-commit', 'caveman-compress', 'caveman-review', 'caveman-stats',
  ].map(n => [n, 'name-only'])),
};

const CAVEMAN_LEAD = {
  lite: 'Reply terse -- no filler (just/really/basically), pleasantries or hedging; keep full sentences and articles.',
  full: 'Reply terse -- drop articles, filler (just/really/basically), pleasantries and hedging; fragments OK; short synonyms; no tool-call narration, decorative tables or emoji.',
  ultra: 'Reply maximally terse -- fragments; drop articles, filler, pleasantries, hedging and connectors when meaning stays clear; well-known abbreviations only (DB, API, HTTP); no tool-call narration, decorative tables or emoji.',
};
const CAVEMAN_KEEP = 'Keep technical terms, numbers, units, code blocks, commands and quoted errors exact; never drop not/no/never/only/except. Commit messages, PR text, code comments and file contents stay in normal style. Use full clear sentences for security warnings, destructive/irreversible-action confirmations and AskUserQuestion option text. Compression is style only -- never omit needed information, and never make output longer to sound like a caveman. User says "stop caveman" or "normal mode" to end it.';

// One line per rule. The two tool-specific lines are only written when that tool is present (see buildRules), so a machine
// without Serena or Context Mode does not carry instructions about tools the model cannot call.
const RULE_LINES = {
  output: '- Show code changes as a diff or only the changed lines, never whole files or unchanged code; do not repeat what the diff shows; no recap of work the user can see. Explain only when asked or when something failed.',
  agents: '- Agent prompts state a tool-call limit (default 15; stop and report if reached) and a reply-size limit (default under 1500 characters, paths and line numbers first). Search/locate work: Explore agent with model "haiku". Follow-ups on the same area: SendMessage to the running agent instead of a new one.',
  reading: '- Reading code: Grep for the line, then Read with offset/limit. Read a whole file only when editing most of it. Do not re-Read a file just edited. Batch independent Reads/Greps into one message: one turn instead of several.',
  lean: '- Build the smallest change that solves the task: reuse existing code and the standard library; no speculative features, abstractions or unrequested refactors; keep validation, error handling and security intact.',
  'context-mode': '- When the context-mode ctx_* tools are available, use ctx_batch_execute / ctx_execute / ctx_search for commands or files with large output instead of dumping raw output into context.',
  serena: '- When Serena tools are available, prefer find_symbol, get_symbols_overview and find_referencing_symbols over reading whole source files to navigate code.',
};

// present: ids of the tools found on the machine (a subset of 'context-mode', 'serena'); undefined means "all of them".
// host: 'claude' (default) or 'cursor'. The subagent line names Claude Code's Agent, Explore and SendMessage tools, which Cursor does not have.
function buildRules(present, host) {
  const has = id => !present || present.includes(id);
  const lines = host === 'cursor' ? [RULE_LINES.reading, RULE_LINES.lean, RULE_LINES.output] : [RULE_LINES.agents, RULE_LINES.reading, RULE_LINES.lean, RULE_LINES.output];
  return ['## Token rules (askai)', ...lines, ...['context-mode', 'serena'].filter(has).map(id => RULE_LINES[id])].join('\n');
}
const RULES = buildRules();

function claudePaths(home, sandbox) {
  const userJson = sandbox ? path.join(home, '.claude.json') : path.join(path.dirname(home), '.claude.json');
  const askaiDir = path.join(home, 'askai');
  return {
    home,
    settings: path.join(home, 'settings.json'),
    claudeMd: path.join(home, 'CLAUDE.md'),
    userJson,
    askaiDir,
    app: path.join(askaiDir, 'app'),
    bin: path.join(askaiDir, 'bin'),
    cache: path.join(askaiDir, 'cache'),
    manifest: path.join(askaiDir, 'manifest.json'),
    backups: path.join(askaiDir, 'backups'),
    sessions: path.join(askaiDir, 'sessions'),
    rules: path.join(home, 'rules'),
  };
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
// Missing file -> {}. Unparseable file -> throw: never overwrite a settings file we could not read.
function readJson(p) {
  const t = readText(p);
  if (t === null || !t.trim()) return {};
  try { return JSON.parse(t); } catch (e) { throw new Error(`cannot parse ${p} (${e.message}); fix or move it, askai will not overwrite it`); }
}
function writeAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.askai-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, p);
}
function writeJson(p, obj) { writeAtomic(p, JSON.stringify(obj, null, 2) + '\n'); }

// Backups: first call per file per run copies it to backups/<stamp>/; later calls are no-ops.
function makeBackup(paths, stamp) {
  const done = new Set();
  return function backup(file) {
    if (done.has(file) || !fs.existsSync(file)) return null;
    done.add(file);
    const dest = path.join(paths.backups, stamp, path.basename(file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    return dest;
  };
}

// ---- settings.json ----------------------------------------------------------------------------------------------
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// The main-conversation model askai sets when settings.json has none. Claude Code v2.1.280 (22 Sep 2026) made Opus the default on
// every subscription plan. AskAI's default is Haiku (cheapest first; escalate per task with /model sonnet or opus),
// and `--main-model sonnet` or `keep` changes that. An existing value is never touched.
const DEFAULT_MAIN_MODEL = 'haiku';
const MODEL_ALIASES = ['haiku', 'sonnet', 'opus', 'keep'];

// BASELINE plus the two model choices a run can make (--main-model, --subagent-model). Never mutates BASELINE.
function baselineFor(opts = {}) {
  const b = { ...BASELINE, env: { ...BASELINE.env } };
  if (opts.subagentModel) b.env.CLAUDE_CODE_SUBAGENT_MODEL = opts.subagentModel;
  const m = opts.mainModel === undefined ? DEFAULT_MAIN_MODEL : opts.mainModel;
  if (m && m !== 'keep') b.model = m;
  return b;
}

// Add-if-absent. Returns [{key, value}] of what was added, dotted keys for nested ones.
function applyBaseline(settings, opts) {
  const added = [];
  for (const [k, v] of Object.entries(baselineFor(opts))) {
    if (isObj(v)) {
      if (!isObj(settings[k])) { if (k in settings) continue; settings[k] = {}; }
      for (const [k2, v2] of Object.entries(v)) {
        if (!(k2 in settings[k])) { settings[k][k2] = v2; added.push({ key: `${k}.${k2}`, value: v2 }); }
      }
    } else if (!(k in settings)) { settings[k] = v; added.push({ key: k, value: v }); }
  }
  return added;
}

function removeKey(settings, dotted, onlyIfEqual) {
  const [a, b] = dotted.split('.');
  if (b === undefined) {
    if (a in settings && (onlyIfEqual === undefined || JSON.stringify(settings[a]) === JSON.stringify(onlyIfEqual))) { delete settings[a]; return true; }
    return false;
  }
  const parent = settings[a];
  if (isObj(parent) && b in parent && (onlyIfEqual === undefined || JSON.stringify(parent[b]) === JSON.stringify(onlyIfEqual))) {
    delete parent[b];
    if (!Object.keys(parent).length) delete settings[a];
    return true;
  }
  return false;
}

// Remove every hook entry whose command matches re (empty groups and events are dropped). Returns how many were removed.
function removeHooks(settings, re) {
  if (!isObj(settings.hooks)) return 0;
  let removed = 0;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const kept = [];
    for (const g of groups) {
      const hs = Array.isArray(g.hooks) ? g.hooks : [];
      const rest = hs.filter(h => !(h && typeof h.command === 'string' && re.test(h.command)));
      if (rest.length === hs.length) { kept.push(g); continue; }
      removed += hs.length - rest.length;
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}
// Registrations of the retired self-built askai hook (commands that run askai.ps1 / askai-hook.ps1).
const removeLegacyHooks = settings => removeHooks(settings, /askai(-hook)?\.ps1/i);

// Every hook command registered in settings.json: [{event, matcher, command}]
function listHooks(settings) {
  const out = [];
  if (!isObj(settings.hooks)) return out;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of Array.isArray(g.hooks) ? g.hooks : []) {
        if (h && typeof h.command === 'string') out.push({ event, matcher: g.matcher || '', command: h.command });
      }
    }
  }
  return out;
}

// statusLine is a single slot: set ours only when free (or already ours). Returns 'set' | 'updated' | 'unchanged' | 'kept-other'.
const OURS = /askai[\\/]app[\\/]askai\.js|askai\.js["']? statusline/i;
function setStatusLine(settings, command) {
  const cur = settings.statusLine;
  if (cur === undefined) { settings.statusLine = { type: 'command', command }; return 'set'; }
  if (isObj(cur) && typeof cur.command === 'string' && OURS.test(cur.command)) {
    if (cur.command === command) return 'unchanged';
    settings.statusLine = { ...cur, command };
    return 'updated';
  }
  return 'kept-other';
}

// ---- CLAUDE.md managed block -------------------------------------------------------------------------------------
const TERSE_HEADING = /^#\s*Terse output \(caveman/mi;
const BLOCK_RE = /<!-- askai:begin[^>]*-->[\s\S]*?<!-- askai:end -->\r?\n?/;

function eolOf(text) { return /\r\n/.test(text) ? '\r\n' : '\n'; }
function outsideBlock(text) { return text.replace(BLOCK_RE, ''); }
function hasTerseOutside(text) { return TERSE_HEADING.test(outsideBlock(text)); }

// caveman: 'off' | 'lite' | 'full' | 'ultra'. The terse directive is left out when the file already has one outside our block.
function buildBlockBody(existingText, caveman, present) {
  const parts = [buildRules(present)];
  if (caveman !== 'off' && !hasTerseOutside(existingText || '')) parts.push(terseSection(caveman));
  return parts.join('\n\n');
}
function terseSection(caveman) { return `## Terse output (caveman, ${caveman})\n${CAVEMAN_LEAD[caveman]} ${CAVEMAN_KEEP}`; }

function upsertBlock(text, body) {
  const nl = eolOf(text);
  const block = [BEGIN, ...body.split('\n'), END].join(nl) + nl;
  if (BLOCK_RE.test(text)) {
    const next = text.replace(BLOCK_RE, () => block);
    return { text: next, changed: next !== text };
  }
  const sep = !text ? '' : text.endsWith('\n') ? nl : nl + nl;
  return { text: text + sep + block, changed: true };
}
function removeBlock(text) {
  const m = BLOCK_RE.exec(text);
  if (!m) return { text, changed: false };
  let next = text.replace(BLOCK_RE, '');
  // Block was last in the file: drop the blank separator line upsertBlock put before it.
  if (m.index + m[0].length >= text.length) next = next.trim() ? next.replace(/(\r?\n)+$/, eolOf(text)) : '';
  return { text: next, changed: true };
}
function blockBodyOf(text) {
  const m = text.match(BLOCK_RE);
  return m ? m[0].split(/\r?\n/).filter(l => !l.startsWith('<!-- askai:')).join('\n') : '';
}

// ---- ~/.bashrc askai alias ---------------------------------------------------------------------------------------
// Git Bash skips PATHEXT resolution, so bare `askai` doesn't resolve to askai.cmd there. Windows only.
const BASHRC_BEGIN = '# >>> askai (added by `askai install`; `askai uninstall` removes this) >>>';
const BASHRC_END = '# <<< askai <<<';
const BASHRC_BLOCK_RE = /# >>> askai \(added by `askai install`;[^\n]*>>>\n[\s\S]*?# <<< askai <<<\r?\n?/;
const BASHRC_ALIAS_LINE = "alias askai='askai.cmd'";

function editBashrcAlias(add) {
  const file = path.join(os.homedir(), '.bashrc');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!add) {
    if (!BASHRC_BLOCK_RE.test(text)) return 'unchanged';
    let next = text.replace(BASHRC_BLOCK_RE, '');
    next = next.trim() ? next.replace(/(\r?\n)+$/, eolOf(text)) : '';
    writeAtomic(file, next);
    return 'changed';
  }
  const nl = eolOf(text);
  const block = [BASHRC_BEGIN, BASHRC_ALIAS_LINE, BASHRC_END].join(nl) + nl;
  if (BASHRC_BLOCK_RE.test(text)) {
    const next = text.replace(BASHRC_BLOCK_RE, () => block);
    if (next === text) return 'unchanged';
    writeAtomic(file, next);
    return 'changed';
  }
  const sep = !text ? '' : text.endsWith('\n') ? nl : nl + nl;
  writeAtomic(file, text + sep + block);
  return 'changed';
}

// ---- manifest ---------------------------------------------------------------------------------------------------
function loadManifest(paths) {
  const m = readJson(paths.manifest);
  return { version: 1, runs: [], settings: [], components: {}, ...m };
}
function saveManifest(paths, m) { writeJson(paths.manifest, m); }

module.exports = {
  BEGIN, END, BASELINE, DEFAULT_MAIN_MODEL, MODEL_ALIASES, baselineFor, RULES, buildRules, claudePaths, readText, readJson, writeAtomic, writeJson, makeBackup, applyBaseline, removeKey,
  removeHooks, removeLegacyHooks, listHooks, setStatusLine, hasTerseOutside, buildBlockBody, terseSection, upsertBlock, removeBlock, blockBodyOf,
  loadManifest, saveManifest, editBashrcAlias, defaultClaudeHome: () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
};
