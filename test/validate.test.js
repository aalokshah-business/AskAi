'use strict';
// scripts/validate-install.js: read-only; passes on a good install, names what is broken on a bad one, says so when nothing is installed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
function setup() {
  const H = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-val-')); const repo = path.join(H, 'shop');
  for (const d of ['.codex', '.gemini/antigravity-cli', '.cursor', 'shop/src']) fs.mkdirSync(path.join(H, d), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'x');
  const env = { ...process.env, HOME: H, USERPROFILE: H }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_BASE_URL; delete env.OPENAI_API_KEY; delete env.CODEX_HOME;
  return { H, repo, env };
}
const validate = (env, repo) => cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'validate-install.js'), ...(repo ? [repo] : [])], { encoding: 'utf8', env, timeout: 300000 });

test('validate-install: nothing installed -> one clear FAIL, exit 1', () => {
  const { H, env } = setup();
  try { const r = validate(env); assert.strictEqual(r.status, 1); assert.match(r.stdout, /FAIL\s+askai\s+AskAI is not installed/); } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

test('validate-install: a good install passes; a broken one names the file and the fix; it writes nothing', () => {
  const { H, repo, env } = setup();
  try {
    const ins = cp.spawnSync(process.execPath, [path.join(ROOT, 'askai.js'), 'install', '--yes', '--target', 'all', '--profile', 'minimal', '--skip', 'claude', '--no-path', '--project', repo], { env, encoding: 'utf8', timeout: 300000 });
    assert.strictEqual(ins.status, 0, ins.stdout + ins.stderr);
    const snapshot = () => {
      const since = fs.statSync(path.join(H, '.claude', 'askai', 'manifest.json')).mtimeMs;
      const found = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (fs.statSync(p).mtimeMs > since) found.push(p);
      } }; walk(H); return found.sort().join('\n');
    };
    const good = validate(env, repo);
    assert.strictEqual(good.status, 0, good.stdout);
    for (const s of ['PASS  askai       version', 'askai plugins ready reports', 'reminder hooks registered', '/askai-cli command present', '/askai-plugins command present', '$askai-cli skill present', '$askai-plugins skill present', 'project files present (router, docs/ai, subagents, skills)', 'AGENTS.md is', 'askai check: no failing items', 'Still to check by hand']) assert.ok(good.stdout.includes(s), s);
    assert.ok(!/^FAIL/m.test(good.stdout));
    fs.writeFileSync(path.join(H, '.gemini', 'GEMINI.md'), 'nothing here\n'); fs.rmSync(path.join(repo, '.codex', 'agents', 'runner.toml')); fs.writeFileSync(path.join(repo, '.agents', 'agents', 'builder.md'), '---\nname: builder\nmodel: gemini-3.8-flash\n---\n');
    const bad = validate(env, repo);
    assert.strictEqual(bad.status, 1);
    for (const s of ['FAIL  Antigravity AskAI rules block missing', 'fix: askai install --only agy-rules', 'project file(s) missing: .codex/agents/runner.toml', 'Antigravity agent builder has model "gemini-3.8-flash"']) assert.ok(bad.stdout.includes(s), s);
    assert.ok(!bad.stdout.includes(H), 'the home folder is shown as ~');
    const before = snapshot(); validate(env, repo); assert.strictEqual(snapshot(), before, 'validation changed no files');
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});

test('validate-install: MCP servers the manifest expects must be in each tool config; an API key in the environment fails', () => {
  const { H, repo, env } = setup();
  try {
    cp.spawnSync(process.execPath, [path.join(ROOT, 'askai.js'), 'install', '--yes', '--target', 'all', '--profile', 'minimal', '--skip', 'claude', '--no-path', '--project', repo], { env, encoding: 'utf8', timeout: 300000 });
    const mf = path.join(H, '.claude', 'askai', 'manifest.json'); const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.components.headroom = { hosts: ['claude', 'cursor', 'agy', 'codex'], command: 'headroom', args: ['mcp', 'serve'] }; fs.writeFileSync(mf, JSON.stringify(m));
    fs.writeFileSync(path.join(H, '.claude.json'), JSON.stringify({ mcpServers: { headroom: { command: 'headroom' } } }));
    fs.writeFileSync(path.join(H, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { headroom: { command: 'headroom' } } }));
    fs.mkdirSync(path.join(H, '.gemini', 'config'), { recursive: true }); fs.writeFileSync(path.join(H, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: {} }));
    fs.appendFileSync(path.join(H, '.codex', 'config.toml'), '\n[mcp_servers.headroom]\ncommand = "headroom"\nargs = ["mcp", "serve"]\n');
    const r = validate(env, repo);
    assert.match(r.stdout, /PASS\s+Claude Code\s+MCP servers in its config: headroom/); assert.match(r.stdout, /PASS\s+Codex\s+MCP servers in its config: headroom/); assert.match(r.stdout, /PASS\s+Cursor\s+MCP servers in its config: headroom/);
    assert.match(r.stdout, /FAIL\s+Antigravity MCP servers missing from its config: headroom/);
    const k = validate({ ...env, ANTHROPIC_API_KEY: 'x' }, repo); assert.match(k.stdout, /FAIL\s+billing\s+ANTHROPIC_API_KEY is set/); assert.ok(!k.stdout.includes('ANTHROPIC_API_KEY=x'));
  } finally { fs.rmSync(H, { recursive: true, force: true }); }
});
