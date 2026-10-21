'use strict';
// Command entry points and project lifecycle in isolated homes. No external tools are installed or launched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const help = require('../lib/help');

const ASKAI = path.join(__dirname, '..', 'askai.js');
const SOURCE = fs.readFileSync(ASKAI, 'utf8');
const FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorignore',
  'docs/ai/PROJECT_MAP.md', 'docs/ai/SOURCE_INDEX.md', 'docs/ai/ARCHITECTURE.md', 'docs/ai/FEATURES.md', 'docs/ai/REFERENCES.md',
  'docs/ai/WORK_ORDER.md', 'docs/ai/MODELS.md', '.ai-work/HANDOFF.md'];

function fixture(fn) {
  const base = process.env.ASKAI_TEST_TMP || os.tmpdir();
  const root = fs.mkdtempSync(path.join(base, 'askai-matrix-'));
  const home = path.join(root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    PATH: path.dirname(process.execPath) };
  const homes = ['--claude-home', path.join(home, '.claude'), '--codex-home', path.join(home, '.codex'),
    '--agy-home', path.join(home, '.gemini'), '--cursor-home', path.join(home, '.cursor')];
  const run = (...args) => {
    const r = cp.spawnSync(process.execPath, [ASKAI, ...args, ...homes], { env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(r.error);
    return { code: r.status, output: r.stdout + r.stderr };
  };
  try { return fn({ root, home, run }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const command of help.names()) {
  test(`askai ${command} --help`, () => fixture(({ run }) => {
    assert.ok(command === 'help' ? SOURCE.includes("cmd === 'help'") : SOURCE.includes(`case '${command}':`), `missing command handler: ${command}`);
    const r = run(command, '--help');
    assert.equal(r.code, 0, r.output);
    assert.ok(r.output.includes(`Usage: ${help.H[command].usage}`), r.output);
  }));
}

test('two projects: setup, isolated infra, repeat init, global uninstall', () => fixture(({ root, home, run }) => {
  const a = path.join(root, 'app-a'), b = path.join(root, 'app-b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  for (const legacy of ['.codex/agents-skills/askai', '.gemini/antigravity-cli/skills/askai', '.gemini/config/skills/askai']) {
    fs.mkdirSync(path.join(home, legacy), { recursive: true });
  }
  fs.writeFileSync(path.join(a, 'README.md'), '# App A\n');
  fs.writeFileSync(path.join(b, 'README.md'), '# App B\n');
  const installed = run('install', '--only', 'baseline,codex-baseline,agy-baseline,cursor-rules',
    '--target', 'all', '--yes', '--no-path', '--project', a);
  assert.equal(installed.code, 0, installed.output);
  const launchers = [
    '.claude/commands/askai-cli.md', '.codex/prompts/askai-cli.md',
    '.codex/agents-skills/askai-cli/SKILL.md', '.gemini/antigravity-cli/skills/askai-cli/SKILL.md',
    '.gemini/config/skills/askai-cli/SKILL.md', '.cursor/commands/askai-cli.md',
  ];
  for (const file of launchers) assert.ok(fs.existsSync(path.join(home, file)), `installed: ${file}`);
  for (const legacy of ['.codex/agents-skills/askai', '.gemini/antigravity-cli/skills/askai', '.gemini/config/skills/askai']) {
    assert.ok(!fs.existsSync(path.join(home, legacy)), `empty legacy directory removed: ${legacy}`);
  }
  for (const name of ['askai-status.md', 'askai-report.md', 'askai-handoff.md']) {
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'commands', name)), `retired launcher: ${name}`);
  }
  for (const file of FILES) assert.ok(fs.existsSync(path.join(a, file)), `A: ${file}`);
  for (const file of FILES) assert.ok(!fs.existsSync(path.join(b, file)), `B not initialized: ${file}`);
  const before = run('infra', b);
  assert.equal(before.code, 0, before.output);
  assert.match(before.output, /project setup\s+not initialized here; run askai init/);
  assert.match(before.output, /AGENTS\.md\s+missing/);

  const init = run('init', b, '--yes', '--about', 'Second project');
  assert.equal(init.code, 0, init.output);
  for (const file of FILES) assert.ok(fs.existsSync(path.join(b, file)), `B: ${file}`);
  const reviewBefore = run('review', 'status', b, '--json');
  assert.equal(reviewBefore.code, 0, reviewBefore.output);
  assert.equal(JSON.parse(reviewBefore.output).state, 'needed');
  assert.equal(run('review', 'done', b).code, 0);
  assert.equal(JSON.parse(run('review', 'status', b, '--json').output).state, 'current');
  fs.writeFileSync(path.join(b, 'new-feature.js'), 'export function feature() {}\n');
  const reviewAfter = JSON.parse(run('review', 'status', b, '--json').output);
  assert.equal(reviewAfter.state, 'stale');
  assert.deepEqual(reviewAfter.changed, ['new-feature.js']);
  const aAgent = fs.readFileSync(path.join(a, 'AGENTS.md'), 'utf8');
  const bAgent = fs.readFileSync(path.join(b, 'AGENTS.md'), 'utf8');
  assert.notEqual(aAgent, bAgent, 'project descriptions are separate');
  for (const dir of [a, b]) {
    const infra = run('infra', dir, '--json');
    assert.equal(infra.code, 0, infra.output);
    const report = JSON.parse(infra.output);
    assert.equal(report.repo.dir, dir);
    for (const file of FILES) assert.equal(typeof report.repo.files[file], 'number', `${dir}: ${file}`);
    assert.equal(run('todo', dir).code, 0);
  }
  assert.equal(run('init', a, '--yes').code, 0);
  assert.equal(fs.readFileSync(path.join(a, 'AGENTS.md'), 'utf8'), aAgent, 'repeat init preserves project files');
  assert.equal(run('init', b, '--dry-run', '--yes').code, 0);
  assert.equal(fs.readFileSync(path.join(b, 'AGENTS.md'), 'utf8'), bAgent, 'dry run preserves project files');

  const removed = run('uninstall', '--yes');
  assert.equal(removed.code, 0, removed.output);
  for (const file of launchers) assert.ok(!fs.existsSync(path.join(home, file)), `uninstalled: ${file}`);
  for (const dir of [a, b]) for (const file of FILES) {
    assert.ok(fs.existsSync(path.join(dir, file)), `uninstall preserves project content: ${file}`);
  }
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'askai', 'manifest.json')), 'global manifest removed');
}));

test('mcp off/on restores all four hosts; dry run leaves config unchanged', () => fixture(({ home, run }) => {
  const name = 'matrix-smoke';
  const definition = { command: 'fake-mcp', args: ['--check'] };
  const files = {
    claude: path.join(home, '.claude', '.claude.json'),
    codex: path.join(home, '.codex', 'config.toml'),
    agy: path.join(home, '.gemini', 'config', 'mcp_config.json'),
    cursor: path.join(home, '.cursor', 'mcp.json'),
  };
  for (const [tool, file] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = tool === 'codex'
      ? `[mcp_servers.${name}]\ncommand = "fake-mcp"\nargs = ["--check"]\n`
      : JSON.stringify({ mcpServers: { [name]: definition } }, null, 2) + '\n';
    fs.writeFileSync(file, original);
    const dry = run('mcp', 'off', name, '--tool', tool, '--dry-run');
    assert.equal(dry.code, 0, dry.output);
    assert.equal(fs.readFileSync(file, 'utf8'), original, `${tool} dry run`);
    const off = run('mcp', 'off', name, '--tool', tool);
    assert.equal(off.code, 0, off.output);
    assert.match(run('mcp', 'list', '--tool', tool).output, /matrix-smoke\s+(parked|off)/);
    const on = run('mcp', 'on', name, '--tool', tool);
    assert.equal(on.code, 0, on.output);
    if (tool === 'codex') assert.equal(fs.readFileSync(file, 'utf8'), original);
    else assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), JSON.parse(original), `${tool} restored`);
    assert.match(run('mcp', 'list', '--tool', tool).output, /matrix-smoke\s+on/);
  }
}));
