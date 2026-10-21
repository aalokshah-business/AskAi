#!/usr/bin/env node
// token-setup: applies the evidence-backed token-saving setup for Claude Code, Codex, Antigravity and Cursor.
// Preview by default; --apply writes. Adds settings only when you have not set them, backs up every file it touches,
// writes rule text inside marked blocks, never overwrites a file it did not write, and --uninstall removes only what it added.
// Every setting is explained in the Token-Saving Guide (GUIDE.md). Node 18+, no dependencies.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import cp from 'node:child_process';
import crypto from 'node:crypto'; import readline from 'node:readline';

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const opts = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
if (flag('--help') || flag('-h')) {
  console.log(`token-setup ${VERSION}
  node token-setup.mjs                 preview: show every change, write nothing
  node token-setup.mjs --apply         apply the settings, rules and handoff commands
Options
  --tools claude,codex,agy,cursor      hosts to configure (default: Claude Code plus every other tool found)
  --install-clis                       also install missing CLIs (vendor installers are shown and confirmed first) and ccusage
  --claude-model ID                   default model when settings.json has none (default claude-sonnet-5-5)
  --lsp ts,py,kotlin,ruby,swift        Claude Code's official code-intelligence plugins (+ npm language servers for ts, py)
  --lean-git                           also set includeGitInstructions=false (only if you do not use Claude for commits)
  --project DIR                        add AGENTS.md, CLAUDE.md, .cursorignore and .ai-work/HANDOFF.md to a repo (repeatable)
  --uninstall                          remove only what token-setup added (unchanged keys, marked blocks, its own files)
  --yes                                do not ask before running vendor installers
  --force                              run even when AskAI is installed (it already applies these settings)
  --home DIR                           use DIR as the home folder (testing)`);
  process.exit(0);
}
const APPLY = flag('--apply') || flag('--uninstall');
const UNINSTALL = flag('--uninstall');
const YES = flag('--yes') || flag('-y');
const HOME = path.resolve(opt('--home', os.homedir()));
const WIN = process.platform === 'win32';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const KIT = path.join(HOME, '.token-kit'); const STATE_F = path.join(KIT, 'state.json'); const BACKUPS = path.join(KIT, 'backups', STAMP);
const P = {
  claude: path.join(HOME, '.claude'), codex: process.env.CODEX_HOME && !flag('--home') ? process.env.CODEX_HOME : path.join(HOME, '.codex'),
  gemini: path.join(HOME, '.gemini'), cursor: path.join(HOME, '.cursor'), agents: path.join(HOME, '.agents'),
};
const BEGIN = '<!-- token-kit:begin (managed by token-setup; --uninstall removes it) -->'; const END = '<!-- token-kit:end -->';
const MARK = 'token-kit:managed';
const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };
const which = n => { try { const r = cp.spawnSync(WIN ? 'where' : 'which', [n], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; } catch { return null; } };
let state = { version: VERSION, keys: [], files: [], blocks: [], toml: [] };
try { state = { ...state, ...JSON.parse(read(STATE_F) || '{}') }; } catch { /* fresh */ }
const log = (...m) => console.log(...m);
const plan = m => log(`  ${APPLY ? '+' : '[preview]'} ${m}`);
const backedUp = new Set();
function backup(f) {
  if (!APPLY || backedUp.has(f) || !fs.existsSync(f)) return;
  backedUp.add(f); const dest = path.join(BACKUPS, f.replace(HOME, '').replace(/[\\/:]/g, '_'));
  fs.mkdirSync(BACKUPS, { recursive: true }); fs.copyFileSync(f, dest);
}
function write(f, text) { if (!APPLY) return; backup(f); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }

// ---------- rule text (one source for every host) ----------
const RULES = [
  '## Token rules',
  '- Read code by searching first (grep/rg), then read only the needed line ranges. Read a whole file only when editing most of it; do not re-read a file you just edited.',
  '- Batch independent reads and searches into one message: one turn instead of several.',
  '- Make the smallest change that solves the task: reuse existing code and the standard library; no speculative features, abstractions or unrequested refactors; keep validation, error handling and security intact.',
  '- Answer tersely: no preamble, no restating the question, no tool-call narration. Keep code, commands, numbers and error text exact; use full sentences for warnings and destructive actions.',
  '- Run the narrowest test or build command first and read only the failing lines of its output.',
  '- Ask one round of clarifying questions when a requirement is truly ambiguous, then proceed.',
];
const CLAUDE_EXTRA = [
  '- Subagents: only for broad searches or log reading; give them a tool-call limit (15) and a reply limit (under 1,500 characters); use model haiku for search.',
  '',
  '# Compact instructions',
  'Keep the goal, acceptance test, files changed, decisions and the failing test output; drop exploration and resolved errors.',
];
const block = lines => [BEGIN, ...lines, END].join('\n');
const HANDOFF = 'Stop after the current verified step; do not start anything new. Overwrite `.ai-work/HANDOFF.md` in the repository root (create the folder; it is gitignored) in under 40 lines: goal and acceptance criteria; what is verified and what is not; branch, last commit and uncommitted files; exact test results; decisions with reasons; ordered next steps, smallest first; and the 3-5 files with line ranges to read first next session. No code, no secrets. Then reply with one line: "Handoff written to .ai-work/HANDOFF.md".\n';
const SKILL = `---\nname: handoff\ndescription: Writes a short session handoff to .ai-work/HANDOFF.md before a break, a context clear or a switch to another coding agent. Use only when the user asks for a handoff.\n---\n\n# Handoff\n\n${HANDOFF}`;
const CLAUDE_CMD = `---\ndescription: Write a short session handoff to .ai-work/HANDOFF.md before /clear, a break, or switching tools.\ndisable-model-invocation: true\n---\n\n${HANDOFF}`;
const CODE_GLOBS = '**/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.py, **/*.go, **/*.rs, **/*.java, **/*.kt, **/*.swift, **/*.cs, **/*.rb, **/*.php, **/*.c, **/*.cpp, **/*.h';
const AGY_CODE_RULE = `---\ntrigger: glob\nglobs: "${CODE_GLOBS}"\ndescription: "Token-saving rules for code files"\n---\n\n<!-- ${MARK} -->\n# Code files\n- Run the narrowest test first and read only the failing lines.\n- Search for the symbol, then read only its line range; do not re-read a file you just edited.\n`;
const CURSOR_RULE = `---\ndescription: Token-saving working rules\nalwaysApply: true\n---\n\n<!-- ${MARK} -->\n${RULES.slice(1).join('\n')}\n`;
const DENY = ['Read(./node_modules/**)', 'Read(./dist/**)', 'Read(./build/**)', 'Read(./out/**)', 'Read(./.next/**)', 'Read(./coverage/**)', 'Read(./target/**)', 'Read(./vendor/**)', 'Read(**/*.min.js)', 'Read(**/*.map)', 'Read(**/package-lock.json)', 'Read(**/yarn.lock)', 'Read(**/pnpm-lock.yaml)', 'Read(**/.env)', 'Read(**/.env.*)'];

// ---------- helpers: marked blocks, owned files, JSON keys, TOML keys ----------
const BLOCK_RE = /<!-- token-kit:begin[^>]*-->[\s\S]*?<!-- token-kit:end -->\r?\n?/;
function upsertBlock(f, lines) {
  const cur = read(f) || ''; const b = block(lines) + '\n';
  const next = BLOCK_RE.test(cur) ? cur.replace(BLOCK_RE, () => b) : (cur ? cur.replace(/\n*$/, '\n\n') : '') + b;
  if (next === cur) return; plan(`${BLOCK_RE.test(cur) ? 'update' : 'add'} rules block in ${f}`); write(f, next);
  if (!state.blocks.includes(f)) state.blocks.push(f);
}
function ownFile(f, text) {
  const cur = read(f);
  if (cur === text) return;
  const ours = state.files.find(x => x.path === f);
  if (cur != null && (!ours || ours.sha !== sha(cur))) { log(`  skip ${f}: exists and was not written by token-setup`); return; }
  plan(`write ${f}`); write(f, text);
  state.files = state.files.filter(x => x.path !== f).concat({ path: f, sha: sha(text) });
}
function editJson(f, fn) {
  const raw = read(f); let j = {};
  if (raw && raw.trim()) { try { j = JSON.parse(raw); } catch (e) { log(`  skip ${f}: not valid JSON (${e.message}); fix it first`); return; } }
  const before = JSON.stringify(j); fn(j);
  if (JSON.stringify(j) !== before) write(f, JSON.stringify(j, null, 2) + '\n');
}
function addKey(f, obj, dotted, value) {
  const parts = dotted.split('.'); let o = obj;
  for (const p of parts.slice(0, -1)) { if (o[p] === undefined) o[p] = {}; if (typeof o[p] !== 'object' || Array.isArray(o[p])) return; o = o[p]; }
  const k = parts[parts.length - 1]; if (k in o) return;
  o[k] = value; plan(`${path.basename(f)}: ${dotted} = ${JSON.stringify(value)}`); state.keys.push({ file: f, key: dotted, value });
}
function addDeny(f, obj, rules) {
  obj.permissions = obj.permissions && typeof obj.permissions === 'object' ? obj.permissions : {};
  const d = Array.isArray(obj.permissions.deny) ? obj.permissions.deny : (obj.permissions.deny = []);
  const add = rules.filter(r => !d.includes(r)); if (!add.length) return;
  d.push(...add); plan(`${path.basename(f)}: permissions.deny += ${add.length} read rules`); state.keys.push({ file: f, key: 'permissions.deny', value: add, list: true });
}
// TOML: line-level add-if-absent, so comments and order stay as they are.
const isHdr = l => /^\s*\[\[?[^\]]+\]\]?\s*(#.*)?$/.test(l); const hdrName = l => (/^\s*\[\[?\s*([^\]]+?)\s*\]\]?/.exec(l) || [])[1];
function tomlRegion(lines, table) {
  if (!table) { const i = lines.findIndex(isHdr); return [0, i < 0 ? lines.length : i]; }
  const s = lines.findIndex(l => isHdr(l) && hdrName(l) === table && !/^\s*\[\[/.test(l)); if (s < 0) return null;
  let e = lines.findIndex((l, i) => i > s && isHdr(l)); return [s + 1, e < 0 ? lines.length : e];
}
function tomlAdd(f, key, value, table) {
  const cur = read(f) || ''; const lines = cur.length ? cur.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const lit = typeof value === 'string' ? JSON.stringify(value) : String(value);
  let r = tomlRegion(lines, table); const re = new RegExp(`^\\s*${key}\\s*=`);
  if (r && lines.slice(r[0], r[1]).some(l => re.test(l))) return;
  if (r) { let at = r[1]; while (at > r[0] && !lines[at - 1].trim()) at--; lines.splice(at, 0, `${key} = ${lit}`); }
  else { if (lines.length) lines.push(''); lines.push(`[${table}]`, `${key} = ${lit}`); }
  plan(`config.toml: ${table ? `[${table}] ` : ''}${key} = ${lit}`); write(f, lines.join('\n') + '\n');
  state.toml.push({ file: f, key, value: lit, table: table || null });
}

// ---------- hosts ----------
const found = { claude: true, codex: fs.existsSync(P.codex) || !!which('codex'), agy: fs.existsSync(path.join(P.gemini, 'antigravity-cli')) || fs.existsSync(path.join(P.gemini, 'config')) || !!which('agy'), cursor: fs.existsSync(P.cursor) || !!which('cursor') || !!which('agent') };
const toolsArg = opt('--tools'); const tools = toolsArg ? toolsArg.split(',').map(s => s.trim()) : Object.keys(found).filter(k => found[k]);
for (const t of tools) if (!['claude', 'codex', 'agy', 'cursor'].includes(t)) { console.error(`unknown tool ${t}`); process.exit(1); }

async function ask(q) { if (YES) return true; if (!process.stdin.isTTY) return false; const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await new Promise(r => rl.question(`${q} [type YES] `, r)); rl.close(); return a.trim() === 'YES'; }
function run(cmd, a) { log(`  > ${cmd} ${a.join(' ')}`); if (!APPLY) return true; const r = cp.spawnSync(cmd, a, { stdio: 'inherit', shell: WIN }); return r.status === 0; }
async function vendorScript(name, url) {
  if (WIN) { log(/\.sh$/.test(url) ? `  ${name}: run in PowerShell: irm ${url.replace(/\.sh$/, '.ps1')} | iex` : `  ${name}: on Windows install it from the vendor's download page (${url.replace(/\/install$/, '/download')})`); return; }
  if (!APPLY) { plan(`download ${url}, show it, and run it after you type YES`); return; }
  const tmp = path.join(os.tmpdir(), `token-setup-${name}.sh`);
  if (!run('curl', ['-fsSL', url, '-o', tmp])) { log(`  ${name}: download failed`); return; }
  log(read(tmp).split('\n').slice(0, 30).join('\n') + '\n  ...');
  if (await ask(`Run the ${name} installer shown above?`)) run('sh', [tmp]); else log(`  ${name}: skipped`);
}

async function main() {
  log(`token-setup ${VERSION}${APPLY ? '' : ' (preview: nothing is written; add --apply)'}${UNINSTALL ? ' UNINSTALL' : ''}\nhome: ${HOME}\ntools: ${tools.join(', ')}\n`);
  for (const [v, why] of [['ANTHROPIC_API_KEY', 'Claude Code bills this key instead of your plan'], ['ANTHROPIC_BASE_URL', 'Claude Code goes through a proxy'], ['OPENAI_API_KEY', 'Codex may bill the API instead of ChatGPT']]) {
    if (process.env[v]) log(`  warning: ${v} is set: ${why}. Unset it unless you mean to pay per token.`);
  }
  if (UNINSTALL) return uninstall();
  // AskAI applies all of these settings itself; running both would load the token rules twice.
  if (!flag('--force') && (fs.existsSync(path.join(P.claude, 'askai', 'manifest.json')) || fs.existsSync(path.join(P.claude, 'askai', 'app', 'askai.js')))) {
    log('AskAI is installed on this machine, and it already applies these settings and rules for every tool.\n  Use `askai check` to verify them and `askai install` to add anything missing.\n  token-setup would only duplicate the rule blocks and handoff commands (pass --force to run it anyway).');
    return;
  }

  if (flag('--install-clis')) {
    log('[install]');
    if (tools.includes('claude') && !which('claude')) await vendorScript('claude', 'https://claude.ai/install.sh');
    if (tools.includes('codex') && !which('codex')) run('npm', ['install', '-g', '@openai/codex']);
    if (tools.includes('agy') && !which('agy')) await vendorScript('antigravity', 'https://antigravity.google/cli/install.sh');
    if (tools.includes('cursor') && !which('agent')) await vendorScript('cursor-agent', 'https://cursor.com/install');
    if (!flag('--no-ccusage') && !which('ccusage')) run('npm', ['install', '-g', 'ccusage']);
    for (const t of ['rg', 'jq', 'gh']) if (!which(t)) log(`  tip: install ${t} (${WIN ? 'winget' : 'brew or your package manager'}) so agents use CLIs instead of MCP servers`);
  }

  if (tools.includes('claude')) {
    log('\n[claude code]');
    const f = path.join(P.claude, 'settings.json'); const model = opt('--claude-model', 'claude-sonnet-5-5');
    editJson(f, s => {
      if (model !== 'keep') addKey(f, s, 'model', model);
      if (s.model === 'haiku') { s.model = 'claude-sonnet-5-5'; plan(`${path.basename(f)}: model haiku -> claude-sonnet-5-5`); }
      if (typeof s.model === 'string' && /opus/i.test(s.model)) log(`  note: your default model is ${s.model}; Opus spends usage fastest. Consider /model sonnet for routine work (left unchanged).`);
      addKey(f, s, 'env.CLAUDE_CODE_SUBAGENT_MODEL', 'haiku'); addKey(f, s, 'effortLevel', 'high');
      if (s.effortLevel === 'medium') { s.effortLevel = 'high'; plan(`${path.basename(f)}: effortLevel medium -> high`); }
      if (s.autoCompactWindow === 150000) { delete s.autoCompactWindow; plan(`${path.basename(f)}: removed autoCompactWindow 150000`); }
      addKey(f, s, 'promptSuggestionEnabled', false); addKey(f, s, 'awaySummaryEnabled', false); addKey(f, s, 'crossSessionInbound', 'hold');
      addKey(f, s, 'env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES', '0'); addKey(f, s, 'bashOutputMaxChars', 15000);
      if (flag('--lean-git')) addKey(f, s, 'includeGitInstructions', false);
      if (which('ccusage') && s.statusLine === undefined) addKey(f, s, 'statusLine', { type: 'command', command: 'ccusage statusline' });
      addDeny(f, s, DENY);
    });
    upsertBlock(path.join(P.claude, 'CLAUDE.md'), [...RULES, ...CLAUDE_EXTRA]);
    ownFile(path.join(P.claude, 'commands', 'handoff.md'), CLAUDE_CMD);
    const LSP = { ts: ['typescript-lsp', ['typescript-language-server', 'typescript']], py: ['pyright-lsp', ['pyright']], kotlin: ['kotlin-lsp'], ruby: ['ruby-lsp'], swift: ['swift-lsp'] };
    for (const l of (opt('--lsp', '') || '').split(',').filter(Boolean)) {
      const spec = LSP[l]; if (!spec) { log(`  unknown --lsp language ${l}`); continue; }
      if (spec[1]) run('npm', ['install', '-g', ...spec[1]]); else log(`  ${l}: install its language server yourself (see the ${spec[0]} README)`);
      run('claude', ['plugin', 'install', `${spec[0]}@claude-plugins-official`]);
    }
  }
  if (tools.includes('codex')) {
    log('\n[codex]');
    const f = path.join(P.codex, 'config.toml');
    tomlAdd(f, 'model_reasoning_effort', 'medium'); tomlAdd(f, 'model_verbosity', 'low'); tomlAdd(f, 'personality', 'none');
    tomlAdd(f, 'default_subagent_reasoning_effort', 'medium', 'agents'); tomlAdd(f, 'auto_recap', false, 'tui');
    upsertBlock(path.join(P.codex, 'AGENTS.md'), RULES);
    ownFile(path.join(P.agents, 'skills', 'handoff', 'SKILL.md'), SKILL);
  }
  if (tools.includes('agy')) {
    log('\n[antigravity]');
    const f = path.join(P.gemini, 'antigravity-cli', 'settings.json');
    editJson(f, s => addKey(f, s, 'useG1Credits', false));
    upsertBlock(path.join(P.gemini, 'GEMINI.md'), RULES);
    ownFile(path.join(P.gemini, 'config', 'rules', 'token-code.md'), AGY_CODE_RULE);
    ownFile(path.join(P.gemini, 'antigravity-cli', 'skills', 'handoff', 'SKILL.md'), SKILL);
    ownFile(path.join(P.gemini, 'config', 'skills', 'handoff', 'SKILL.md'), SKILL);
  }
  if (tools.includes('cursor')) {
    log('\n[cursor]');
    ownFile(path.join(P.cursor, 'rules', 'token-rules.mdc'), CURSOR_RULE);
    ownFile(path.join(P.cursor, 'commands', 'handoff.md'), HANDOFF);
  }
  for (const dir of opts('--project')) project(path.resolve(dir));
  if (APPLY) { fs.mkdirSync(KIT, { recursive: true }); fs.writeFileSync(STATE_F, JSON.stringify(state, null, 2)); log(`\nDone. Backups: ${BACKUPS}\nOpen a new session in each tool so the settings load.`); }
  else log('\nPreview only. Re-run with --apply to make these changes.');
}

function project(dir) {
  log(`\n[project] ${dir}`);
  if (!fs.existsSync(dir)) { log('  skip: not a folder'); return; }
  const files = {
    'AGENTS.md': '# AGENTS.md (shared by Claude Code, Codex, Antigravity and Cursor; keep under 60 lines)\n\n## Stack\n- (language, framework, package manager)\n\n## Commands (pipe long output through tail -n 40)\n- Install: \n- Test one file: \n- Lint / typecheck: \n- Build: \n\n## Where things live (read only when the task needs it)\n- \n\n## Do not read\n- node_modules/, build output, lockfiles, generated files, .env*\n\n## Working rules\n- Smallest change that solves the task; run the narrowest test; read only failing lines.\n- Before a break: write .ai-work/HANDOFF.md (the /handoff command).\n',
    'CLAUDE.md': '@AGENTS.md\n\n# Claude Code notes (keep short; shared rules live in AGENTS.md)\n- Subagents for search and logs: model haiku.\n- Plan mode (Shift+Tab) for changes touching more than two files.\n',
    '.cursorignore': 'node_modules/\ndist/\nbuild/\nout/\n.next/\ncoverage/\ntarget/\nvendor/\n*.min.js\n*.map\npackage-lock.json\nyarn.lock\npnpm-lock.yaml\n.env\n.env.*\n',
    '.ai-work/HANDOFF.md': '# HANDOFF (overwrite each session, under 40 lines)\n## Goal and acceptance test\n## Verified / not verified\n## Branch, last commit, uncommitted files\n## Decisions (and why)\n## Next steps (smallest first)\n## Files to read first (with line ranges)\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    if (fs.existsSync(f)) { log(`  keep ${rel} (exists)`); continue; }
    plan(`create ${rel}`); write(f, text);
  }
  const gi = path.join(dir, '.gitignore'); const cur = read(gi) || '';
  if (!cur.split(/\r?\n/).includes('.ai-work/')) { plan('add .ai-work/ to .gitignore'); write(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}.ai-work/\n`); }
}

function uninstall() {
  for (const k of [...state.keys].reverse()) {
    editJson(k.file, s => {
      const parts = k.key.split('.'); let o = s; for (const p of parts.slice(0, -1)) { if (!o || typeof o !== 'object') return; o = o[p]; }
      if (!o || typeof o !== 'object') return; const last = parts[parts.length - 1];
      if (k.list) { if (Array.isArray(o[last])) { o[last] = o[last].filter(x => !k.value.includes(x)); if (!o[last].length) delete o[last]; } }
      else if (JSON.stringify(o[last]) === JSON.stringify(k.value)) delete o[last];
      for (let i = parts.length - 2; i >= 0; i--) { let q = s; for (const p of parts.slice(0, i)) q = q[p]; const n = parts[i]; if (q && q[n] && typeof q[n] === 'object' && !Object.keys(q[n]).length) delete q[n]; }
    });
    log(`  - ${path.basename(k.file)}: ${k.key}`);
  }
  for (const t of [...state.toml].reverse()) {
    const cur = read(t.file); if (cur == null) continue; const lines = cur.split('\n'); const r = tomlRegion(lines, t.table); if (!r) continue;
    const i = lines.findIndex((l, idx) => idx >= r[0] && idx < r[1] && l.trim() === `${t.key} = ${t.value}`);
    if (i >= 0) { lines.splice(i, 1); const r2 = tomlRegion(lines, t.table); if (t.table && r2 && !lines.slice(r2[0], r2[1]).some(l => l.trim())) lines.splice(r2[0] - 1, r2[1] - r2[0] + 1); write(t.file, lines.join('\n').replace(/\n{3,}/g, '\n\n')); log(`  - config.toml: ${t.key}`); }
  }
  for (const f of state.blocks) { const cur = read(f); if (cur && BLOCK_RE.test(cur)) { const next = cur.replace(BLOCK_RE, '').replace(/\n{3,}$/, '\n'); if (next.trim()) write(f, next); else { backup(f); fs.rmSync(f); } log(`  - rules block in ${f}`); } }
  for (const x of state.files) { const cur = read(x.path); if (cur != null && sha(cur) === x.sha) { backup(x.path); fs.rmSync(x.path); log(`  - ${x.path}`); } else if (cur != null) log(`  keep ${x.path} (edited since)`); }
  fs.rmSync(STATE_F, { force: true }); log(`\nRemoved what token-setup added. Backups: ${BACKUPS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
