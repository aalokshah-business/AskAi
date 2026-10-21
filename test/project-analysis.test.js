'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpHome, rm, write, fs, path, makeCtx } = require('./helpers');
const project = require('../lib/project');
const infra = require('../lib/infra');

test('init fills project docs from README, manifest and entry code, and refresh preserves edits', () => {
  const home = tmpHome();
  try {
    const repo = path.join(home, 'site'); fs.mkdirSync(repo);
    write(path.join(repo, 'package.json'), JSON.stringify({ name: 'site', description: 'Community site.', main: 'server.js',
      scripts: { start: 'node server.js', test: 'node --test' }, dependencies: { express: '5', 'better-sqlite3': '13' } }));
    write(path.join(repo, 'README.md'), '# Community site\n\n- Photo gallery with uploads for members.\n\n## Layout\n\n```\nlib/        domain logic and database access\npublic/     browser pages\n```\n\nSecurity notes: uploaded files are validated before storage.\n');
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
