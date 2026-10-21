'use strict';
// 1.0.0: licence, code owner, branch ruleset, read-only workflow token, and the one-time GitHub setup script.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('MIT licence, code owner, ruleset that keeps main safe, read-only workflow token', () => {
  assert.match(read('LICENSE'), /^MIT License/); assert.strictEqual(JSON.parse(read('package.json')).license, 'MIT');
  assert.match(read('.github/CODEOWNERS'), /^\* @aalokshah-business$/m);
  const rs = JSON.parse(read('.github/rulesets/protect-main.json'));
  const types = rs.rules.map(r => r.type); for (const t of ['deletion', 'non_fast_forward', 'pull_request']) assert.ok(types.includes(t), t);
  assert.deepStrictEqual(rs.conditions.ref_name.include, ['~DEFAULT_BRANCH']); assert.strictEqual(rs.enforcement, 'active');
  assert.ok(rs.rules.find(r => r.type === 'pull_request').parameters.require_code_owner_review);
  assert.match(read('.github/workflows/test.yml'), /permissions:\n  contents: read/);
  for (const f of ['.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/idea.md', '.github/pull_request_template.md']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('setup-github.js: dry run lists every setting; with gh it applies them and checks collaborators', { skip: process.platform === 'win32' && 'uses a fake gh shell script' }, () => {
  const dry = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-github.js'), '--dry-run'], { encoding: 'utf8' });
  assert.strictEqual(dry.status, 0, dry.stdout + dry.stderr);
  for (const s of ['--visibility public', '--default-branch main', 'actions/permissions', 'default_workflow_permissions=read', 'private-vulnerability-reporting', 'rulesets', 'release create v1.0.1']) assert.ok(dry.stdout.includes(s), s);
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-gh-'));
  try {
    const log = path.join(H, 'calls.log');
    fs.writeFileSync(path.join(H, 'gh'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in\n  "release view"*) exit 1 ;;\n  "api repos/aalokshah-business/AskAi/rulesets") echo "[]" ;;\n  "api repos/aalokshah-business/AskAi/collaborators"*) echo "aalokshah-business" ;;\nesac\nexit 0\n`); fs.chmodSync(path.join(H, 'gh'), 0o755);
    const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup-github.js')], { encoding: 'utf8', env: { ...process.env, PATH: `${H}:${process.env.PATH}` } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    for (const s of ['auth status', 'repo edit aalokshah-business/AskAi --visibility public', '-X POST repos/aalokshah-business/AskAi/rulesets --input', 'release create v1.0.1']) assert.ok(calls.includes(s), s);
    assert.match(r.stdout, /nobody but you can push/);
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});
