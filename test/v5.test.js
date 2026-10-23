'use strict';
// askai 5.0: project knowledge pack, model tiers, prompt refiner, MCP switch, token audit, reminder hooks, launcher, guide,
// plugins registry, infra view.
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, readJson, write, makeCtx, cli, fs, path } = require('./helpers');
const comps = require('../lib/components');
const models = require('../lib/models');
const promptLib = require('../lib/prompt');
const project = require('../lib/project');
const mcp = require('../lib/mcp');
const audit = require('../lib/audit');
const hook = require('../lib/hook');
const guide = require('../lib/guide');
const launch = require('../lib/launch');
const childProcess = require('node:child_process');
const session = require('../lib/session');
const plugins = require('../lib/plugins');
const infra = require('../lib/infra');
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };
const quiet = () => {};
const read = f => fs.readFileSync(f, 'utf8');
const ctxFor = h => makeCtx(h, { codexHome: path.join(h, 'codex'), agyHome: path.join(h, 'gemini'), cursorHome: path.join(h, 'cursor') });

test('models: the user tiers by default, overridable, Antigravity limited to tiers, tier guessing ignores file names', () => withHome(h => {
  const ctx = ctxFor(h); const p = models.load(ctx);
  assert.deepStrictEqual(models.pick(p, 'claude', 'lead'), { tier: 'lead', agent: 'architect', model: 'sonnet', effort: 'high' });
  assert.strictEqual(models.pick(p, 'codex', 'chore').model, 'gpt-6-luna');
  assert.match(models.set(ctx, 'codex.lead', 'gpt-6.1-luna:high').warning, /not a known Codex model ID/);
  assert.strictEqual(models.set(ctx, 'codex.lead', 'gpt-6.1-sol:high').warning, undefined);
  assert.strictEqual(models.pick(p, 'cursor', 'lead').model, 'grok-4.7');
  models.set(ctx, 'cursor.useSonnet', 'true'); assert.strictEqual(models.pick(models.load(ctx), 'cursor', 'build').model, 'claude-sonnet-5');
  models.set(ctx, 'codex.build', 'gpt-6-luna:low'); assert.deepStrictEqual(models.pick(models.load(ctx), 'codex', 'build'), { tier: 'build', agent: 'builder', model: 'gpt-6-luna', effort: 'low' });
  assert.throws(() => models.set(ctx, 'agy.lead', 'gemini-3.8-flash-high'), /accept only/);
  assert.strictEqual(models.guessTier('fix the login bug in src/auth.ts'), 'build');
  assert.strictEqual(models.guessTier('redesign the checkout architecture'), 'lead');
  assert.strictEqual(models.guessTier('clean up git branches'), 'chore');
  assert.match(models.markdown(models.load(ctx)), /\| lead \(`architect`\) \|/);
}));

test('prompt: dictation is cleaned, files found, tier and modes applied; output-safe template', () => {
  assert.strictEqual(promptLib.clean('um so basically fix the the bug, you know'), 'fix the bug');
  const r = promptLib.task({ ask: 'uh fix rounding in src/cart.ts and utils/money.ts', mode: 'brutal,assume' });
  assert.strictEqual(r.tier, 'build'); assert.deepStrictEqual(r.files, ['src/cart.ts', 'utils/money.ts']);
  assert.match(r.text, /@src\/cart\.ts @utils\/money\.ts/); assert.match(r.text, /BRUTAL:/); assert.match(r.text, /ASSUME:/);
  assert.match(promptLib.outputSafe('npm test'), /4\. The short summary/);
  assert.throws(() => promptLib.task({ ask: '  ' }), /give the request/);
});

test('go starts the selected agent in the selected project folder', () => withHome(h => {
  const repo = path.join(h, 'shop'); fs.mkdirSync(repo);
  const ctx = ctxFor(h); ctx.which = () => 'agent';
  const oldSpawn = childProcess.spawnSync, oldSession = session.run;
  const inTty = process.stdin.isTTY, outTty = process.stdout.isTTY;
  let launched;
  process.stdin.isTTY = true; process.stdout.isTTY = true;
  childProcess.spawnSync = (cmd, args, options) => { if (cmd !== 'git') launched = { cmd, options }; return { status: 0 }; };
  session.run = () => 0;
  try { assert.strictEqual(launch.run(ctx, 'codex', { repo, copy: false }, quiet), 0); }
  finally { process.stdin.isTTY = inTty; process.stdout.isTTY = outTty; childProcess.spawnSync = oldSpawn; session.run = oldSession; }
  assert.strictEqual(launched.cmd, 'codex');
  assert.strictEqual(launched.options.cwd, repo);
}));

test('go does not start an agent when the process has no terminal', () => withHome(h => {
  const repo = path.join(h, 'shop'); fs.mkdirSync(repo);
  const ctx = ctxFor(h); ctx.which = () => 'agent';
  const oldSpawn = childProcess.spawnSync, oldSession = session.run;
  const inTty = process.stdin.isTTY, outTty = process.stdout.isTTY;
  let launched = false; let ledger = false; const lines = [];
  process.stdin.isTTY = false; process.stdout.isTTY = false;
  childProcess.spawnSync = () => { launched = true; return { status: 0 }; };
  session.run = () => { ledger = true; return 0; };
  try { assert.strictEqual(launch.run(ctx, 'claude', { repo, ask: 'fix the cart', copy: false }, line => lines.push(line)), 0); }
  finally { process.stdin.isTTY = inTty; process.stdout.isTTY = outTty; childProcess.spawnSync = oldSpawn; session.run = oldSession; }
  assert.strictEqual(launched, false);
  assert.strictEqual(ledger, false);
  assert.match(lines.join('\n'), /No terminal here/);
}));

test('init: router under 333 lines, adapters, docs/ai, subagents in each tool format, skills; idempotent; keeps user text', () => withHome(h => {
  const repo = path.join(h, 'shop'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  write(path.join(repo, 'package.json'), JSON.stringify({ name: 'shop', description: 'Online shop.', scripts: { test: 'vitest', build: 'vite build' }, dependencies: { react: '18' } }));
  write(path.join(repo, 'src', 'main.tsx'), 'x');
  const ctx = ctxFor(h);
  project.init(repo, { yes: true }, ctx, quiet);
  const f = n => path.join(repo, n);
  const agents = read(f('AGENTS.md'));
  assert.ok(agents.split('\n').length < 333); assert.match(agents, /Type: website/); assert.match(agents, /docs\/ai\/PROJECT_MAP\.md/); assert.match(agents, /- test: `npm test`/);
  assert.ok(read(f('CLAUDE.md')).startsWith('@AGENTS.md'));
  assert.match(read(f('GEMINI.md')), /AGENTS\.md/);
  for (const d of ['PROJECT_MAP', 'ARCHITECTURE', 'FEATURES', 'WORK_ORDER', 'MODELS']) assert.ok(fs.existsSync(f(`docs/ai/${d}.md`)), d);
    assert.match(read(f('.claude/agents/architect.md')), /model: sonnet\neffort: high/);
  const toml = read(f('.codex/agents/runner.toml'));
  for (const k of ['name = "runner"', 'description =', 'developer_instructions = """', 'model = "gpt-6-luna"']) assert.ok(toml.includes(k), k);
  assert.match(read(f('.cursor/agents/builder.md')), /model: grok-4\.7/);
  const agy = read(f('.agents/agents/architect.md')); assert.match(agy, /\nmodel: flash\n/); assert.ok(models.AGY_TIERS.includes(/\nmodel: (\S+)/.exec(agy)[1]));
  assert.ok(fs.existsSync(f('.claude/skills/prompt-refiner/SKILL.md')) && fs.existsSync(f('.agents/skills/investigate-bug/SKILL.md')));
  assert.ok(fs.existsSync(f('.cursorignore')) && fs.existsSync(f('.ai-work')));
  const out = []; project.init(repo, { yes: true }, ctx, m => out.push(m));
  assert.ok(!out.some(l => /^\s+(create|update)/.test(l)), 'second run writes nothing');
  const r2 = path.join(h, 'other'); fs.mkdirSync(r2); write(path.join(r2, 'AGENTS.md'), '# Mine\nkeep this\n');
  project.init(r2, { yes: true, about: 'Firmware.' }, ctx, quiet);
  const a2 = read(path.join(r2, 'AGENTS.md')); assert.ok(a2.startsWith('# Mine\nkeep this\n')); assert.match(a2, /askai:begin router/);
  models.set(ctx, 'claude.lead', 'opus:high'); project.init(repo, { yes: true, refresh: true }, ctx, quiet);
  assert.match(read(f('.claude/agents/architect.md')), /model: opus\neffort: high/);
  write(f('docs/ai/PROJECT_MAP.md'), read(f('docs/ai/PROJECT_MAP.md')).replace('| `src/` | 1 | .tsx | Application source code |', '| `src/` | 1 | .tsx | the shop UI |'));
  project.map(repo, {}, quiet); assert.match(read(f('docs/ai/PROJECT_MAP.md')), /the shop UI/);
}));

test('mcp: lists all four tools; parks and restores in Claude Code, uses Codex enabled and Antigravity disabled', () => withHome(h => {
  const ctx = ctxFor(h);
  write(ctx.paths.userJson, JSON.stringify({ mcpServers: { serena: { command: 'serena' }, pw: { command: 'npx' } } }));
  write(ctx.codexPaths.config, 'model = "x"\n\n[mcp_servers.serena]\ncommand = "serena"\n');
  write(ctx.agyPaths.mcp, JSON.stringify({ mcpServers: { ctx7: { command: 'npx' } } }));
  assert.strictEqual(mcp.list(ctx).length, 4);
  assert.strictEqual(mcp.setState(ctx, 'claude', 'pw', false), 'parked');
  assert.ok(!('pw' in readJson(ctx.paths.userJson).mcpServers)); assert.ok(mcp.list(ctx).some(r => r.name === 'pw' && r.state === 'parked'));
  assert.strictEqual(mcp.setState(ctx, 'claude', 'pw', true), 'restored'); assert.ok('pw' in readJson(ctx.paths.userJson).mcpServers);
  assert.strictEqual(mcp.setState(ctx, 'codex', 'serena', false), 'disabled'); assert.match(read(ctx.codexPaths.config), /\[mcp_servers\.serena\]\nenabled = false/);
  assert.strictEqual(mcp.setState(ctx, 'codex', 'serena', true), 'enabled'); assert.ok(!/enabled = false/.test(read(ctx.codexPaths.config)));
  assert.strictEqual(mcp.setState(ctx, 'agy', 'ctx7', false), 'disabled'); assert.strictEqual(readJson(ctx.agyPaths.mcp).mcpServers.ctx7.disabled, true);
  assert.throws(() => mcp.setState(ctx, 'agy', 'nope', false), /no MCP server/);
}));

test('audit: memory with @imports, and cache, switches, compactions and subagent models from a session log', () => withHome(h => {
  const ctx = ctxFor(h); const repo = path.join(h, 'r'); fs.mkdirSync(repo);
  write(path.join(repo, 'CLAUDE.md'), '@AGENTS.md\n'); write(path.join(repo, 'AGENTS.md'), 'x'.repeat(24000));
  const mem = audit.memoryFiles(ctx, repo); assert.ok(mem.some(m => m.file.endsWith('AGENTS.md') && m.tokens === 6000));
  const dir = path.join(ctx.paths.home, 'projects', '-r'); fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  const turn = (model, u) => JSON.stringify({ type: 'assistant', message: { model, usage: u } });
  write(path.join(dir, 's1.jsonl'), [turn('claude-sonnet-5-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }),
    JSON.stringify({ type: 'summary' }), turn('claude-opus-5-5', { input_tokens: 2000, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000 })].join('\n'));
  write(path.join(dir, 's1', 'subagents', 'agent-1.jsonl'), JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-haiku-5-5' } }));
  const r = audit.parseClaude(path.join(dir, 's1.jsonl'));
  assert.deepStrictEqual([r.turns, r.switches, r.compactions, r.cacheRead], [2, 1, 1, 900]); assert.deepStrictEqual(r.subagents, { 'claude-haiku-5-5 @ high': 1 });
  const rows = []; const code = audit.run(ctx, repo, {}, m => rows.push(m));
  assert.strictEqual(code, 1); assert.ok(rows.some(l => /Model switches in that session \| HIGH/.test(l)) && rows.some(l => /Large memory file AGENTS\.md \| HIGH/.test(l)));
}));

test('hooks: systemMessage only, thresholds once each, every 20 prompts, silent on bad input', () => withHome(h => {
  const ctx = ctxFor(h); fs.mkdirSync(ctx.paths.sessions, { recursive: true });
  const say = j => hook.run(ctx, 'prompt', JSON.stringify(j));
  write(path.join(ctx.paths.sessions, 's.json'), JSON.stringify({ ctxPct: 62 }));
  const a = JSON.parse(say({ session_id: 's' })); assert.deepStrictEqual(Object.keys(a), ['systemMessage']); assert.match(a.systemMessage, /context 62%/);
  write(path.join(ctx.paths.sessions, 's.json'), JSON.stringify({ ctxPct: 85 }));
  assert.match(JSON.parse(say({ session_id: 's' })).systemMessage, /context 85%/);
  let n = 0; for (let i = 0; i < 25; i++) { const o = say({ session_id: 's' }); if (o && /prompts in this session/.test(o)) n++; }
  assert.strictEqual(n, 1);
  assert.strictEqual(hook.run(ctx, 'prompt', 'not json'), null); assert.strictEqual(say({ session_id: '../x' }), null);
  assert.match(JSON.parse(hook.run(ctx, 'session', JSON.stringify({ session_id: 'q', cwd: h }))).systemMessage, /^AskAI: model/);
}));

test('prompt-hooks component: adds the two reminder hooks, keeps the user hook, removes only its own', () => withHome(h => {
  const ctx = ctxFor(h); write(ctx.paths.settings, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }] } }));
  const c = comps.byId('prompt-hooks'); assert.strictEqual(c.detect(ctx).state, 'missing');
  c.install(ctx); assert.strictEqual(c.detect(ctx).state, 'ok');
  const s = readJson(ctx.paths.settings); assert.strictEqual(s.hooks.UserPromptSubmit.length, 2); assert.match(s.hooks.SessionStart[0].hooks[0].command, /askai\.js" hook session$/);
  c.install(ctx); assert.strictEqual(readJson(ctx.paths.settings).hooks.UserPromptSubmit.length, 2, 'idempotent');
  c.uninstall(ctx);
  assert.deepStrictEqual(readJson(ctx.paths.settings).hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }]);
}));

test('guide, clear gate and context advice', () => withHome(h => {
  for (const t of guide.ORDER) assert.ok(guide.render(t).startsWith(t.toUpperCase()), t);
  assert.strictEqual(guide.render('nope'), null);
  assert.strictEqual(guide.clearGate(h).fresh, false);
  write(path.join(h, '.ai-work', 'HANDOFF.md'), '# HANDOFF\n## Goal and acceptance criteria\n- <one sentence>\n- <testable criterion>\n## Not verified\n- <item>\n');
  assert.strictEqual(guide.clearGate(h).fresh, false, 'the empty template is not a handoff');
  write(path.join(h, '.ai-work', 'HANDOFF.md'), fs.readFileSync(path.join(__dirname, '..', 'templates', 'HANDOFF.md'), 'utf8'));
  assert.strictEqual(guide.clearGate(h).fresh, false, 'the shipped template is not a handoff');
  assert.match(guide.clearGate(h).text, /still the empty template/);
  write(path.join(h, '.ai-work', 'HANDOFF.md'), '# HANDOFF\nGoal: ship the cart totals fix; tests green\n');
  const g = guide.clearGate(h, 'codex'); assert.strictEqual(g.fresh, true); assert.strictEqual(g.native, '/new');
  assert.match(guide.advice(30), /continue/); assert.match(guide.advice(65), /HANDOFF\.md/); assert.match(guide.advice(90), /now/);
}));

test('go: the tier model and effort per tool, fixed for the session', () => withHome(h => {
  const ctx = ctxFor(h);
  const c = launch.plan(ctx, 'claude', { tier: 'lead', ask: 'design the sync engine' });
  assert.deepStrictEqual(c.args.slice(0, 2), ['--model', 'sonnet']); assert.strictEqual(c.env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
  const x = launch.plan(ctx, 'codex', { ask: 'clean up unused imports' });
  assert.strictEqual(x.tier, 'chore'); assert.deepStrictEqual(x.args.slice(0, 4), ['-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="medium"']);
  assert.deepStrictEqual(launch.plan(ctx, 'cursor', {}).args, ['--model', 'grok-4.7']);
  const g = launch.plan(ctx, 'antigravity', { ask: 'fix the parser' }); assert.strictEqual(g.cmd, 'agy'); assert.ok(g.notes.some(n => /\/effort high/.test(n)));
  assert.throws(() => launch.plan(ctx, 'vim', {}), /which tool/);
  assert.strictEqual(cli(['go', 'codex', '--dry-run', '--claude-home', path.join(h, 'c')]).code, 0);
}));

test('plugins and infra: registry with evidence; infra shows tools and the repository', () => withHome(h => {
  const ctx = ctxFor(h);
  for (const id of ['rtk', 'headroom', 'serena', 'context-mode', 'repomix', 'ccusage', 'aider', 'context7', 'claude-mem', 'graphify', 'supermemory', 'ponytail', 'caveman', 'graftcode']) assert.ok(plugins.P.some(p => p.id === id), id);
  const out = []; assert.strictEqual(plugins.info('headroom', m => out.push(m)), 0); assert.match(out.join('\n'), /API billing/);
  assert.strictEqual(plugins.info('nope', quiet), 1);
  const steps = []; plugins.install(ctx, 'context7', { dry: true }, m => steps.push(m)); assert.ok(steps.some(s => /context7/.test(s)) && steps.some(s => /Dry run/.test(s)));
  project.init(h, { yes: true }, ctx, quiet);
  const r = infra.collect(ctx, h); assert.ok(r.tools.claude && r.tools.codex && r.tools.agy && r.tools.cursor); assert.ok(r.repo.files['AGENTS.md'] > 0);
  assert.match(infra.render(r), /\[Repository\]/);
  assert.match(cli(['help', 'init']).out, /knowledge pack/); assert.strictEqual(cli(['guide', 'resume']).code, 0); assert.match(cli(['context', '65']).out, /Context 65%/);
}));
