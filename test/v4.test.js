'use strict';
// askai 4.0: check, ask, break/resume, usage, Antigravity baseline, and the cross-platform preview.
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const { tmpHome, rm, readJson, write, makeCtx, cli, fs, path } = require('./helpers');
const comps = require('../lib/components');
const kb = require('../lib/kb');
const check = require('../lib/check');
const session = require('../lib/session');
const usage = require('../lib/usage');
const c = id => comps.byId(id);
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };
const quiet = () => {};

test('ask: natural questions find the matching rules, and every entry renders with its evidence', () => {
  assert.strictEqual(kb.search('coming back after a break')[0].id, 'resume');
  assert.strictEqual(kb.search('cursor auto')[0].id, 'model-cursor');
  assert.strictEqual(kb.search('is rtk worth it')[0].id, 'rtk');
  assert.strictEqual(kb.search('').length, 0);
  for (const e of kb.KB) assert.ok(kb.render(e).includes('Why:'), e.id);
  assert.strictEqual(cli(['ask', 'compact']).code, 0);
  assert.strictEqual(cli(['ask', 'qqqzzz']).code, 1);
});

test('check: flags billing traps, Opus default, Antigravity credits and repo gaps; --fix scaffolds the repo', () => withHome(home => {
  const ctx = makeCtx(home, { codexHome: path.join(home, 'codex'), agyHome: path.join(home, 'gemini'), cursorHome: path.join(home, 'cursor') });
  write(ctx.paths.settings, JSON.stringify({ model: 'opus', promptSuggestionEnabled: true }));
  write(ctx.agyPaths.cliSettings, JSON.stringify({ useG1Credits: true }));
  write(ctx.codexPaths.config, 'model_reasoning_effort = "high"\n');
  const rows = check.machine(ctx);
  const has = (lvl, re) => rows.some(r => r.level === lvl && re.test(r.msg));
  assert.ok(has('warn', /default model is opus/) && has('warn', /promptSuggestionEnabled/) && has('fail', /useG1Credits is true/) && has('warn', /effort high/));
  const repo = path.join(home, 'repo'); fs.mkdirSync(repo);
  assert.ok(check.repo(repo).some(r => /no AGENTS.md/.test(r.msg)));
  assert.strictEqual(check.run(ctx, repo, { fix: true }, quiet), 1, 'a failing item gives exit 1');
  assert.ok(fs.existsSync(path.join(repo, 'AGENTS.md')) && fs.existsSync(path.join(repo, '.cursorignore')), '--fix scaffolds the repo');
  const left = check.repo(repo).filter(r => r.level === 'warn').map(r => r.msg).sort();
  assert.deepStrictEqual(left, ['Cursor commands /askai-cli and /askai-plugins are missing in this project', 'HANDOFF.md is the empty template']);
}));

test('break and resume: checklist, ledger entry, time away and advice; the prompt is always printed', () => withHome(home => {
  const out = []; const p = m => out.push(m);
  assert.strictEqual(session.run('break', { repo: home, summary: 'menu done', next: 'check 320px' }, p), 0);
  assert.ok(out.join('\n').includes('write .ai-work/HANDOFF.md') && fs.existsSync(path.join(home, '.ai-work', 'LAST_BREAK')));
  fs.writeFileSync(path.join(home, '.ai-work', 'LAST_BREAK'), new Date(Date.now() - 3 * 3600000).toISOString());
  out.length = 0;
  session.run('resume', { repo: home }, p);
  assert.match(out.join('\n'), /Away 3 h 0 min: start a fresh chat/);
  assert.ok(out.join('\n').includes('Read AGENTS.md, then .ai-work/HANDOFF.md'));
  assert.ok(read(path.join(home, '.ai-work', 'SESSION_LEDGER.md')).includes('**next step:** check 320px'));
}));
const read = f => fs.readFileSync(f, 'utf8');

test('usage: Codex session files are summed per day, best effort, ignoring junk lines', () => withHome(home => {
  const dir = path.join(home, 'sessions', '2026', '10', '20'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rollout-a.jsonl'), ['not json', JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200 } } } }),
    JSON.stringify({ payload: { info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 3000, output_tokens: 900 } } } })].join('\n'));
  fs.writeFileSync(path.join(dir, 'rollout-b.jsonl'), JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
  const r = usage.codex(home, 7);
  assert.deepStrictEqual(r.total, { sessions: 2, input: 5010, output: 905, cached: 3000 });
  assert.match(usage.renderCodex(r), /total\s+2\s+5,010\s+905\s+3,000/);
  assert.match(usage.renderCodex(usage.codex(path.join(home, 'none'), 7)), /No Codex session files/);
}));

test('agy-baseline: sets useG1Credits false only when absent and removes only its own key', () => withHome(home => {
  const ctx = makeCtx(home, { agyHome: path.join(home, 'gemini') });
  c('agy-baseline').install(ctx);
  assert.strictEqual(readJson(ctx.agyPaths.cliSettings).useG1Credits, false);
  assert.strictEqual(c('agy-baseline').detect(ctx).state, 'ok');
  c('agy-baseline').uninstall(ctx);
  assert.ok(!('useG1Credits' in readJson(ctx.agyPaths.cliSettings)));
  write(ctx.agyPaths.cliSettings, JSON.stringify({ useG1Credits: true }));
  c('agy-baseline').install(ctx);
  assert.strictEqual(readJson(ctx.agyPaths.cliSettings).useG1Credits, true, "the user's own value is kept");
}));

test('preview matrix: install --dry-run plans every tool on simulated Windows, macOS and Linux and writes nothing', { skip: process.platform === 'win32' && 'needs bash; on Windows run install.ps1 -DryRun instead' }, () => withHome(home => {
  const r = cp.spawnSync('bash', [path.join(__dirname, '..', 'scripts', 'preview-matrix.sh'), '--quiet'], { encoding: 'utf8', timeout: 240000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const rows = r.stdout.split('\n').filter(l => /^\| (linux|darwin|win32) \|/.test(l));
  assert.strictEqual(rows.length, 27, r.stdout);
  for (const row of rows) { const cells = row.split('|').map(x => x.trim()); assert.strictEqual(cells[3], '0', row); assert.strictEqual(cells[6], '0', `${row}: nothing written`); }
}));

test('codex-serena without the codex CLI writes [mcp_servers.serena] itself and removes it cleanly', () => withHome(home => {
  const good = { ok: true, status: 0, stdout: '', stderr: '', error: null };
  const ctx = makeCtx(home, { codexHome: path.join(home, 'codex') }, { tools: { uv: '/fake/uv', serena: '/fake/serena' }, probe: () => good });
  write(ctx.codexPaths.config, 'model = "gpt-6-luna"\n');
  c('codex-serena').install(ctx);
  const t = fs.readFileSync(ctx.codexPaths.config, 'utf8');
  assert.match(t, /\[mcp_servers\.serena\]\ncommand = "\/fake\/serena"\nargs = \["start-mcp-server", "--context", "codex"/);
  assert.strictEqual(c('codex-serena').detect(ctx).state, 'ok');
  c('codex-serena').uninstall(ctx);
  assert.strictEqual(fs.readFileSync(ctx.codexPaths.config, 'utf8'), 'model = "gpt-6-luna"\n');
}));
