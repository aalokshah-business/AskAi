'use strict';
// askai init [dir]: the project knowledge pack, so /clear can be run freely. The agent re-reads small files with pointers instead
// of the chat history. Writes, never overwriting your text:
//   AGENTS.md (router, read by Codex, Cursor and Antigravity; Claude Code through CLAUDE.md), CLAUDE.md, GEMINI.md
//   docs/ai/PROJECT_MAP.md (generated: folders, languages, commands, entry points), ARCHITECTURE.md, FEATURES.md, WORK_ORDER.md, MODELS.md
//   subagents for the three tiers in all four tools, project skills, .cursorignore, .ai-work/ (gitignored)
// askai map regenerates PROJECT_MAP.md and keeps the purposes you wrote. askai init --refresh rewrites AskAI's blocks and any
// generated file you have not edited.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const models = require('./models');
const session = require('./session');

const MAX_LINES = 333;
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'target', 'vendor', '.venv', 'venv', '__pycache__', 'Pods', 'DerivedData', '.gradle', '.idea', '.ai-work', 'graphify-out', '.dart_tool', '.turbo', '.cache']);
const LANG = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', py: 'Python', kt: 'Kotlin', kts: 'Kotlin', java: 'Java', swift: 'Swift', m: 'Objective-C', go: 'Go', rs: 'Rust', c: 'C', h: 'C/C++', cpp: 'C++', cc: 'C++', cs: 'C#', rb: 'Ruby', php: 'PHP', dart: 'Dart', vue: 'Vue', svelte: 'Svelte', css: 'CSS', scss: 'CSS', html: 'HTML', ino: 'Arduino', sql: 'SQL' };
const BEGIN = tag => `<!-- askai:begin ${tag} (askai init --refresh updates this block; write your own notes outside it) -->`;
const END = '<!-- askai:end -->';
const BLOCK = tag => new RegExp(`<!-- askai:begin ${tag}[^>]*-->[\\s\\S]*?<!-- askai:end -->`);
const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
const readJson = f => { try { return JSON.parse(read(f)); } catch (_) { return null; } };

// ---------- detection ----------
function walk(dir, cb, depth = 0, budget = { n: 0 }) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    if (budget.n > 20000) return;
    if (e.isDirectory()) { if (!IGNORE.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), cb, depth + 1, budget); }
    else { budget.n++; cb(path.join(dir, e.name), depth); }
  }
}
function detect(dir) {
  const has = f => fs.existsSync(path.join(dir, f));
  const pkg = readJson(path.join(dir, 'package.json')) || {};
  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const exts = {}; const top = {}; const files = [];
  walk(dir, f => {
    const rel = path.relative(dir, f); files.push(rel);
    const ext = path.extname(f).slice(1).toLowerCase(); if (LANG[ext]) exts[LANG[ext]] = (exts[LANG[ext]] || 0) + 1;
    const first = rel.split(path.sep)[0]; if (rel.includes(path.sep)) { top[first] = top[first] || { files: 0, ext: {} }; top[first].files++; top[first].ext[ext] = (top[first].ext[ext] || 0) + 1; }
  });
  const any = re => files.some(f => re.test(f.replace(/\\/g, '/')));
  let type = 'other';
  if (has('platformio.ini') || any(/\.ino$/) || (has('CMakeLists.txt') && any(/\.(c|h)$/) && !any(/\.(tsx?|jsx?|py|kt|swift)$/))) type = 'embedded';
  else if (any(/AndroidManifest\.xml$/) || ((has('build.gradle') || has('build.gradle.kts') || has('settings.gradle.kts')) && any(/\.(kt|java)$/))) type = 'android';
  else if (any(/\.xcodeproj\//) || has('Podfile') || has('Package.swift')) type = 'ios';
  else if (deps.react || deps.next || deps.vue || deps.svelte || deps['@angular/core'] || deps.astro || has('index.html')) type = 'website';
  else if (deps.express || deps.fastify || deps['@nestjs/core'] || has('manage.py') || /fastapi|flask|django/i.test(read(path.join(dir, 'requirements.txt')) || read(path.join(dir, 'pyproject.toml')) || '')) type = 'backend';
  else if (Object.keys(exts).length === 0 && any(/\.md$/)) type = 'docs';
  const cmds = {};
  const npm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  for (const k of ['test', 'lint', 'typecheck', 'build', 'dev', 'start']) if (scripts[k]) cmds[k] = `${npm} ${npm === 'npm' && !['test', 'start'].includes(k) ? 'run ' : ''}${k}`;
  if (!cmds.test && (has('pytest.ini') || /pytest/.test(read(path.join(dir, 'pyproject.toml')) || ''))) cmds.test = 'pytest -q';
  if (type === 'android') Object.assign(cmds, { test: cmds.test || './gradlew testDebugUnitTest -q', build: cmds.build || './gradlew assembleDebug -q' });
  if (has('Cargo.toml')) Object.assign(cmds, { test: cmds.test || 'cargo test -q', build: cmds.build || 'cargo build -q' });
  if (has('go.mod')) Object.assign(cmds, { test: cmds.test || 'go test ./...', build: cmds.build || 'go build ./...' });
  if (has('platformio.ini')) Object.assign(cmds, { build: cmds.build || 'pio run', test: cmds.test || 'pio test' });
  const total = Object.values(exts).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(exts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `${l} ${Math.round(100 * n / total)}%`);
  const ENTRY = /^(src\/)?(main|index|app|App|server|cli)\.(tsx?|jsx?|py|go|rs|kt|swift)$|^cmd\/[^/]+\/main\.go$|MainActivity\.kt$|AppDelegate\.swift$|^src\/main\.(c|cpp)$/;
  const entries = files.map(f => f.replace(/\\/g, '/')).filter(f => ENTRY.test(f) || ENTRY.test(path.basename(f))).slice(0, 8);
  const folders = Object.entries(top).sort((a, b) => b[1].files - a[1].files).slice(0, 20).map(([name, v]) => ({ name, files: v.files, mostly: Object.entries(v.ext).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));
  const readme = (read(path.join(dir, 'README.md')) || '').split(/\r?\n/).find(l => l.trim() && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('[')) || '';
  return { name: pkg.name || path.basename(path.resolve(dir)), about: pkg.description || readme.slice(0, 200), type, languages, commands: cmds, entries, folders, fileCount: files.length, graph: has(path.join('graphify-out', 'GRAPH_REPORT.md')) };
}

// ---------- file contents ----------
function agentsBlock(info, prefs) {
  const c = info.commands; const t = k => models.pick(prefs, 'claude', k);
  const cmd = Object.entries(c).map(([k, v]) => `- ${k}: \`${v}\``).join('\n') || '- (add the test, lint and build commands)';
  return [BEGIN('router'), '## Project', `${info.about || '(one or two sentences: what this project does and for whom)'} Type: ${info.type}. ${info.languages.length ? `Languages: ${info.languages.join(', ')}.` : ''}`.trim(), '',
    '## Read only what the task needs', '| Need | File |', '| --- | --- |',
    '| Folders, languages, commands, entry points | docs/ai/PROJECT_MAP.md |', '| Architecture and data flow | docs/ai/ARCHITECTURE.md |',
    '| Features and where they live | docs/ai/FEATURES.md |', '| Current task scope | docs/ai/WORK_ORDER.md |',
    '| Where the last session stopped | .ai-work/HANDOFF.md |', '| Model and effort per task | docs/ai/MODELS.md |',
    ...(info.graph ? ['| Code relationships (knowledge graph) | graphify-out/GRAPH_REPORT.md |'] : []), '',
    '## Commands (narrowest first; quiet flags; long output: `cmd > .ai-work/last.log 2>&1; tail -n 40 .ai-work/last.log`)', cmd, '',
    '## Working rules',
    '- Search (rg, symbol tools) before reading; read line ranges; never read dependencies, build output, lockfiles or .env files.',
    '- Make the smallest change that solves the task; keep error handling, tests and security; no unrequested refactors or new dependencies.',
    '- Quote only failing lines of tool output. Reply tersely: changed files, check run and result, blockers, next step. Show code changes as a diff, never whole files.', '',
    '## Sessions',
    '- One task per session. Keep the model chosen at the start (a switch rebuilds the prompt cache); raise effort for one hard step only.',
    '- Before /clear or a break: write .ai-work/HANDOFF.md (/askai-handoff). After /clear: read the handoff, then only the files it names.',
    '- Compact only to keep working on the same large feature; otherwise hand off and clear.',
    '- When a feature or the structure changes, update one line in FEATURES.md or ARCHITECTURE.md.', '',
    '## Delegation',
    `- Tiers: lead \`architect\` (architecture, design, hard bugs, security), build \`builder\` (features and fixes within the design), chore \`runner\` (cleanup, scripts, git, test runs, search). Claude Code: ${t('lead').model}/${t('lead').effort}, ${t('build').model}/${t('build').effort}, ${t('chore').model}/${t('chore').effort}; other tools: docs/ai/MODELS.md.`,
    '- Routine work: no subagents. Give a subagent one bounded task, the files it owns, and a limit (15 tool calls, 1,500 characters).',
    '- After two failed attempts: stop, report the cause, escalate one tier. Never relax a test to make it pass; verify results yourself.', END].join('\n');
}
function agentsFile(info, prefs) {
  return `# AGENTS.md: ${info.name}\n\n${agentsBlock(info, prefs)}\n\n## Project notes\n\n(Conventions, gotchas and decisions. Keep this file under ${MAX_LINES} lines; move detail into docs/ai/.)\n`;
}
const claudeBlock = prefs => { const t = k => models.pick(prefs, 'claude', k); return [BEGIN('claude'), '## Claude Code',
  `- Subagents (.claude/agents): architect (${t('lead').model}, ${t('lead').effort}), builder (${t('build').model}, ${t('build').effort}), runner (${t('chore').model}, ${t('chore').effort}). Delegate by name, only for bounded work.`,
  '- Start a session with `askai go claude --tier <lead|build|chore>`: it sets the model and effort once.',
  '- Plan mode (Shift+Tab) for changes touching more than two files. Before /clear: /askai-handoff.', END].join('\n'); };
const geminiBlock = () => [BEGIN('antigravity'), '## Antigravity',
  '- Project rules are in AGENTS.md: read it at session start if it is not already loaded.',
  '- Agents (.agents/agents): architect, builder, runner on the flash tier. Set `/effort high` at the start of the session and keep the model.',
  '- Before /clear: /askai-handoff.', END].join('\n');
function mapFile(info, old) {
  const purposes = {};
  for (const m of String(old || '').matchAll(/^\| `?([^|`]+?)\/?`? \| \d+ \| [^|]* \| ([^|]*) \|$/gm)) if (m[2].trim()) purposes[m[1].trim()] = m[2].trim();
  const L = ['<!-- askai:generated by `askai map`; re-run after structural changes. The purposes you write are kept. -->', `# Project map: ${info.name}`, '',
    `Type: ${info.type} · Files: ${info.fileCount} (dependencies and build output excluded)${info.languages.length ? ` · ${info.languages.join(', ')}` : ''}`, '',
    '## Commands', ...(Object.entries(info.commands).map(([k, v]) => `- ${k}: \`${v}\``)), ...(Object.keys(info.commands).length ? [] : ['- (none detected)']), '',
    '## Folders', '| Folder | Files | Mostly | Purpose |', '| --- | --- | --- | --- |',
    ...info.folders.map(f => `| \`${f.name}/\` | ${f.files} | ${f.mostly ? '.' + f.mostly : ''} | ${purposes[f.name] || ''} |`), '',
    '## Entry points', ...(info.entries.length ? info.entries.map(e => `- \`${e}\``) : ['- (none detected)']),
    ...(info.graph ? ['', '## Knowledge graph', '- graphify-out/GRAPH_REPORT.md: read it before searching raw files for architecture questions; `graphify query "<question>"` for relationships.'] : [])];
  return L.join('\n') + '\n';
}
const archFile = info => ['# Architecture', '', '(Keep this short: components, how data flows, and decisions with reasons. The agent updates it with the architecture-map skill.)', '',
  '```mermaid', 'flowchart LR', ...info.folders.slice(0, 8).map((f, i) => `  N${i}["${f.name}/"]`), '```', '', '## Data flow', '- ', '', '## Critical invariants (must never break)', '- ', '', '## Known problems and current focus', '- ', '', '## Decisions', '| Date | Decision | Why |', '| --- | --- | --- |', '', '## Sensitive boundaries', '- Never paste API keys, tokens, private keys or confidential data here.', ''].join('\n');
const FEATURES = '# Features\n\nOne line per feature: where it lives and its state. Update the line when you change the feature.\n\n| Feature | Entry files | State | Notes |\n| --- | --- | --- | --- |\n';
const WORK_ORDER = '# Current work order\n\n1. **Current goal:** \n2. **Relevant files / area:** \n3. **Specs:** \n4. **Out of scope:** \n5. **Acceptance criteria:**\n   - [ ] \n6. **Checks to run:** \n7. **Tier and agent:** build (`builder`)\n8. **Open blockers:** none\n';
const IGNORE_FILE = ['node_modules/', 'dist/', 'build/', 'out/', '.next/', 'coverage/', 'target/', 'vendor/', 'Pods/', 'DerivedData/', '.gradle/', '*.min.js', '*.map', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.env', '.env.*', 'graphify-out/graph.json', ''].join('\n');

// Subagents per tool. Bodies are the same rules; frontmatter follows each tool's format.
const BODY = {
  lead: 'You are the lead for architecture and design decisions.\n- Read AGENTS.md pointers and docs/ai/ARCHITECTURE.md first; search before reading.\n- Return a plan: components touched, data flow, risks, and the smallest safe sequence of changes. Record decisions in docs/ai/ARCHITECTURE.md.\n- Under 2,000 characters unless asked for more.',
  build: 'You implement features and fixes within the existing design.\n- Change only the files named in the task; follow existing conventions; no refactors or new dependencies unless asked.\n- Run the narrowest test; report changed files, the check and its result, in under 1,500 characters.\n- If the design itself must change, stop and say so.',
  chore: 'You do small mechanical tasks: cleanup, scripts, git, test runs, search, docs edits.\n- Do exactly the task; touch only the files named.\n- Quiet flags and `tail -n 40` for long output; report only failing lines.\n- Under 1,000 characters: what you did and the results. Stop if a design decision is needed.',
};
const DESC = { lead: 'Architecture and design, ambiguous debugging, security, cross-module integration. Use for decisions, not routine edits.', build: 'Features, enhancements and bug fixes within the existing design.', chore: 'Cleanup, running scripts and tests, git operations, file search, small docs edits.' };
function agentFiles(prefs) {
  const out = {};
  for (const tier of models.TIERS) {
    const name = models.TIER_INFO[tier].agent;
    const c = models.pick(prefs, 'claude', tier), x = models.pick(prefs, 'codex', tier), u = models.pick(prefs, 'cursor', tier), g = models.pick(prefs, 'agy', tier);
    out[`.claude/agents/${name}.md`] = `---\nname: ${name}\ndescription: ${DESC[tier]}\nmodel: ${c.model}\neffort: ${c.effort}\n${tier === 'chore' ? 'tools: Bash, Read, Grep, Glob, Edit\n' : ''}---\n\n${BODY[tier]}\n`;
    out[`.codex/agents/${name}.toml`] = `name = "${name}"\ndescription = "${DESC[tier]}"\nmodel = "${x.model}"\nmodel_reasoning_effort = "${x.effort}"\nsandbox_mode = "${tier === 'lead' ? 'read-only' : 'workspace-write'}"\ndeveloper_instructions = """\n${BODY[tier]}\n"""\n`;
    out[`.cursor/agents/${name}.md`] = `---\nname: ${name}\ndescription: ${DESC[tier]} (effort: ${u.effort}; pick the matching model variant from \`agent models\`)\nmodel: ${u.model}\nreadonly: ${tier === 'lead'}\nis_background: false\n---\n\n${BODY[tier]}\n`;
    out[`.agents/agents/${name}.md`] = `---\nname: ${name}\ndescription: ${DESC[tier]}\nmodel: ${g.model}\nsubagent: true\nmainAgent: false\n---\n\n${BODY[tier]}\n(Session effort: set /effort ${g.effort} when the session starts.)\n`;
  }
  return out;
}
const SKILLS = {
  'architecture-map': ['Update docs/ai/ARCHITECTURE.md and the Purpose column of docs/ai/PROJECT_MAP.md from verified entry points and modules. Use when the user asks to map or document the architecture.', 'Read entry points and module boundaries only (search first). Write a short Mermaid diagram, a component table and decisions with reasons. No code dumps. Keep each file under 150 lines.'],
  'prompt-refiner': ['Rewrite a rough or dictated request into a structured task before starting work. Use when the request is long, vague or spoken.', 'Return: goal, files in scope, out of scope, done-when, constraints, tier (lead, build or chore) and an output limit. Never invent project details; ask one round of questions if something essential is missing.'],
  'investigate-bug': ['Find the root cause of a failure with the least reading. Use for bug reports and failing tests.', 'Reproduce with the narrowest command; search the symbols in the error; read line ranges. Return the root cause with evidence, the minimal fix plan and one command that proves it.'],
  'verify-and-review': ['Check a change against its acceptance criteria before it is reported done.', 'Run the narrow test, then the relevant wider checks. Report regressions, security risks and unresolved warnings with file and line. Do not hide failures.'],
};
function skillFiles() {
  const out = {};
  for (const [name, [desc, body]] of Object.entries(SKILLS)) {
    const text = `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n${body}\n`;
    out[`.claude/skills/${name}/SKILL.md`] = text; out[`.agents/skills/${name}/SKILL.md`] = text;
  }
  return out;
}

// ---------- writing ----------
function upsertBlock(file, tag, block, fresh, plan) {
  const cur = read(file);
  if (cur === null) { plan.push(['create', file]); return fresh; }
  if (BLOCK(tag).test(cur)) { const next = cur.replace(BLOCK(tag), () => block); if (next !== cur) plan.push(['update block', file]); return next; }
  plan.push(['add block', file]);
  return `${cur.replace(/\s*$/, '\n\n')}${block}\n`;
}
function init(dir, o = {}, ctx, print = console.log) {
  dir = path.resolve(dir || '.');
  if (!fs.existsSync(dir)) throw new Error(`no such folder: ${dir}`);
  const info = detect(dir);
  if (o.about) info.about = o.about; if (o.type) info.type = o.type;
  if (o.test) info.commands.test = o.test; if (o.build) info.commands.build = o.build;
  const prefs = ctx ? models.load(ctx) : models.load({ paths: { askaiDir: path.join(require('os').homedir(), '.claude', 'askai') } });
  const stateFile = path.join(dir, session.DIR, 'askai-init.json');
  const state = readJson(stateFile) || { files: {} };
  const plan = []; const writes = {};
  const want = (rel, text, generated) => {
    const f = path.join(dir, rel); const cur = read(f);
    if (cur === null) { plan.push(['create', rel]); writes[rel] = text; return; }
    if (cur === text) return;
    if (generated && (o.refresh || o.force) && (o.force || state.files[rel] === sha(cur))) { plan.push(['update', rel]); writes[rel] = text; return; }
    plan.push(['keep', `${rel} (${generated && o.refresh ? 'edited by you' : 'exists'})`]);
  };
  // Instruction files: whole file when new, else only AskAI's block.
  const blocks = [['AGENTS.md', 'router', agentsBlock(info, prefs), agentsFile(info, prefs)],
    ['CLAUDE.md', 'claude', claudeBlock(prefs), `@AGENTS.md\n\n${claudeBlock(prefs)}\n`],
    ['GEMINI.md', 'antigravity', geminiBlock(), `${geminiBlock()}\n`]];
  for (const [rel, tag, block, fresh] of blocks) {
    const f = path.join(dir, rel); const cur = read(f);
    if (cur !== null && !o.refresh && BLOCK(tag).test(cur)) continue;
    const p0 = plan.length; const next = upsertBlock(f, tag, block, fresh, plan);
    for (const p of plan.slice(p0)) p[1] = rel;
    if (next !== cur) writes[rel] = next;
  }
  want(path.join('docs', 'ai', 'PROJECT_MAP.md'), mapFile(info, read(path.join(dir, 'docs', 'ai', 'PROJECT_MAP.md'))), true);
  want(path.join('docs', 'ai', 'ARCHITECTURE.md'), archFile(info), false);
  want(path.join('docs', 'ai', 'FEATURES.md'), FEATURES, false);
  want(path.join('docs', 'ai', 'WORK_ORDER.md'), WORK_ORDER, false);
  want(path.join('docs', 'ai', 'MODELS.md'), models.markdown(prefs), true);
  for (const [rel, text] of Object.entries({ ...agentFiles(prefs), ...skillFiles() })) want(rel, text, true);
  want('.cursorignore', IGNORE_FILE, false);
  print(`askai init ${dir}${o.dry ? ' (dry-run)' : ''}\n  detected: ${info.type}; ${info.languages.join(', ') || 'no source files'}; ${Object.keys(info.commands).length} command(s); ${info.fileCount} files`);
  for (const [what, rel] of plan) print(`  ${what.padEnd(12)} ${rel}`);
  if (o.dry) return { plan, info };
  for (const [rel, text] of Object.entries(writes)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); state.files[rel] = sha(text); }
  session.ensure(dir, false);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, at: new Date().toISOString(), files: state.files }, null, 2));
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) { const n = (read(path.join(dir, rel)) || '').split(/\r?\n/).length; if (n > MAX_LINES) print(`  warning: ${rel} has ${n} lines (limit ${MAX_LINES}); move detail into docs/ai/`); }
  // One-time local indexes, no model involved: codebase-memory-mcp and Serena, when installed.
  if (ctx && ctx.which) {
    const run = (cmd, args, label) => { try { const r = require('child_process').spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 600000 }); print(`  ${r.status === 0 ? 'indexed' : 'index failed'}  ${label}${r.status === 0 ? '' : ` (exit ${r.status}); run it yourself: ${cmd} ${args.join(' ')}`}`); } catch (e) { print(`  index skipped ${label}: ${e.message}`); } };
    if (ctx.which('codebase-memory-mcp')) run(ctx.which('codebase-memory-mcp'), ['cli', 'index_repository', JSON.stringify({ repo_path: dir })], 'codebase-memory-mcp');
    if (ctx.which('serena') && !fs.existsSync(path.join(dir, '.serena', 'cache'))) run(ctx.which('serena'), ['project', 'index'], 'Serena');
  }
  try { if (ctx && ctx.paths) { const t = require('./todo'); const n = t.open(t.items(ctx, dir)).length; if (n) print(`\nOpen to-dos for this repository and your tools: ${n} (askai todo ${dir})`); } } catch (_) { /* best effort */ }
  print(`\nNext: fill in the Purpose column of docs/ai/PROJECT_MAP.md and the notes in AGENTS.md (or ask the agent: "use the architecture-map skill"). Start work with: askai go claude --tier build "..."`);
  return { plan, info };
}
function map(dir, o = {}, print = console.log) {
  dir = path.resolve(dir || '.'); const info = detect(dir);
  const f = path.join(dir, 'docs', 'ai', 'PROJECT_MAP.md'); const text = mapFile(info, read(f));
  if (o.dry) { print(text); return text; }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
  print(`wrote ${f} (${text.split('\n').length} lines; ${info.folders.length} folders, ${info.entries.length} entry points)`);
  return text;
}
// Interactive questions for askai init when it runs in a terminal without --yes.
async function ask(dir, o) {
  if (o.yes || o.about || !process.stdin.isTTY) return o;
  const info = detect(dir); const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const q = (t, d) => new Promise(r => rl.question(`${t}${d ? ` [${d}]` : ''}: `, a => r(a.trim() || d || '')));
  const out = { ...o };
  out.about = await q('What is this project about (one or two sentences)', info.about);
  out.type = await q('Project type (website, android, ios, embedded, backend, library, docs, other)', info.type);
  out.test = await q('Command that runs one test or the tests', info.commands.test);
  out.build = await q('Build command', info.commands.build);
  rl.close();
  for (const k of ['test', 'build']) if (!out[k]) delete out[k];
  return out;
}
module.exports = { init, map, detect, ask, agentFiles, skillFiles, agentsFile, MAX_LINES, IGNORE };
