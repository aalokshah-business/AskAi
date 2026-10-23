'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cli, tmpHome, rm, write, fs, path } = require('./helpers');

const lines = text => text.trim().split(/\r?\n/).filter(Boolean);

test('project refresh creates missing files, keeps an existing file, and stays within 8 lines', () => {
  const home = tmpHome();
  const dir = path.join(home, 'app');
  fs.mkdirSync(dir);
  write(path.join(dir, 'README.md'), '# App\n');
  write(path.join(dir, 'src.js'), 'module.exports = 1;\n');
  write(path.join(dir, 'AGENTS.md'), 'KEEP ME\n');
  try {
    const r = cli(['project', 'refresh', dir, '--claude-home', home, '--yes']);
    assert.strictEqual(r.code, 0, r.err + r.out);
    assert.ok(lines(r.out).length <= 8, r.out);
    assert.match(r.out, /init: \d+ created/);
    assert.match(r.out, /map: docs\/ai\/PROJECT_MAP.md/);
    assert.match(r.out, /review: /);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'KEEP ME\n');
    assert.ok(fs.existsSync(path.join(dir, 'docs', 'ai', 'PROJECT_MAP.md')));
    const again = cli(['project', 'refresh', dir, '--claude-home', home, '--yes']);
    assert.strictEqual(again.code, 0, again.err + again.out);
    assert.match(again.out, /init: up to date/);
    assert.ok(lines(again.out).length <= 8, again.out);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'KEEP ME\n');
  } finally { rm(home); }
});
