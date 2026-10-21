'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpHome, rm, write, fs, path, makeCtx } = require('./helpers');
const project = require('../lib/project');
const infra = require('../lib/infra');
const research = require('../lib/project-research');

test('init fills project docs from README, manifest and entry code, and refresh preserves edits', () => {
  const home = tmpHome();
  try {
    const repo = path.join(home, 'site'); fs.mkdirSync(repo);
    write(path.join(repo, 'package.json'), JSON.stringify({ name: 'site', description: 'Community site.', main: 'server.js',
      scripts: { start: 'node server.js', test: 'node --test' }, dependencies: { express: '5', 'better-sqlite3': '13' } }));
    write(path.join(repo, 'README.md'), '# Community site\n\n- Photo gallery with uploads for members.\n\n## Layout\n\n```\nlib/        domain logic and database access\npublic/     browser pages\n```\n\nSecurity notes: uploaded files are validated before storage; no <style> blocks.\n');
    write(path.join(repo, 'server.js'), "const db = require('./lib/db');\napp.use(express.static('public'));\n");
    write(path.join(repo, 'lib', 'db.js'), 'module.exports = {};\n');
    write(path.join(repo, 'public', 'pages', 'gallery.js'), 'export default function gallery() {}\n');
    write(path.join(repo, 'public', 'index.html'), '<!doctype html>\n');
    const ctx = makeCtx(home, { codexHome: path.join(home, 'codex'), agyHome: path.join(home, 'gemini'), cursorHome: path.join(home, 'cursor') });
    assert.equal(project.detect(repo).type, 'website');
    project.init(repo, { yes: true }, ctx, () => {});
    const file = n => path.join(repo, 'docs', 'ai', n);
    const map = fs.readFileSync(file('PROJECT_MAP.md'), 'utf8');
    const arch = fs.readFileSync(file('ARCHITECTURE.md'), 'utf8');
    const features = fs.readFileSync(file('FEATURES.md'), 'utf8');
    assert.match(map, /\| `lib\/` \| 1 \| \.js \| domain logic and database access \|/);
    assert.match(arch, /`server\.js` calls modules in `lib\/`/);
    assert.match(arch, /`server\.js` serves files from `public\/`/);
    assert.match(arch, /uploaded files are validated before storage/);
    assert.match(arch, /no &lt;style&gt; blocks/);
    assert.doesNotMatch(arch, /seed-media/);
    assert.match(features, /Photo gallery with uploads for members/);
    assert.match(features, /\| documented \| README\.md/);
    const report = infra.collect(ctx, repo);
    assert.equal(report.repo.analysis.features, 1);
    assert.equal(report.repo.analysis.dataFlow, 'evidenced');
    assert.equal(report.repo.analysis.invariants, 'documented');
    write(file('FEATURES.md'), features + '\nOwner note.\n');
    write(path.join(repo, 'README.md'), fs.readFileSync(path.join(repo, 'README.md'), 'utf8').replace('database access', 'data storage'));
    project.init(repo, { yes: true, refresh: true }, ctx, () => {});
    assert.match(fs.readFileSync(file('PROJECT_MAP.md'), 'utf8'), /domain logic and data storage/);
    assert.match(fs.readFileSync(file('FEATURES.md'), 'utf8'), /Owner note/);
    const editedMap = fs.readFileSync(file('PROJECT_MAP.md'), 'utf8').replace('domain logic and data storage', 'owner description');
    write(file('PROJECT_MAP.md'), editedMap);
    project.map(repo, {}, () => {});
    assert.match(fs.readFileSync(file('PROJECT_MAP.md'), 'utf8'), /owner description/);
  } finally { rm(home); }
});

test('sparse projects leave unsupported architecture and features visibly unverified', () => {
  const home = tmpHome();
  try {
    const repo = path.join(home, 'empty'); fs.mkdirSync(repo);
    project.init(repo, { yes: true }, null, () => {});
    assert.match(fs.readFileSync(path.join(repo, 'docs', 'ai', 'ARCHITECTURE.md'), 'utf8'), /No flow verified automatically/);
    assert.doesNotMatch(fs.readFileSync(path.join(repo, 'docs', 'ai', 'FEATURES.md'), 'utf8'), /\| documented \|/);
  } finally { rm(home); }
});

test('init scans every eligible source file and keeps detailed inventory out of AGENTS.md', () => {
  const home = tmpHome();
  try {
    const repo = path.join(home, 'api'); fs.mkdirSync(repo);
    write(path.join(repo, 'package.json'), JSON.stringify({ name: 'api', main: 'server.js', scripts: { test: 'node --test' } }));
    write(path.join(repo, 'server.js'), "import './src/routes/users.js';\n");
    write(path.join(repo, 'src', 'routes', 'users.js'), "import '../../lib/store.js';\nrouter.get('/users', listUsers);\nexport function listUsers() {}\n");
    write(path.join(repo, 'lib', 'store.js'), 'export function saveUser() {}\n');
    write(path.join(repo, '.env'), 'secret=do-not-read');
    write(path.join(repo, 'node_modules', 'ignored.js'), 'function NeverIndexMe() {}');
    project.init(repo, { yes: true }, null, () => {});
    const get = n => fs.readFileSync(path.join(repo, 'docs', 'ai', n), 'utf8');
    assert.match(get('SOURCE_INDEX.md'), /Scanned 3\/3 eligible/);
    assert.match(get('SOURCE_INDEX.md'), /saveUser/);
    assert.doesNotMatch(get('SOURCE_INDEX.md'), /NeverIndexMe|do-not-read/);
    assert.match(get('ARCHITECTURE.md'), /`src\/` → `lib\/` \(import in `src\/routes\/users.js`\)/);
    assert.match(get('FEATURES.md'), /GET \/users/);
    assert.match(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), /docs\/ai\/SOURCE_INDEX.md/);
    assert.doesNotMatch(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), /saveUser/);
    assert.match(get('WORK_ORDER.md'), /`npm test`/);
    assert.equal(infra.collect(makeCtx(home), repo).repo.analysis.sourceScan, '3/3');
  } finally { rm(home); }
});

test('official research uses detected public docs only and supports offline refresh', async () => {
  const home = tmpHome();
  try {
    const repo = path.join(home, 'site'); fs.mkdirSync(repo);
    write(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { react: '19', express: '5' } }));
    const called = [];
    const rows = await research.collect(repo, { fetchTitle: async url => { called.push(url); return 'React &amp; docs <script>alert(1)</script>'; } });
    assert.deepEqual(called, ['https://react.dev/learn', 'https://expressjs.com/en/starter/installing.html']);
    assert.match(research.markdown(rows), /React & docs/);
    assert.doesNotMatch(research.markdown(rows), /<script>/);
    const cached = await research.collect(repo, { offline: true, fetchTitle: async () => { throw new Error('network called'); } });
    assert.equal(cached.length, 2);
    assert.equal(cached[0].status, 'checked');
  } finally { rm(home); }
});
