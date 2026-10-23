'use strict';
// askai 4.1: command help, the generated architecture document, the merged standalone script, new knowledge-base entries.
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const { tmpHome, rm, cli, fs, path } = require('./helpers');
const help = require('../lib/help');
const kb = require('../lib/kb');
const ROOT = path.join(__dirname, '..');

test('help: every command has detailed help, reachable as askai help <cmd> and askai <cmd> --help', () => {
  for (const n of help.names()) assert.match(help.render(n), new RegExp(`^askai ${n}: .+\\n\\nUsage: askai ${n}`), n);
  const r = cli(['help', 'check']); assert.strictEqual(r.code, 0); assert.match(r.out, /Usage: askai check/);
  assert.match(cli(['help', 'check', '--advanced']).out, /Usage: askai check \[dir\]/);
  assert.match(cli(['resume', '--help']).out, /--copy/);
  assert.strictEqual(cli(['help', 'nope']).code, 1);
  for (const cmd of ['install', 'check', 'ask', 'break', 'resume', 'savings', 'session', 'scaffold', 'uninstall']) assert.ok(help.has(cmd), cmd);
});

test('docs/ARCHITECTURE.md is generated from the code and up to date', () => {
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-docs.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const t = fs.readFileSync(path.join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8');
  for (const s of ['## 6. Components', '`agy-baseline`', '`effortLevel`', '#### `askai check`', 'Headroom', 'Caveman', '/doctor', 'SuperClaude']) assert.ok(t.includes(s), s);
});

test('standalone script: preview writes nothing; apply, re-apply and uninstall round-trip in a sandbox', () => {
  const h = tmpHome();
  try {
    fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{"model":"sonnet"}');
    const run = (...a) => cp.spawnSync(process.execPath, [path.join(ROOT, 'standalone', 'token-setup.mjs'), '--home', h, '--tools', 'claude,codex,agy,cursor', ...a], { encoding: 'utf8' });
    assert.strictEqual(run().status, 0);
    assert.strictEqual(fs.readdirSync(path.join(h, '.claude')).length, 1, 'preview wrote nothing');
    assert.strictEqual(run('--apply').status, 0);
    const s = JSON.parse(fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8'));
    assert.strictEqual(s.model, 'sonnet', 'existing model kept'); assert.strictEqual(s.effortLevel, 'medium');
    assert.ok(!/\+ /.test(run('--apply').stdout), 're-apply changes nothing');
    assert.strictEqual(run('--uninstall').status, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8')), { model: 'sonnet' });
  } finally { rm(h); }
});

test('ask: the newer tools from the research are answered', () => {
  assert.strictEqual(kb.search('superclaude')[0].id, 'superclaude');
  assert.strictEqual(kb.search('claude-doctor audit')[0].id, 'doctor-tools');
  assert.strictEqual(kb.search('ccstatusline')[0].id, 'statusline');
  assert.strictEqual(kb.search('tokenlens budget')[0].id, 'budget');
});
