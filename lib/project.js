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
const source = require('./project-source');
const research = require('./project-research');
const cursor = require('./cursor');

const MAX_LINES = 333;
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'target', 'vendor', '.venv', 'venv', '__pycache__', 'Pods', 'DerivedData', '.gradle', '.idea', '.ai-work', 'graphify-out', '.dart_tool', '.turbo', '.cache']);
const EXTRA_IGNORE = new Set(['ThirdParty', 'third_party', 'external', '_out', 'Build', 'BUILD_RUN']);
const ignored = name => IGNORE.has(name) || EXTRA_IGNORE.has(name);
const LANG = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', py: 'Python', kt: 'Kotlin', kts: 'Kotlin', java: 'Java', swift: 'Swift', m: 'Objective-C', go: 'Go', rs: 'Rust', c: 'C', h: 'C/C++', cpp: 'C++', cc: 'C++', cs: 'C#', rb: 'Ruby', php: 'PHP', dart: 'Dart', vue: 'Vue', svelte: 'Svelte', css: 'CSS', scss: 'CSS', html: 'HTML', ino: 'Arduino', sql: 'SQL' };
const BEGIN = tag => `<!-- askai:begin ${tag} (askai init --refresh updates this block; write your own notes outside it) -->`;
const END = '<!-- askai:end -->';
const BLOCK = tag => new RegExp(`<!-- askai:begin ${tag}[^>]*-->[\\s\\S]*?<!-- askai:end -->`);
const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
const readJson = f => { try { return JSON.parse(read(f)); } catch (_) { return null; } };
const clean = s => String(s || '').replace(/[`|]/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
const PURPOSES = {
  src: 'Application source code', app: 'Application source code', lib: 'Shared application modules',
  public: 'Browser assets and pages', pages: 'Page and route modules', routes: 'Request handlers',
  components: 'Reusable UI components', test: 'Automated tests', tests: 'Automated tests',
  docs: 'Project documentation', scripts: 'Maintenance scripts', tools: 'Development tools',
  assets: 'Static assets', uploads: 'User-uploaded files', data: 'Application data',
  migrations: 'Database migrations', config: 'Configuration', qa: 'Quality-assurance artifacts',
};

// ---------- detection ----------
function walk(dir, cb, depth = 0, budget = { n: 0 }) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    if (budget.n >= 20000) { budget.truncated = true; return; }
    if (e.isDirectory()) {
      if (ignored(e.name) || e.name.startsWith('.')) {
        if (depth === 0 && EXTRA_IGNORE.has(e.name) && budget.excluded) budget.excluded.push({ name: e.name, files: countTree(path.join(dir, e.name)) });
        continue;
      }
      walk(path.join(dir, e.name), cb, depth + 1, budget);
    }
    else { budget.n++; cb(path.join(dir, e.name), depth); }
  }
}
function countTree(dir, left = { n: 0 }) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return left.n; }
  for (const e of ents) {
    if (left.n >= 20000) return left.n;
    if (e.isDirectory()) { if (!e.name.startsWith('.')) countTree(path.join(dir, e.name), left); }
    else left.n++;
  }
  return left.n;
}
const scanCache = new Map();
function scanSignature(dir) {
  const parts = [];
  const budget = { n: 0, truncated: false };
  walk(dir, f => {
    try {
      const st = fs.statSync(f);
      parts.push(`${path.relative(dir, f).replace(/\\/g, '/')}:${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch (_) { /* gone between the listing and the stat */ }
  }, 0, budget);
  parts.sort();
  return parts.join('\n') + (budget.truncated ? '\ntruncated' : '');
}
function detect(dir) {
  const key = path.resolve(dir);
  const sig = scanSignature(dir);
  const hit = scanCache.get(key);
  if (hit && hit.sig === sig) return hit.info;
  const info = detectLive(dir);
  scanCache.set(key, { sig, info });
  return info;
}
function detectLive(dir) {
  const has = f => fs.existsSync(path.join(dir, f));
  const pkg = readJson(path.join(dir, 'package.json')) || {};
  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const exts = {}; const top = {}; const files = [];
  const budget = { n: 0, truncated: false, excluded: [] };
  walk(dir, f => {
    const rel = path.relative(dir, f); files.push(rel);
    const ext = path.extname(f).slice(1).toLowerCase(); if (LANG[ext]) exts[LANG[ext]] = (exts[LANG[ext]] || 0) + 1;
    const first = rel.split(path.sep)[0]; if (rel.includes(path.sep)) { top[first] = top[first] || { files: 0, ext: {} }; top[first].files++; top[first].ext[ext] = (top[first].ext[ext] || 0) + 1; }
  }, 0, budget);
  const any = re => files.some(f => re.test(f.replace(/\\/g, '/')));
  let type = 'other';
  const firmware = has('west.yml') || has('prj.conf') || has('mk.sh') || any(/\.(dts|overlay)$/);
  if (firmware || has('platformio.ini') || any(/\.ino$/) || (has('CMakeLists.txt') && any(/\.(c|h)$/) && !any(/\.(tsx?|jsx?|py|kt|swift)$/))) type = 'embedded';
  else if (any(/AndroidManifest\.xml$/)) type = 'android';
  else if (any(/\.xcodeproj\//) || any(/\.xcworkspace\//) || has('Podfile') || has('Package.swift') || (has('project.yml') && any(/\.swift$/))) type = 'ios';
  else if (deps.react || deps.next || deps.vue || deps.svelte || deps['@angular/core'] || deps.astro || has('index.html') || has('public/index.html')) type = 'website';
  else if (deps.express || deps.fastify || deps['@nestjs/core'] || has('manage.py') || /fastapi|flask|django/i.test(read(path.join(dir, 'requirements.txt')) || read(path.join(dir, 'pyproject.toml')) || '')) type = 'backend';
  else if (Object.keys(exts).length === 0 && any(/\.md$/)) type = 'docs';
  const cmds = {};
  const npm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
  for (const k of ['test', 'lint', 'typecheck', 'build', 'dev', 'start']) if (scripts[k]) cmds[k] = `${npm} ${npm === 'npm' && !['test', 'start'].includes(k) ? 'run ' : ''}${k}`;
  for (const k of Object.keys(scripts)) if (k.startsWith('test:') && !cmds[k]) cmds[k] = `${npm} run ${k}`;
  if (!cmds.test && (has('pytest.ini') || /pytest/.test(read(path.join(dir, 'pyproject.toml')) || ''))) cmds.test = 'pytest -q';
  if (type === 'android' && (has('build.gradle') || has('build.gradle.kts') || has('gradlew'))) Object.assign(cmds, { test: cmds.test || './gradlew testDebugUnitTest -q', build: cmds.build || './gradlew assembleDebug -q' });
  if (type === 'ios') {
    if (!cmds.test && has('qa/scripts/static-checks.sh')) cmds.test = 'bash qa/scripts/static-checks.sh';
    else if (!cmds.test && has('qa/scripts/static-checks.js')) cmds.test = 'node qa/scripts/static-checks.js';
    else if (!cmds.test && has('qa/scripts/run-local-gates.sh')) cmds.test = 'bash qa/scripts/run-local-gates.sh';
    if (!cmds.build && has('project.yml')) cmds.build = 'xcodegen generate';
  }
  if (type === 'embedded' && has('mk.sh')) Object.assign(cmds, { build: cmds.build || './mk.sh' });
  if (has('Cargo.toml')) Object.assign(cmds, { test: cmds.test || 'cargo test -q', build: cmds.build || 'cargo build -q' });
  if (has('go.mod')) Object.assign(cmds, { test: cmds.test || 'go test ./...', build: cmds.build || 'go build ./...' });
  if (has('platformio.ini')) Object.assign(cmds, { build: cmds.build || 'pio run', test: cmds.test || 'pio test' });
  const total = Object.values(exts).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(exts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l, n]) => `${l} ${Math.round(100 * n / total)}%`);
  const ENTRY = /^(src\/)?(main|index|app|App|server|cli)\.(tsx?|jsx?|py|go|rs|kt|swift)$|^cmd\/[^/]+\/main\.go$|MainActivity\.kt$|AppDelegate\.swift$|^src\/main\.(c|cpp)$|^Main\.cpp$/;
  const relativeFilesEarly = files.map(f => f.replace(/\\/g, '/'));
  const binFiles = (pkg.bin ? (typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin)) : []).map(b => String(b).replace(/\\/g, '/'));
  const entries = [];
  for (const b of binFiles) if (relativeFilesEarly.includes(b) && !entries.includes(b)) entries.push(b);
  for (const f of relativeFilesEarly) if ((ENTRY.test(f) || ENTRY.test(path.basename(f))) && !entries.includes(f)) entries.push(f);
  entries.splice(8);
  const folders = Object.entries(top).sort((a, b) => b[1].files - a[1].files).slice(0, 20).map(([name, v]) => ({ name, files: v.files, mostly: Object.entries(v.ext).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));
  const readmeText = read(path.join(dir, 'README.md')) || '';
  const readme = readmeText.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('[')) || '';
  const layout = {};
  for (const m of readmeText.matchAll(/^([\w.-]+)\/\s{2,}(.+)$/gm)) layout[m[1]] = clean(m[2]).slice(0, 140);
  for (const m of readmeText.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]*)*)\/?`:\s*([^\n]{8,180})/g)) {
    const top = m[1].split('/')[0];
    if (!layout[top]) layout[top] = clean(m[2]).slice(0, 140);
  }
  for (const m of readmeText.matchAll(/\[([A-Za-z0-9_.-]+)\/[^\]]*\]\([^)]+\)\s*\|\s*([^|\n]{8,140})/g)) if (!layout[m[1]]) layout[m[1]] = clean(m[2]).slice(0, 140);
  for (const f of folders) f.purpose = layout[f.name] || PURPOSES[f.name.toLowerCase()] || '';
  const relativeFiles = files.map(f => f.replace(/\\/g, '/'));
  const sourceScan = source.inspect(dir, relativeFiles);
  sourceScan.truncated = budget.truncated;
  const entry = (pkg.main && relativeFiles.includes(pkg.main.replace(/\\/g, '/')) && pkg.main) || entries[0];
  const entryText = entry ? (read(path.join(dir, entry)) || '').slice(0, 100000) : '';
  const flow = [];
  if (entry) flow.push(`Start at \`${entry}\`${scripts.start ? ' (\`' + cmds.start + '\` from package.json)' : ''}.`);
  if (entry && /(?:require\(|from\s+|import\s*\()\s*['"]\.\/lib\//.test(entryText) && top.lib) flow.push(`\`${entry}\` calls modules in \`lib/\` (local imports in the entry file).`);
  if (entry && top.public && /express\.static|serveStatic|static\(['"]public|sendFile\(/.test(entryText)) flow.push(`\`${entry}\` serves files from \`public/\` (static-serving call in the entry file).`);
  const dbFile = relativeFiles.find(f => /^(lib\/db|src\/db|db|database)\.[\w]+$/.test(f));
  if (dbFile && (deps['better-sqlite3'] || deps.sqlite3 || deps.prisma || deps['@prisma/client'])) flow.push(`\`${dbFile}\` is the database boundary (${Object.keys(deps).find(d => /^(better-sqlite3|sqlite3|prisma|@prisma\/client)$/.test(d))} in package.json).`);
  const constraints = [];
  for (const m of readmeText.matchAll(/^(?:Security notes:|Invariant:|Invariants:)\s*(.+)$/gm)) constraints.push(`${clean(m[1]).slice(0, 280)} (README.md)`);
  const safety = readmeText.match(/^## (?:Safety|Security)\b[^\n]*\n([\s\S]*?)(?=\n## |$(?![\s\S]))/m);
  if (safety) for (const b of safety[1].matchAll(/^- (.+)$/gm)) if (/never|must not|do not overwrite|stops the run|only what/i.test(b[1])) constraints.push(`${clean(b[1]).slice(0, 280)} (README.md)`);
  return { name: pkg.name || path.basename(path.resolve(dir)), about: pkg.description || readme.slice(0, 200), type, languages, commands: cmds, entries, entry, folders, files: relativeFiles, source: sourceScan, flow, constraints: constraints.slice(0, 3), readmeText, fileCount: files.length, excluded: budget.excluded, capped: !!budget.truncated, graph: has(path.join('graphify-out', 'GRAPH_REPORT.md')) };
}

// ---------- file contents ----------
function agentsBlock(info, prefs) {
  const c = info.commands; const t = k => models.pick(prefs, 'claude', k);
  const cmd = Object.entries(c).map(([k, v]) => `- ${k}: \`${v}\``).join('\n') || '- (add the test, lint and build commands)';
  return [BEGIN('router'), '## Project', `${info.about || '(one or two sentences: what this project does and for whom)'} Type: ${info.type}. ${info.languages.length ? `Languages: ${info.languages.join(', ')}.` : ''}`.trim(), '',
    '## Read only what the task needs', '| Need | File |', '| --- | --- |',
    '| Folders, languages, commands, entry points | docs/ai/PROJECT_MAP.md |', '| Architecture and data flow | docs/ai/ARCHITECTURE.md |',
    '| Features and where they live | docs/ai/FEATURES.md |', '| Current task scope | docs/ai/WORK_ORDER.md |',
    '| File and symbol lookup (search first) | docs/ai/SOURCE_INDEX.md |', '| Official framework docs | docs/ai/REFERENCES.md |',
    '| Where the last session stopped | .ai-work/HANDOFF.md |', '| Model and effort per task | docs/ai/MODELS.md |',
    ...(info.graph ? ['| Code relationships (knowledge graph) | graphify-out/GRAPH_REPORT.md |'] : []), '',
    '## Commands (narrowest first; quiet flags; long output: `cmd > .ai-work/last.log 2>&1; tail -n 40 .ai-work/last.log`)', cmd, '',
    '## Working rules',
    '- Search (rg, symbol tools) before reading; read line ranges; never read dependencies, build output, lockfiles or .env files.',
    '- Run the narrowest command in Commands before the full suite.',
    '- Security constraints are in docs/ai/ARCHITECTURE.md. Keep them intact.',
    '- Empty fields in WORK_ORDER.md and HANDOFF.md are unknown. Leave them until a person or a verified session fills them.',
    '- Make the smallest change that solves the task; keep error handling, tests and security; no unrequested refactors or new dependencies.',
    '- Quote only failing lines of tool output. Reply tersely: changed files, check run and result, blockers, next step. Show code changes as a diff, never whole files.', '',
    '## Sessions',
    '- One task per session. Keep the model chosen at the start (a switch rebuilds the prompt cache); raise effort for one hard step only.',
    '- Before /clear or a break: ask the agent to write .ai-work/HANDOFF.md. After /clear: read the handoff, then only the files it names.',
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
  '- Shared project rules stay in AGENTS.md. This file imports them with `@AGENTS.md` and adds only Claude Code behavior.',
  `- Subagents (.claude/agents): architect (${t('lead').model}, ${t('lead').effort}), builder (${t('build').model}, ${t('build').effort}), runner (${t('chore').model}, ${t('chore').effort}). Delegate by name, only for bounded work.`,
  '- Start a session with `askai go claude --tier <lead|build|chore>`: it sets the model and effort once.',
  '- Plan mode (Shift+Tab) for changes touching more than two files. Before /clear: write .ai-work/HANDOFF.md.', END].join('\n'); };
const geminiBlock = () => [BEGIN('antigravity'), '## Antigravity',
  '- Shared project rules stay in AGENTS.md. Gemini CLI loads this file; keep it to Antigravity behavior. To load AGENTS.md as well, add it to `context.fileName` in `.gemini/settings.json`.',
  '- Agents (.agents/agents): architect, builder, runner on the flash tier. Set `/effort high` at the start of the session and keep the model.',
  '- Before /clear: write .ai-work/HANDOFF.md.', END].join('\n');
const UNKNOWN_PURPOSE = 'not stated in README or a known folder name';
function mapFile(info, old) {
  const purposes = {};
  for (const m of String(old || '').matchAll(/^\| `?([^|`]+?)\/?`? \| \d+ \| [^|]* \| ([^|]*) \|$/gm)) {
    const v = m[2].trim();
    if (v && !v.includes('not stated in README')) purposes[m[1].trim()] = v;
  }
  const L = ['<!-- askai:generated by `askai map`; purposes come from README or folder conventions; your edits are kept. -->', `# Project map: ${info.name}`, '',
    `Type: ${info.type} · Files: ${info.fileCount} (dependencies and build output excluded)${info.languages.length ? ` · ${info.languages.join(', ')}` : ''}${info.capped ? ' (capped at 20,000)' : ''}`,
    ...(info.excluded && info.excluded.length ? [`excluded: ${info.excluded.map(e => `${e.name} ${e.files.toLocaleString('en-US')}`).join(', ')}`] : []), '',
    `Source inventory: ${info.source.scanned}/${info.source.eligible} eligible files scanned. Search docs/ai/SOURCE_INDEX.md for a path or symbol; do not load the whole index.`, '',
    '## Commands', ...(Object.entries(info.commands).map(([k, v]) => `- ${k}: \`${v}\``)), ...(Object.keys(info.commands).length ? [] : ['- (none detected)']), '',
    '## Folders', 'A purpose is kept once you write one. The placeholder below is not a purpose.', '',
    '| Folder | Files | Mostly | Purpose |', '| --- | --- | --- | --- |',
    ...info.folders.map(f => `| \`${f.name}/\` | ${f.files} | ${f.mostly ? '.' + f.mostly : ''} | ${purposes[f.name] || f.purpose || UNKNOWN_PURPOSE} |`), '',
    '## Entry points', ...(info.entries.length ? info.entries.map(e => `- \`${e}\``) : ['- (none detected)']),
    ...(info.graph ? ['', '## Knowledge graph', '- use `graphify query "<question>"`, read only the matching section. Do not read graphify-out/GRAPH_REPORT.md whole.'] : [])];
  return L.join('\n') + '\n';
}
function archFile(info) {
  const source = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'kt', 'java', 'swift', 'php', 'dart', 'vue', 'svelte', 'cs', 'c', 'cpp']);
  const folders = info.folders.filter(f => source.has(f.mostly) || ['src', 'app', 'lib', 'public', 'routes', 'pages'].includes(f.name)).slice(0, 8);
  const nodes = [`  N0["${clean(info.entry || info.name)}"]`, ...folders.map((f, i) => `  N${i + 1}["${clean(f.name)}/"]`)];
  const lib = folders.findIndex(f => f.name === 'lib');
  const pub = folders.findIndex(f => f.name === 'public');
  const edges = info.source.edges;
  const seen = new Set();
  const link = (a, b) => { if (a < 0 || b < 0 || a === b) return; const k = `${a}>${b}`; if (seen.has(k)) return; seen.add(k); nodes.push(`  N${a} --> N${b}`); };
  if (lib >= 0 && info.flow.some(s => s.includes('calls modules'))) link(0, lib + 1);
  if (pub >= 0 && info.flow.some(s => s.includes('serves files'))) link(0, pub + 1);
  const at = name => { const i = folders.findIndex(f => f.name === name); return i < 0 ? -1 : i + 1; };
  for (const e of edges) link(at(e.from), at(e.to));
  return ['<!-- askai:generated by `askai init`; evidence from repository files. Review inferred structure. -->', '# Architecture', '',
    `Generated from README, manifests and ${info.source.scanned} first-party source files. Imports show static dependencies, not runtime behavior. Add a decision only after it is made.`, '',
    '```mermaid', 'flowchart LR', ...nodes, '```', '', '## Components',
    '| Component | Evidence |', '| --- | --- |',
    ...(info.entry ? [`| Entry | \`${info.entry}\` |`] : []),
    ...folders.map(f => `| \`${f.name}/\` | ${f.purpose || `purpose not stated; ${f.files === 1 ? '1 file' : f.files + ' files'}, mostly .${f.mostly || 'unknown'}`} |`), '',
    '## Cross-folder imports', ...(edges.length ? edges.map(e => `- \`${e.from}/\` → \`${e.to}/\` (import in \`${e.file}\`).`) : ['- No cross-folder local imports detected by the static scanner.']), '',
    '## Data flow', ...(info.flow.length ? info.flow.map(s => `- ${s}`) : ['- No flow verified automatically; inspect the application entry point.']), '',
    '## Critical invariants (must never break)', ...(info.constraints.length ? info.constraints.map(s => `- ${s}`) : ['- No critical invariant stated explicitly in README.md; verify this section.']), '',
    '## Known problems and current focus', '- None confirmed by the scan. Add a line only after a failure is reproduced.', '',
    '## Decisions', 'Add a row after a decision is made: date, decision, why.', '', '| Date | Decision | Why |', '| --- | --- | --- |', '',
    '## Sensitive boundaries', '- Never paste API keys, tokens, private keys or confidential data here.', ''].join('\n');
}
function featuresFile(info) {
  const rows = [];
  const seen = new Set();
  const add = (title, file, state, notes) => {
    const key = title.toLowerCase();
    if (!title || seen.has(key) || rows.length >= 12) return;
    seen.add(key);
    rows.push(`| ${title} | \`${file}\` | ${state} | ${notes} |`);
  };
  const lines = [];
  const preferred = [];
  let heading = '';
  let prefer = false;
  const skip = /^(layout|deploy|stack|run locally|tests?|fonts?|security|content rules|install|license|contributing|changelog|safety|known risks|repository layout)\b/;
  const featureHeading = /\b(features|capabilities|includes)\b/;
  for (const line of info.readmeText.split(/\r?\n/)) {
    if (/^##+ /.test(line)) { heading = line.replace(/^#+\s*/, '').toLowerCase(); prefer = featureHeading.test(heading); }
    if (heading && skip.test(heading)) continue;
    const m = /^[-*] ([^\n]{20,})/.exec(line);
    if (!m) continue;
    if (prefer) preferred.push(clean(m[1]));
    else if (!heading || !featureHeading.test(heading)) lines.push(clean(m[1]));
  }
  if (preferred.length) lines.splice(0, lines.length, ...preferred);
  for (const line of lines) {
    let title = line.split(/[.;:]/)[0];
    if (title.length > 100 && title.includes('(')) title = title.split('(')[0].trim();
    if (title.split(',').length > 3 || (title.length >= 90 && title.includes(','))) title = title.split(',').slice(0, 3).join(',');
    if (title.length > 120) title = title.slice(0, 120).replace(/\s+\S*$/, '') + '…';
    const skipWord = new Set(['with', 'that', 'from', 'this', 'page', 'pages', 'admin', 'project', 'store', 'generated', 'material', 'submission', 'screen', 'view', 'data', 'file', 'files', 'source', 'sources', 'test', 'tests', 'main', 'code', 'swift', 'readme', 'using', 'into', 'your', 'their', 'only', 'when', 'have', 'been', 'will', 'each', 'also']);
    const words = (title.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !skipWord.has(w));
    const tokens = f => path.basename(f, path.extname(f)).split(/(?=[A-Z])|[^A-Za-z0-9]+/).map(s => s.toLowerCase()).filter(s => s.length >= 4);
    const code = words.map(w => info.files.find(f => /\.(kt|kts|swift|tsx?|jsx?|vue|svelte|py)$/.test(f) && tokens(f).includes(w))).find(Boolean);
    add(title, code || 'README.md', 'documented', 'README.md; verify behavior before marking complete');
  }
  for (const r of info.source.routes) add(`${r.method} ${clean(r.route)}`, r.file, 'detected', 'Route declaration; not runtime-verified');
  for (const f of info.files.filter(f => /(^|\/)(pages|routes|features)\/[^/]+\.(tsx?|jsx?|py|vue|svelte)$/.test(f) && !/\/(index|shared|common|layout|notfound)\./.test(f))) {
    add(path.basename(f).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), f, 'detected', 'Module exists; confirm it is user-visible');
  }
  return ['<!-- askai:generated by `askai init`; rows are documented or detected, not runtime verified. -->', '# Features', '',
    'At most 12 rows. “documented” is a README bullet. “detected” is a route or page module. Confirm behavior before calling either finished.', '',
    '| Feature | Entry files | State | Notes |', '| --- | --- | --- | --- |', ...rows, ''].join('\n');
}
const checksOf = info => {
  const noisy = /(^|:)(watch|update|coverage|e2e|visual|a11y|debug)(:|$)/;
  const parts = Object.entries(info.commands).filter(([k]) => k === 'test' || k === 'lint' || k === 'typecheck' || k === 'build' || (k.startsWith('test:') && !noisy.test(k))).map(([, v]) => `\`${v}\``);
  if (!parts.length) return '(no test, lint or build command detected)';
  return parts.join(', ') + (info.commands.build ? '' : ' (no build script)');
};
const workOrder = info => ['<!-- askai:work-order; replaced while the goal line is empty. A written goal is kept. -->', '# Current work order', '',
  '1. **Current goal:** (not set; source files cannot reveal the task)',
  '2. **Relevant files / area:** Search `docs/ai/SOURCE_INDEX.md` for likely files. Do not load that file whole.',
  '3. **Specs:**', '4. **Out of scope:**', '5. **Acceptance criteria:**', '   - [ ]',
  `6. **Checks to run:** ${checksOf(info)}`,
  '7. **Tier and agent:** build (`builder`)',
  '8. **Open blockers:** none recorded', ''].join('\n');
function unfilledWorkOrder(text) {
  if (!text || !text.includes('# Current work order')) return false;
  const goal = /\*\*Current goal:\*\*[ \t]*([^\n]*)/.exec(text);
  if (!goal) return false;
  const v = goal[1].trim();
  return !v || v.startsWith('(enter the task') || v.startsWith('(not set') || v.startsWith('<');
}
const IGNORE_BASE = ['node_modules/', 'dist/', 'build/', 'out/', '.next/', 'coverage/', 'target/', 'vendor/', 'Pods/', 'DerivedData/', '.gradle/', '*.min.js', '*.map', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.env', '.env.*', 'graphify-out/'];
const IGNORE_PREV = IGNORE_BASE.map(l => (l === 'graphify-out/' ? 'graphify-out/graph.json' : l));
const IGNORE_FILE = IGNORE_BASE.concat('').join('\n');
function ignoreFile(info) {
  const media = (info.folders || []).filter(f => /^(jpe?g|png|gif|webp|mp4|mov|webm)$/.test(f.mostly) && f.files >= 20).map(f => `${f.name}/`);
  return ['# Dependencies, build output, secrets, and large media folders in this repo.', '# Cursor already skips many binaries. Terminal and MCP tools can still read ignored paths.', ...IGNORE_BASE, ...media, ''].join('\n');
}
function stockIgnore(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const same = base => lines.length === base.length && base.every(l => lines.includes(l));
  return same(IGNORE_BASE) || same(IGNORE_PREV);
}

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
function cursorCommandFiles() {
  const out = {};
  for (const name of ['askai-cli', 'askai-plugins']) {
    const source = path.join(__dirname, '..', 'commands', `${name}.md`);
    out[`.cursor/commands/${name}.md`] = require('./cursor').cursorCommandText(fs.readFileSync(source, 'utf8'));
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
    if (o.missingOnly) return;
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
    if (o.missingOnly && cur !== null) continue;
    const p0 = plan.length; const next = upsertBlock(f, tag, block, fresh, plan);
    for (const p of plan.slice(p0)) p[1] = rel;
    if (next !== cur) writes[rel] = next;
  }
  const mapRel = path.join('docs', 'ai', 'PROJECT_MAP.md');
  const oldMap = read(path.join(dir, mapRel));
  want(mapRel, mapFile(info, o.refresh && oldMap !== null && state.files[mapRel] === sha(oldMap) ? null : oldMap), true);
  want(path.join('docs', 'ai', 'ARCHITECTURE.md'), archFile(info), true);
  want(path.join('docs', 'ai', 'FEATURES.md'), featuresFile(info), true);
  want(path.join('docs', 'ai', 'SOURCE_INDEX.md'), source.index(info), true);
  want(path.join('docs', 'ai', 'REFERENCES.md'), research.markdown(o.references || []), true);
  const woRel = path.join('docs', 'ai', 'WORK_ORDER.md');
  const woCur = read(path.join(dir, woRel));
  const put = (rel, text) => {
    const cur = read(path.join(dir, rel));
    if (cur === text || (o.missingOnly && cur !== null)) return;
    plan.push([cur === null ? 'create' : 'update', rel]);
    writes[rel] = text;
  };
  if (woCur === null || unfilledWorkOrder(woCur)) {
    let next = workOrder(info);
    const oldChecks = woCur && (/\*\*Checks to run:\*\*[ \t]*([^\n]*)/.exec(woCur) || [])[1];
    const noisyChecks = /(^|:)(watch|update|coverage|e2e|visual|a11y|debug)(:|$)/;
    if (oldChecks && oldChecks.trim() && !noisyChecks.test(oldChecks)) {
      next = next.replace(/\*\*Checks to run:\*\*[ \t]*[^\n]*/, `**Checks to run:** ${oldChecks.trim()}`);
    }
    put(woRel, next);
  } else plan.push(['keep', `${woRel} (goal is set)`]);
  want(path.join('docs', 'ai', 'MODELS.md'), models.markdown(prefs), true);
  for (const [rel, text] of Object.entries({ ...agentFiles(prefs), ...skillFiles(), ...cursorCommandFiles() })) want(rel, text, true);
  const ign = ignoreFile(info), ignCur = read(path.join(dir, '.cursorignore'));
  if (ignCur === null || ignCur === ign || stockIgnore(ignCur)) put('.cursorignore', ign);
  else if (ignCur.includes('graphify-out/graph.json') && !ignCur.split(/\r?\n/).some(l => l.trim() === 'graphify-out/')) {
    put('.cursorignore', ignCur.replace('graphify-out/graph.json', 'graphify-out/'));
  } else plan.push(['keep', '.cursorignore (edited)']);
  print(`askai init ${dir}${o.dry ? ' (dry-run)' : ''}\n  detected: ${info.type}; ${info.languages.join(', ') || 'no source files'}; ${Object.keys(info.commands).length} command(s); ${info.fileCount} files; source scanned ${info.source.scanned}/${info.source.eligible}; official docs ${(o.references || []).filter(r => r.status === 'checked').length} checked`);
  const changes = plan.filter(([what]) => what === 'create' || what === 'update');
  if (!changes.length) print(`  up to date (${plan.length} files)`);
  else for (const [what, rel] of changes) print(`  ${what.padEnd(12)} ${rel}`);
  if (o.dry) return { plan, info };
  for (const [rel, text] of Object.entries(writes)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); state.files[rel] = sha(text); }
  session.ensure(dir, o.dry);
  if (!o.missingOnly && cursor.scopeGraphifyRule(path.join(dir, '.cursor', 'rules', 'graphify.mdc'), o.dry)) print('  update       .cursor/rules/graphify.mdc (not always on; use graphify query for connection questions)');
  const handoff = path.join(dir, session.DIR, 'HANDOFF.md');
  const handoffNow = read(handoff);
  if (!o.missingOnly && !o.dry && handoffNow && (handoffNow.includes('<one sentence>') || handoffNow.includes('<testable criterion>'))) {
    let next = '# HANDOFF\n';
    try { next = fs.readFileSync(path.join(__dirname, '..', 'templates', 'HANDOFF.md'), 'utf8'); } catch (_) { /* keep the short fallback */ }
    if (next !== handoffNow) { fs.writeFileSync(handoff, next); print('  update       .ai-work/HANDOFF.md (empty template; a written handoff is kept)'); }
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, at: new Date().toISOString(), files: state.files }, null, 2));
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) { const n = (read(path.join(dir, rel)) || '').split(/\r?\n/).length; if (n > MAX_LINES) print(`  warning: ${rel} has ${n} lines (limit ${MAX_LINES}); move detail into docs/ai/`); }
  // One-time local indexes, no model involved: codebase-memory-mcp and Serena, when installed.
  if (!o.missingOnly && ctx && ctx.which) {
    const run = (cmd, args, label) => { try { const r = require('child_process').spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 600000 }); print(`  ${r.status === 0 ? 'indexed' : 'index failed'}  ${label}${r.status === 0 ? '' : ` (exit ${r.status}); run it yourself: ${cmd} ${args.join(' ')}`}`); } catch (e) { print(`  index skipped ${label}: ${e.message}`); } };
    if (ctx.which('codebase-memory-mcp')) run(ctx.which('codebase-memory-mcp'), ['cli', 'index_repository', JSON.stringify({ repo_path: dir })], 'codebase-memory-mcp');
    if (ctx.which('serena') && !fs.existsSync(path.join(dir, '.serena', 'cache'))) run(ctx.which('serena'), ['project', 'index'], 'Serena');
  }
  try { if (!o.missingOnly && ctx && ctx.paths) { const t = require('./todo'); const n = t.open(t.items(ctx, dir)).length; if (n) print(`\nOpen to-dos for this repository and your tools: ${n} (askai todo ${dir})`); } } catch (_) { /* best effort */ }
  print(`\nNext: review inferred project details and add the current goal to docs/ai/WORK_ORDER.md. Start work with: askai go claude --tier build "..."`);
  return { plan, info };
}
function map(dir, o = {}, print = console.log) {
  dir = path.resolve(dir || '.'); const info = detect(dir);
  const f = path.join(dir, 'docs', 'ai', 'PROJECT_MAP.md'); const text = mapFile(info, read(f));
  if (o.dry) {
    const old = read(f);
    const create = old == null ? 1 : 0;
    const change = old != null && old !== text ? 1 : 0;
    print(`would create ${create}, change ${change}; PROJECT_MAP.md ${change || create ? 'would update' : 'unchanged'}`);
    if (o.diff) print(text);
    return text;
  }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
  print(`wrote ${f} (${text.split('\n').length} lines; ${info.folders.length} folders, ${info.entries.length} entry points)`);
  return text;
}
// Interactive questions for askai init when it runs in a terminal without --yes.
async function ask(dir, o) {
  if (o.yes || o.about || !process.stdin.isTTY) return o;
  const info = detect(dir);
  if (info.about && info.type !== 'other') return o;
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
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
module.exports = { init, map, detect, ask, research: research.collect, agentFiles, skillFiles, agentsFile, MAX_LINES, IGNORE };
