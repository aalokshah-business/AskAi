'use strict';
// askai 5.3.1: the one command and the agent prompt sit at the top of README and both install guides; links resolve; git files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('README, INSTALL.md and docs/INSTALL.md lead with the one command and the agent prompt', () => {
  for (const f of ['README.md', 'INSTALL.md', 'docs/INSTALL.md']) {
    const t = read(f); const top = t.slice(0, t.indexOf('Or ask your agent') + 1200);
    assert.ok(top.includes('get.ps1))) -Target all -Workflow max -Project C:\\code\\myapp -Yes'), `${f}: Windows command`);
    assert.ok(top.includes('get.sh | bash -s -- --target all --profile max --project ~/code/myapp --yes'), `${f}: bash command`);
    assert.ok(top.includes('Set up AskAI for this repository') && top.includes('--project . --yes') && top.includes('-Project . -Yes'), `${f}: agent prompt`);
    assert.ok(t.indexOf('Or ask your agent') < 7000, `${f}: near the top`);
  }
});

test('every relative link in README.md and INSTALL.md points to a file in the package', () => {
  for (const f of ['README.md', 'INSTALL.md']) {
    for (const m of read(f).matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      assert.ok(fs.existsSync(path.join(ROOT, target)), `${f} links to ${target}`);
    }
  }
});

test('install.ps1 resolves -Project to a full path; git attributes keep line endings stable', () => {
  const ps = read('install.ps1');
  assert.match(ps, /Resolve-Path -LiteralPath \$Project/);
  assert.match(ps, /Project folder not found/);
  const ga = read('.gitattributes'); assert.match(ga, /\*\.ps1 text eol=crlf/); assert.match(ga, /\* text=auto eol=lf/);
  const gi = read('.gitignore'); for (const l of ['.ai-work/', 'node_modules/', 'graphify-out/']) assert.ok(gi.includes(l), l);
});

test('install.sh with options first (the one command) runs install, from the project folder, with no input', { skip: process.platform === 'win32' && 'needs bash' }, () => {
  const os = require('os'); const cp = require('child_process');
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-one-')); const repo = path.join(H, 'shop');
  try {
    for (const d of ['.codex', '.gemini/antigravity-cli', '.cursor', 'shop/src']) fs.mkdirSync(path.join(H, d), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'x');
    const r = cp.spawnSync('bash', [path.join(ROOT, 'install.sh'), '--target', 'all', '--profile', 'minimal', '--skip', 'claude', '--project', '.', '--yes',
      '--claude-home', path.join(H, '.claude'), '--codex-home', path.join(H, '.codex'), '--agy-home', path.join(H, '.gemini'), '--cursor-home', path.join(H, '.cursor')],
      { cwd: repo, encoding: 'utf8', input: '', timeout: 120000, env: { ...process.env, HOME: H } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(repo, 'AGENTS.md')) && fs.existsSync(path.join(repo, 'docs', 'ai', 'PROJECT_MAP.md')), 'the project pack was written into the current folder');
    assert.match(r.stdout, /Things only you can do/);
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});
