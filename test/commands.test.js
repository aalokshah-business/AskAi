'use strict';
// suggest, project, the three Cursor components, markitdown and ccusage. Everything runs against temp dirs with fake process
// runners; CLI runs use --claude-home / --cursor-home temp dirs and never call an installer.
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../lib/claude-config');
const comps = require('../lib/components');
const cursor = require('../lib/cursor');
const rules = require('../lib/rules');
const suggestLib = require('../lib/suggest');
const { tmpHome, rm, write, readJson, makeCtx, cli, fs, path } = require('./helpers');

const c = id => comps.byId(id);
const OK = { ok: true, status: 0, stdout: '', stderr: '', error: null };
const NO = (stderr = '') => ({ ok: false, status: 1, stdout: '', stderr, error: null });

// A temp claude home, a Cursor home and a project dir next to it, all removed afterwards.
function withDirs(fn) {
  const home = tmpHome(), cursorHome = `${home}-cursor`, proj = `${home}-proj`;
  fs.mkdirSync(cursorHome, { recursive: true });
  fs.mkdirSync(proj, { recursive: true });
  try { return fn({ home, cursorHome, proj }); } finally { rm(home); rm(cursorHome); rm(proj); }
}
// The log is mutated in place: editJson closed over the original object.
function capture(ctx) {
  const out = [];
  Object.assign(ctx.log, { info: m => out.push(m), warn: m => out.push(`warn: ${m}`), step: m => out.push(m), plan: m => out.push(`plan: ${m}`) });
  return out;
}
const touch = (dir, names) => names.forEach(n => write(path.join(dir, n), 'x'));
const manifestOf = home => readJson(`${home}/askai/manifest.json`);
const mcpOf = cursorHome => readJson(`${cursorHome}/mcp.json`);

// ---- suggest -----------------------------------------------------------------------------------------------------------
test('suggest.scan: counts code, text and PDF/Office files; skips dependency and dot dirs; stops at depth 3', () => {
  const dir = tmpHome();
  try {
    touch(dir, ['a.ts', 'b.PY', 'c.go', 'README.md', 'notes.txt', 'spec.pdf', 'deck.pptx', 'data.xlsx', 'image.png']);
    touch(dir, ['node_modules/x/dep.js', '.git/hooks.js', '.hidden/h.js', 'dist/out.js', 'vendor/v.go']);
    touch(dir, ['l2/two.ts', 'l2/l3/three.ts', 'l2/l3/l4/four.ts']);
    const s = suggestLib.scan(dir);
    assert.strictEqual(s.code, 5, 'a.ts, b.PY, c.go, l2/two.ts, l2/l3/three.ts; nothing from skipped dirs or below depth 3');
    assert.strictEqual(s.textDocs, 2);
    assert.strictEqual(s.binaryDocs, 3);
    assert.strictEqual(s.truncated, false);
  } finally { rm(dir); }
});

test('suggest.scan: stops at the entry limit and says so', () => {
  const dir = tmpHome();
  try {
    for (let i = 0; i < 3050; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), '');
    const s = suggestLib.scan(dir);
    assert.strictEqual(s.truncated, true);
    assert.ok(s.entries <= 3000 && s.code <= 3000, `scanned ${s.entries} entries`);
  } finally { rm(dir); }
});

test('suggest.scan: an unreadable or missing directory yields zero counts', () => {
  const s = suggestLib.scan(path.join(tmpHome(), 'does-not-exist'));
  assert.deepStrictEqual([s.code, s.textDocs, s.binaryDocs, s.truncated], [0, 0, 0, false]);
});

test('suggest.recommend: thresholds pick full / coding / docs / minimal', () => {
  const r = (code, textDocs, binaryDocs) => suggestLib.recommend({ code, textDocs, binaryDocs }).profile;
  assert.strictEqual(r(10, 0, 3), 'full', 'code and PDF/Office files both present');
  assert.strictEqual(r(10, 5, 0), 'coding', 'a README in a code project does not outvote the code');
  assert.strictEqual(r(3, 0, 0), 'coding');
  assert.strictEqual(r(1, 6, 0), 'docs');
  assert.strictEqual(r(0, 0, 4), 'docs');
  assert.strictEqual(r(2, 1, 0), 'minimal', 'too little to tell');
  assert.strictEqual(r(0, 0, 0), 'minimal');
  assert.match(suggestLib.recommend({ code: 0, textDocs: 0, binaryDocs: 0 }).reason, /too few/);
});

test('suggest command: text and --json output, and a bad directory exits 1', () => {
  const dir = tmpHome(), home = tmpHome();
  try {
    touch(dir, ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    const t = cli(['suggest', dir, '--claude-home', home]);
    assert.strictEqual(t.code, 0, t.err);
    assert.match(t.out, /suggested profile: coding/);
    assert.match(t.out, /askai install --target claude --profile coding/);
    assert.match(t.out, /~\/\.cursor\/rules/);
    assert.match(t.out, /askai project/);
    const j = JSON.parse(cli(['suggest', dir, '--json', '--claude-home', home]).out);
    assert.strictEqual(j.profile, 'coding');
    assert.strictEqual(j.counts.code, 4);
    assert.strictEqual(j.dir, path.resolve(dir));
    const bad = cli(['suggest', path.join(dir, 'nope'), '--claude-home', home]);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.err, /askai: .*nope is not a directory/);
    assert.deepStrictEqual(fs.readdirSync(home), [], 'suggest is read-only');
  } finally { rm(dir); rm(home); }
});

// ---- project -----------------------------------------------------------------------------------------------------------
const rulesIn = proj => { try { return fs.readdirSync(path.join(proj, '.cursor', 'rules')).sort(); } catch (_) { return []; } };
const project = (a, args = []) => cli(['project', a.proj, '--claude-home', a.home, '--cursor-home', a.cursorHome, ...args]);

test('project --print shows the rules and writes nothing', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts']);
  const r = project(a, ['--print']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /askai-tokens\.mdc/);
  assert.match(r.out, /askai-coding\.mdc/);
  assert.ok(!fs.existsSync(path.join(a.proj, '.cursor')), 'nothing written');
  assert.ok(!fs.existsSync(`${a.home}/askai/manifest.json`), 'nothing recorded');
}));

test('project: writes the rules of the suggested profile and records the project and its profile', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  const r = project(a);
  assert.strictEqual(r.code, 0, r.err + r.out);
  assert.match(r.out, /profile: coding \(suggested/);
  assert.deepStrictEqual(rulesIn(a.proj), ['askai-coding.mdc', 'askai-tokens.mdc']);
  for (const n of rulesIn(a.proj)) assert.ok(fs.readFileSync(path.join(a.proj, '.cursor', 'rules', n), 'utf8').includes(rules.MDC_MARKER), `${n} carries the marker`);
  assert.deepStrictEqual(manifestOf(a.home).cursorProjects[path.resolve(a.proj)], { profile: 'coding' });

  const again = project(a);
  assert.strictEqual(again.code, 0);
  assert.match(again.out, /profile: coding \(set earlier for this project\)/);
  assert.match(again.out, /unchanged: askai-tokens\.mdc, askai-coding\.mdc|unchanged: /);
  assert.doesNotMatch(again.out, /written:/);
}));

test('project --profile overrides the suggestion, removes rule files the new profile drops, and is remembered', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts']);
  assert.strictEqual(project(a).code, 0);
  const docs = project(a, ['--profile', 'docs']);
  assert.strictEqual(docs.code, 0, docs.err + docs.out);
  assert.deepStrictEqual(rulesIn(a.proj), ['askai-docs.mdc', 'askai-tokens.mdc']);
  assert.match(docs.out, /removed \(no longer in the profile\): askai-coding\.mdc/);
  assert.strictEqual(manifestOf(a.home).cursorProjects[path.resolve(a.proj)].profile, 'docs');
  assert.match(project(a).out, /profile: docs \(set earlier for this project\)/, 'the recorded profile beats the suggestion');
  const min = project(a, ['--profile', 'minimal']);
  assert.deepStrictEqual(rulesIn(a.proj), ['askai-tokens.mdc'], 'minimal keeps only the token rule');
  assert.strictEqual(min.code, 0);
}));

test('project --dry-run writes and records nothing', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts']);
  const r = project(a, ['--dry-run']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /dry-run/);
  assert.ok(!fs.existsSync(path.join(a.proj, '.cursor')));
  assert.ok(!fs.existsSync(`${a.home}/askai/manifest.json`));
}));

test('project: a rule file askai did not write is skipped (exit 1 when nothing was written) and --force overwrites it', () => withDirs(a => {
  const mine = path.join(a.proj, '.cursor', 'rules', 'askai-tokens.mdc');
  write(mine, 'my own rule, no marker\n');
  const r = project(a, ['--profile', 'minimal']);
  assert.strictEqual(r.code, 1, 'the only file was skipped');
  assert.match(r.out, /skipped, not written by askai: askai-tokens\.mdc/);
  assert.strictEqual(fs.readFileSync(mine, 'utf8'), 'my own rule, no marker\n');
  assert.ok(!fs.existsSync(`${a.home}/askai/manifest.json`), 'a run that wrote nothing records nothing');

  const forced = project(a, ['--profile', 'minimal', '--force']);
  assert.strictEqual(forced.code, 0, forced.err + forced.out);
  assert.ok(fs.readFileSync(mine, 'utf8').includes(rules.MDC_MARKER));
}));

test('project --remove deletes only the marked askai files, keeps the user\'s rules, and forgets the project', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts']);
  assert.strictEqual(project(a).code, 0);
  const own = path.join(a.proj, '.cursor', 'rules', 'my-rule.mdc');
  write(own, 'keep me');
  write(path.join(a.proj, '.cursor', 'rules', 'askai-notes.mdc'), 'unmarked, user-made');
  const dry = project(a, ['--remove', '--dry-run']);
  assert.strictEqual(dry.code, 0);
  assert.strictEqual(rulesIn(a.proj).length, 4, 'dry-run removes nothing');

  const r = project(a, ['--remove']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /removed askai-coding\.mdc, askai-tokens\.mdc|removed askai-tokens\.mdc, askai-coding\.mdc/);
  assert.deepStrictEqual(rulesIn(a.proj), ['askai-notes.mdc', 'my-rule.mdc']);
  assert.strictEqual(fs.readFileSync(own, 'utf8'), 'keep me');
  assert.strictEqual(manifestOf(a.home).cursorProjects[path.resolve(a.proj)], undefined);
  assert.match(project(a, ['--remove']).out, /no askai rules in/);
}));

test('project: a missing directory and an unknown profile both fail without writing', () => withDirs(a => {
  const missing = cli(['project', path.join(a.proj, 'nope'), '--claude-home', a.home, '--cursor-home', a.cursorHome]);
  assert.strictEqual(missing.code, 1);
  assert.match(missing.err, /is not a directory/);
  const bad = project(a, ['--profile', 'nope']);
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.err + bad.out, /unknown profile "nope"/);
  assert.ok(!fs.existsSync(path.join(a.proj, '.cursor')));
}));

// ---- Cursor components (fakes; the Cursor home is a temp dir) -------------------------------------------------------------
const cctx = (a, opts = {}, fakes = {}) => makeCtx(a.home, { cursorHome: a.cursorHome, ...opts }, fakes);
const hooksOf = a => readJson(`${a.cursorHome}/hooks.json`);

test('cursor components: without a Cursor directory (sandbox, no --cursor-home) they report "other" and refuse to install', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home, {}, { tools: { rtk: '/bin/rtk', npm: '/bin/npm' } });
    assert.strictEqual(ctx.cursorPaths, null);
    for (const id of ['cursor-rtk', 'cursor-context-mode', 'cursor-serena', 'cursor-rules']) {
      assert.strictEqual(c(id).detect(ctx).state, 'other', id);
      c(id).uninstall(ctx);
      c(id).update(ctx);
    }
    assert.throws(() => c('cursor-context-mode').install(ctx), /--cursor-home/);
    assert.throws(() => c('cursor-serena').install(ctx), /--cursor-home/);
    assert.throws(() => c('cursor-rtk').install(ctx), /--cursor-home/);
    assert.throws(() => c('cursor-rules').install(ctx), /--cursor-home/);
    assert.deepStrictEqual(ctx.calls, [], 'no command ran');
  } finally { rm(home); }
});

test('cursor-rules: writes the profile rules under <cursorHome>/rules and removes only marked files', () => withDirs(a => {
  cfg.writeJson(path.join(a.cursorHome, 'mcp.json'), { mcpServers: { 'context-mode': { command: 'context-mode' }, serena: { command: '/bin/serena' } } });
  const ctx = cctx(a, { profile: 'coding' }, { tools: { serena: '/bin/serena' } });
  assert.strictEqual(c('cursor-rules').detect(ctx).state, 'missing');
  c('cursor-rules').install(ctx);
  const rd = path.join(a.cursorHome, 'rules');
  assert.deepStrictEqual(fs.readdirSync(rd).sort(), ['askai-coding.mdc', 'askai-tokens.mdc']);
  const tokens = fs.readFileSync(path.join(rd, 'askai-tokens.mdc'), 'utf8');
  assert.match(tokens, /alwaysApply: true/);
  assert.match(tokens, /find_symbol/);
  assert.match(tokens, /ctx_batch_execute/);
  assert.ok(!fs.existsSync(path.join(a.cursorHome, '.cursor')), 'user rules are not nested under another .cursor');
  assert.strictEqual(c('cursor-rules').detect(ctx).state, 'ok');
  write(path.join(rd, 'askai-docs.mdc'), `${rules.MDC_MARKER}\nstale\n`);
  assert.strictEqual(c('cursor-rules').detect(ctx).state, 'partial');
  c('cursor-rules').install(ctx);
  assert.ok(!fs.existsSync(path.join(rd, 'askai-docs.mdc')));
  write(path.join(rd, 'mine.mdc'), 'leave me\n');
  c('cursor-rules').uninstall(ctx);
  assert.deepStrictEqual(fs.readdirSync(rd), ['mine.mdc']);
}));

test('cursor-context-mode: installs the npm package once, adds the MCP entry, records ownership; detect goes ok', () => withDirs(a => {
  const tools = { npm: '/bin/npm' };
  const fakes = { tools, nodeVersion: '24.0.0', act: cmd => { if (cmd === 'npm') tools['context-mode'] = '/bin/context-mode'; return OK; } };
  const ctx = cctx(a, {}, fakes);
  assert.strictEqual(c('cursor-context-mode').detect(ctx).state, 'missing');
  c('cursor-context-mode').install(ctx);
  assert.ok(ctx.calls.includes(`act npm install -g context-mode@${comps.CONTEXT_MODE_VERSION}`));
  assert.deepStrictEqual(mcpOf(a.cursorHome).mcpServers['context-mode'], { command: 'context-mode' });
  assert.deepStrictEqual([ctx.manifest.components['cursor-context-mode'].installedByAskai, ctx.manifest.components['cursor-context-mode'].mcp], [true, true]);
  assert.strictEqual(c('cursor-context-mode').detect(ctx).state, 'ok');

  c('cursor-context-mode').install(ctx);
  assert.strictEqual(ctx.calls.filter(x => x.startsWith('act npm install')).length, 1, 'a second run installs nothing');
}));

test('cursor-context-mode: refuses old Node, needs npm, and a failed npm install is an error, not a success', () => withDirs(a => {
  assert.throws(() => c('cursor-context-mode').install(cctx(a, {}, { nodeVersion: '20.11.0', tools: { npm: '/bin/npm' } })), /too old for Context Mode/);
  assert.throws(() => c('cursor-context-mode').install(cctx(a, {}, { nodeVersion: '24.0.0', tools: {} })), /npm not found/);
  const ctx = cctx(a, {}, { nodeVersion: '24.0.0', tools: { npm: '/bin/npm' }, act: () => NO('EACCES') });
  assert.throws(() => c('cursor-context-mode').install(ctx), /npm install -g context-mode failed/);
  assert.ok(!fs.existsSync(`${a.cursorHome}/mcp.json`), 'nothing wired after a failed install');
  const lie = cctx(a, {}, { nodeVersion: '24.0.0', tools: { npm: '/bin/npm' }, act: () => OK });
  assert.throws(() => c('cursor-context-mode').install(lie), /not on PATH yet/);
}));

test('cursor-context-mode: an entry the user already has is left as it is, is not askai\'s to remove, and --force removes it', () => withDirs(a => {
  write(`${a.cursorHome}/mcp.json`, JSON.stringify({ mcpServers: { 'context-mode': { command: 'node', args: ['mine.js'] }, other: { command: 'x' } } }));
  const tools = { npm: '/bin/npm', 'context-mode': '/bin/context-mode' };
  const ctx = cctx(a, {}, { tools, nodeVersion: '24.0.0' });
  const logs = capture(ctx);
  c('cursor-context-mode').install(ctx);
  assert.deepStrictEqual(mcpOf(a.cursorHome).mcpServers['context-mode'], { command: 'node', args: ['mine.js'] });
  assert.ok(logs.some(l => /already has a context-mode entry/.test(l)));
  assert.strictEqual(ctx.manifest.components['cursor-context-mode'].mcp, false);
  assert.strictEqual(ctx.manifest.components['cursor-context-mode'].installedByAskai, false, 'the package was there before');

  const keep = cctx(a, { tools: true }, { tools });
  keep.manifest.components['cursor-context-mode'] = ctx.manifest.components['cursor-context-mode'];
  const keepLogs = capture(keep);
  c('cursor-context-mode').uninstall(keep);
  assert.ok(mcpOf(a.cursorHome).mcpServers['context-mode']);
  assert.ok(keepLogs.some(l => /not added by askai, left in place/.test(l)));
  assert.ok(!keep.calls.some(x => x.includes('npm uninstall')), 'a package askai did not install stays');

  const forced = cctx(a, { tools: true, force: true }, { tools });
  capture(forced);
  c('cursor-context-mode').uninstall(forced);
  assert.strictEqual(mcpOf(a.cursorHome).mcpServers['context-mode'], undefined);
  assert.ok(mcpOf(a.cursorHome).mcpServers.other, 'other entries are untouched');
  assert.ok(forced.calls.includes('act npm uninstall -g context-mode'));
}));

test('cursor-context-mode: uninstall removes what askai added; the package only with --tools', () => withDirs(a => {
  const tools = { npm: '/bin/npm' };
  const fakes = { tools, nodeVersion: '24.0.0', act: cmd => { if (cmd === 'npm') tools['context-mode'] = '/bin/context-mode'; return OK; } };
  const ctx = cctx(a, {}, fakes);
  c('cursor-context-mode').install(ctx);

  const un = cctx(a, {}, fakes);
  un.manifest.components['cursor-context-mode'] = ctx.manifest.components['cursor-context-mode'];
  capture(un);
  c('cursor-context-mode').uninstall(un);
  assert.strictEqual(mcpOf(a.cursorHome).mcpServers['context-mode'], undefined);
  assert.ok(!un.calls.some(x => x.includes('npm uninstall')), 'the package stays without --tools');

  const un2 = cctx(a, { tools: true }, fakes);
  un2.manifest.components['cursor-context-mode'] = ctx.manifest.components['cursor-context-mode'];
  capture(un2);
  c('cursor-context-mode').uninstall(un2);
  assert.ok(un2.calls.includes('act npm uninstall -g context-mode'));
}));

test('cursor-context-mode: update touches only what askai set up; dry-run writes nothing', () => withDirs(a => {
  const tools = { npm: '/bin/npm', 'context-mode': '/bin/context-mode' };
  const none = cctx(a, {}, { tools });
  c('cursor-context-mode').update(none);
  assert.deepStrictEqual(none.calls, [], 'not recorded: not touched');
  const rec = cctx(a, {}, { tools });
  rec.manifest.components['cursor-context-mode'] = { mcp: true };
  c('cursor-context-mode').update(rec);
  assert.ok(rec.calls.includes('act npm install -g context-mode@latest'));

  const dry = cctx(a, { dry: true }, { nodeVersion: '24.0.0', tools: { npm: '/bin/npm' } });
  const logs = capture(dry);
  c('cursor-context-mode').install(dry);
  assert.ok(!fs.existsSync(`${a.cursorHome}/mcp.json`), 'dry-run wrote no mcp.json');
  assert.ok(logs.some(l => /^plan: update .*mcp\.json/.test(l)));
}));

test('cursor-serena: adds an ide-context MCP entry, keeps the uv tool with the serena record, removes only the entry', () => withDirs(a => {
  const tools = { uv: '/bin/uv', serena: '/bin/serena' };
  const ctx = cctx(a, {}, { tools });
  capture(ctx);
  assert.strictEqual(c('cursor-serena').detect(ctx).state, 'partial');
  c('cursor-serena').install(ctx);
  const entry = mcpOf(a.cursorHome).mcpServers.serena;
  assert.strictEqual(entry.command, '/bin/serena');
  assert.deepStrictEqual(entry.args.slice(0, 5), ['start-mcp-server', '--context', 'ide', '--project-from-cwd', '--open-web-dashboard']);
  assert.strictEqual(ctx.manifest.components['cursor-serena'].mcp, true);
  assert.strictEqual(ctx.manifest.components.serena, undefined, 'a tool that was already there gets no record');
  assert.strictEqual(c('cursor-serena').detect(ctx).state, 'ok');
  assert.ok(!ctx.calls.some(x => x.includes('uv tool install')));

  const un = cctx(a, { tools: true }, { tools });
  un.manifest.components['cursor-serena'] = ctx.manifest.components['cursor-serena'];
  capture(un);
  c('cursor-serena').uninstall(un);
  assert.strictEqual(mcpOf(a.cursorHome).mcpServers.serena, undefined);
  assert.ok(!un.calls.some(x => x.includes('uv tool uninstall')), 'the uv tool belongs to the serena component');
}));

test('cursor-serena: on a machine without serena the shared install runs and ownership lands on the serena record', () => withDirs(a => {
  const tools = { uv: '/bin/uv' };
  const ctx = cctx(a, {}, { tools, act: (cmd, args) => { if (args[0] === 'tool' && args[1] === 'install') tools.serena = '/bin/serena'; return OK; } });
  capture(ctx);
  c('cursor-serena').install(ctx);
  assert.ok(ctx.calls.includes('act uv tool install -p 3.13 serena-agent'));
  assert.strictEqual(ctx.manifest.components.serena.installedByAskai, true);
  assert.strictEqual(ctx.manifest.components['cursor-serena'].mcp, true);
}));

test('cursor-serena: an entry the user has is kept; without --force it is not removed', () => withDirs(a => {
  write(`${a.cursorHome}/mcp.json`, JSON.stringify({ mcpServers: { serena: { command: 'mine' } } }));
  const tools = { uv: '/bin/uv', serena: '/bin/serena' };
  const ctx = cctx(a, {}, { tools });
  const logs = capture(ctx);
  c('cursor-serena').install(ctx);
  assert.strictEqual(mcpOf(a.cursorHome).mcpServers.serena.command, 'mine');
  assert.strictEqual(ctx.manifest.components['cursor-serena'].mcp, false);
  c('cursor-serena').uninstall(ctx);
  assert.ok(mcpOf(a.cursorHome).mcpServers.serena, 'left in place');
  assert.ok(logs.some(l => /not added by askai, left in place/.test(l)));
  const forced = cctx(a, { force: true }, { tools });
  capture(forced);
  c('cursor-serena').uninstall(forced);
  assert.strictEqual(mcpOf(a.cursorHome).mcpServers.serena, undefined);
}));

// `rtk init -g --agent cursor` is faked: it writes what RTK is documented to write into the temp Cursor home.
const rtkInitFake = (a, { writes = true, fails = false } = {}) => (cmd, args) => {
  if (cmd === 'rtk' && args.includes('--agent')) {
    if (fails) return NO('boom');
    if (writes) {
      const j = fs.existsSync(`${a.cursorHome}/hooks.json`) ? readJson(`${a.cursorHome}/hooks.json`) : { version: 1, hooks: {} };
      j.hooks.beforeShellExecution = [...(j.hooks.beforeShellExecution || []), { command: 'rtk hook cursor' }];
      cfg.writeJson(`${a.cursorHome}/hooks.json`, j);
    }
  }
  return OK;
};
const rtkTools = { rtk: '/bin/rtk', rg: '/bin/rg' };
const rtkProbe = (cmd, args) => (cmd === 'rtk' && args[0] === 'gain' ? OK : NO());

test('cursor-rtk: runs `rtk init --agent cursor` once, records the hook as askai\'s, leaves the rtk binary record alone', () => withDirs(a => {
  const ctx = cctx(a, {}, { tools: rtkTools, probe: rtkProbe, act: rtkInitFake(a) });
  const logs = capture(ctx);
  assert.strictEqual(c('cursor-rtk').detect(ctx).state, 'partial');
  c('cursor-rtk').install(ctx);
  assert.strictEqual(ctx.calls.filter(x => x === 'act rtk init -g --agent cursor --auto-patch').length, 1);
  assert.strictEqual(ctx.manifest.components['cursor-rtk'].hook, true);
  assert.strictEqual(ctx.manifest.components.rtk.installedByAskai, false, 'rtk was already installed');
  assert.strictEqual(c('cursor-rtk').detect(ctx).state, 'ok');
  assert.ok(logs.some(l => /rtk init writes to the real/.test(l)), '--cursor-home only changes where askai looks');

  c('cursor-rtk').install(ctx);
  assert.strictEqual(ctx.calls.filter(x => x.startsWith('act rtk init')).length, 1, 'hook already there: init is not run again');
  assert.strictEqual(ctx.manifest.components['cursor-rtk'].hook, true, 'ownership sticks');
}));

test('cursor-rtk: failures name the cause (init fails, init writes no hook, wrong rtk package)', () => withDirs(a => {
  assert.throws(() => c('cursor-rtk').install(cctx(a, {}, { tools: rtkTools, probe: rtkProbe, act: rtkInitFake(a, { fails: true }) })), /rtk init --agent cursor failed: boom/);
  assert.throws(() => c('cursor-rtk').install(cctx(a, {}, { tools: rtkTools, probe: rtkProbe, act: rtkInitFake(a, { writes: false }) })), /no rtk hook is in .*hooks\.json/);
  assert.throws(() => c('cursor-rtk').install(cctx(a, {}, { tools: rtkTools, probe: () => NO(), act: rtkInitFake(a) })), /not rtk-ai\/rtk/);
  assert.ok(!fs.existsSync(`${a.cursorHome}/hooks.json`), 'no hook written on a failed check');
}));

test('cursor-rtk: uninstall removes only the RTK entries and only when askai registered them (or --force)', () => withDirs(a => {
  write(`${a.cursorHome}/hooks.json`, JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'rtk hook cursor' }, { command: 'node mine.js' }], stop: [{ command: 'echo done' }] } }));
  const own = cctx(a, {}, { tools: rtkTools });
  const logs = capture(own);
  c('cursor-rtk').uninstall(own);
  assert.strictEqual(hooksOf(a).hooks.beforeShellExecution.length, 2, 'the user\'s own RTK hook stays');
  assert.ok(logs.some(l => /not registered by askai, left in place/.test(l)));

  const mine = cctx(a, {}, { tools: rtkTools });
  mine.manifest.components['cursor-rtk'] = { hook: true };
  capture(mine);
  c('cursor-rtk').uninstall(mine);
  assert.deepStrictEqual(hooksOf(a).hooks.beforeShellExecution, [{ command: 'node mine.js' }]);
  assert.deepStrictEqual(hooksOf(a).hooks.stop, [{ command: 'echo done' }], 'other events are untouched');
  assert.strictEqual(c('cursor-rtk').detect(mine).state, 'partial');
}));

test('cursor-rtk: update puts back a missing hook only for a recorded setup; dry-run does nothing', () => withDirs(a => {
  const fakes = { tools: rtkTools, probe: rtkProbe, act: rtkInitFake(a) };
  const none = cctx(a, {}, fakes);
  c('cursor-rtk').update(none);
  assert.deepStrictEqual(none.calls, []);
  const rec = cctx(a, {}, fakes);
  rec.manifest.components['cursor-rtk'] = { hook: true };
  capture(rec);
  c('cursor-rtk').update(rec);
  assert.ok(rec.calls.includes('act rtk init -g --agent cursor --auto-patch'));
  assert.strictEqual(cursor.rtkHooked(rec), true);

  const dry = cctx(a, { dry: true }, fakes);
  dry.manifest.components['cursor-rtk'] = { hook: true };
  c('cursor-rtk').update(dry);
  assert.deepStrictEqual(dry.calls, []);
}));

// ---- derived Cursor text ------------------------------------------------------------------------------------------------
test('presence and cursorProjectFiles: Cursor rules mention only the tools Cursor has, and follow the recorded caveman level', () => withDirs(a => {
  const ctx = cctx(a, {}, { tools: { uv: '/bin/uv' } });
  assert.deepStrictEqual(comps.presence(ctx, 'cursor'), []);
  const bare = comps.cursorProjectFiles(ctx, 'coding').map(f => f.text).join('\n');
  assert.doesNotMatch(bare, /ctx_/);

  write(`${a.cursorHome}/mcp.json`, JSON.stringify({ mcpServers: { 'context-mode': { command: 'context-mode' }, serena: { command: '/bin/serena' } } }));
  const both = cctx(a, {}, { tools: { uv: '/bin/uv', serena: '/bin/serena', markitdown: '/bin/markitdown' } });
  assert.deepStrictEqual(comps.presence(both, 'cursor').sort(), ['context-mode', 'markitdown', 'serena']);
  const withTools = comps.cursorProjectFiles(both, 'coding').map(f => f.text).join('\n');
  assert.match(withTools, /ctx_/, 'the tools line names Context Mode tools once the MCP entry exists');
  assert.notStrictEqual(withTools, bare);

  const files = comps.cursorProjectFiles(both, 'minimal');
  assert.deepStrictEqual(files.map(f => f.name), ['askai-tokens.mdc']);
  both.manifest.components.caveman = { level: 'ultra' };
  const ultra = comps.cursorProjectFiles(both, 'minimal')[0].text;
  const flag = comps.cursorProjectFiles(cctx(a, { caveman: 'lite' }, { tools: {} }), 'minimal')[0].text;
  assert.notStrictEqual(ultra, flag, 'the caveman level changes the terse section');
}));

test('refreshDerived: rewrites the Cursor project rules of recorded projects when the tool set changes; skips missing dirs; dry-run writes nothing', () => withDirs(a => {
  const fakes = { tools: { uv: '/bin/uv' } };
  const ctx = cctx(a, {}, fakes);
  capture(ctx);
  comps.syncCursorProject(ctx, a.proj, 'coding');
  ctx.manifest.cursorProjects = { [a.proj]: { profile: 'coding' }, [`${a.proj}-gone`]: { profile: 'coding' } };
  const tokens = path.join(a.proj, '.cursor', 'rules', 'askai-tokens.mdc');
  const before = fs.readFileSync(tokens, 'utf8');

  write(`${a.cursorHome}/mcp.json`, JSON.stringify({ mcpServers: { 'context-mode': { command: 'context-mode' } } }));
  const dry = cctx(a, { dry: true }, fakes);
  dry.manifest.cursorProjects = ctx.manifest.cursorProjects;
  comps.refreshDerived(dry);
  assert.strictEqual(fs.readFileSync(tokens, 'utf8'), before, 'dry-run wrote nothing');

  const live = cctx(a, {}, fakes);
  live.manifest.cursorProjects = ctx.manifest.cursorProjects;
  capture(live);
  comps.refreshDerived(live);
  assert.notStrictEqual(fs.readFileSync(tokens, 'utf8'), before, 'the token rule now names the new tool');
  assert.ok(!fs.existsSync(`${a.proj}-gone`), 'a project dir that is gone is not recreated');
}));

// ---- markitdown -------------------------------------------------------------------------------------------------------
const MD_SPEC = 'markitdown[pdf,docx,pptx,xlsx,xls]';
function uvFakes(name, tools = { uv: '/bin/uv' }) {
  return { tools, act: (cmd, args) => { if (args[0] === 'tool' && args[1] === 'install') tools[name] = `/bin/${name}`; return OK; } };
}
const pathEdits = ctx => { const e = []; ctx.editPath = (d, add) => { e.push([d, add]); return 'changed'; }; return e; };

test('markitdown: installs through uv with the PDF/Office extras, puts uv\'s bin dir on PATH, records ownership', () => withDirs(a => {
  const ctx = cctx(a, {}, uvFakes('markitdown'));
  const edits = pathEdits(ctx);
  capture(ctx);
  assert.strictEqual(c('markitdown').detect(ctx).state, 'missing');
  c('markitdown').install(ctx);
  assert.ok(ctx.calls.includes(`act uv tool install -p 3.13 ${MD_SPEC}`));
  assert.deepStrictEqual(edits, [[path.dirname('/bin/markitdown'), true]]);
  const rec = ctx.manifest.components.markitdown;
  assert.deepStrictEqual([rec.installedByAskai, rec.pathDir], [true, path.dirname('/bin/markitdown')]);
  assert.strictEqual(c('markitdown').detect(ctx).state, 'ok');
  c('markitdown').install(ctx);
  assert.strictEqual(ctx.calls.filter(x => x.includes('uv tool install')).length, 1, 'already installed: not installed twice');
}));

test('markitdown: a failed uv install is an error; one the user made stays theirs; a hand-finished failed run is adopted', () => withDirs(a => {
  const fail = cctx(a, {}, { tools: { uv: '/bin/uv' }, act: () => NO('nope') });
  capture(fail);
  pathEdits(fail);
  assert.throws(() => c('markitdown').install(fail), /uv tool install .* failed/);
  assert.strictEqual(fail.manifest.components.markitdown, undefined);

  const theirs = cctx(a, {}, { tools: { uv: '/bin/uv', markitdown: '/bin/markitdown' } });
  capture(theirs); pathEdits(theirs);
  c('markitdown').install(theirs);
  assert.strictEqual(theirs.manifest.components.markitdown.installedByAskai, false);
  assert.ok(!theirs.calls.some(x => x.includes('uv tool install')));

  const hand = cctx(a, {}, { tools: { uv: '/bin/uv', markitdown: '/bin/markitdown' } });
  hand.manifest.runs = [{ command: 'install', results: [{ id: 'markitdown', result: 'failed', detail: `uv tool install ${MD_SPEC} failed (exit 2)` }] }];
  const logs = capture(hand); pathEdits(hand);
  c('markitdown').install(hand);
  assert.strictEqual(hand.manifest.components.markitdown.installedByAskai, true);
  assert.ok(logs.some(l => /recording it as installed by askai/.test(l)));
}));

test('markitdown: uninstall keeps the tool without --tools; with --tools removes it only if askai installed it (or --force), and undoes PATH', () => withDirs(a => {
  const tools = { uv: '/bin/uv', markitdown: '/bin/markitdown' };
  const rec = { installedByAskai: true, pathDir: '/bin' };

  const noTools = cctx(a, {}, { tools });
  noTools.manifest.components.markitdown = rec;
  noTools.editPath = () => { throw new Error('PATH stays without --tools'); };
  capture(noTools);
  c('markitdown').uninstall(noTools);
  assert.deepStrictEqual(noTools.calls, []);

  const mine = cctx(a, { tools: true }, { tools });
  mine.manifest.components.markitdown = rec;
  const edits = pathEdits(mine);
  capture(mine);
  c('markitdown').uninstall(mine);
  assert.ok(mine.calls.includes('act uv tool uninstall markitdown'));
  assert.deepStrictEqual(edits, [['/bin', false]]);

  const theirs = cctx(a, { tools: true }, { tools });
  theirs.manifest.components.markitdown = { installedByAskai: false };
  const logs = capture(theirs);
  c('markitdown').uninstall(theirs);
  assert.ok(!theirs.calls.some(x => x.includes('uv tool uninstall')));
  assert.ok(logs.some(l => /not installed by askai, left in place/.test(l)));

  const forced = cctx(a, { tools: true, force: true }, { tools });
  capture(forced);
  c('markitdown').uninstall(forced);
  assert.ok(forced.calls.includes('act uv tool uninstall markitdown'));
}));

test('markitdown and serena share uv\'s bin dir: the PATH entry is handed over, then removed with the last tool', () => withDirs(a => {
  const tools = { uv: '/bin/uv', serena: '/bin/serena', markitdown: '/bin/markitdown' };
  const s = cctx(a, { tools: true }, { tools });
  s.manifest.components.serena = { installedByAskai: true, pathDir: '/bin' };
  s.manifest.components.markitdown = { installedByAskai: true };
  const edits = pathEdits(s);
  const logs = capture(s);
  c('serena').uninstall(s);
  assert.deepStrictEqual(edits, [], 'markitdown still needs the entry');
  assert.strictEqual(s.manifest.components.markitdown.pathDir, '/bin', 'the record moved to markitdown');
  assert.ok(logs.some(l => /kept, markitdown still uses it/.test(l)));

  delete tools.serena;
  const m = cctx(a, { tools: true }, { tools });
  m.manifest.components.markitdown = s.manifest.components.markitdown;
  const e2 = pathEdits(m);
  capture(m);
  c('markitdown').uninstall(m);
  assert.deepStrictEqual(e2, [['/bin', false]], 'the last tool removes the entry');
}));

test('markitdown: update needs uv; dry-run installs nothing', () => withDirs(a => {
  assert.throws(() => c('markitdown').update(cctx(a, {}, { tools: {} })), /uv not found/);
  const up = cctx(a, {}, { tools: { uv: '/bin/uv' } });
  c('markitdown').update(up);
  assert.ok(up.calls.includes('act uv tool upgrade markitdown'));
  const dry = cctx(a, { dry: true }, { tools: { uv: '/bin/uv' } });
  capture(dry);
  pathEdits(dry);
  c('markitdown').install(dry);
  assert.ok(!fs.existsSync(`${a.home}/askai/manifest.json`), 'dry-run saves no manifest (the in-memory record is discarded)');
}));

// ---- ccusage ----------------------------------------------------------------------------------------------------------
test('ccusage: installs the pinned npm version, records ownership, and needs npm and a PATH that sees it', () => withDirs(a => {
  const tools = { npm: '/bin/npm' };
  const ctx = cctx(a, {}, { tools, act: cmd => { if (cmd === 'npm') tools.ccusage = '/bin/ccusage'; return OK; } });
  assert.strictEqual(c('ccusage').detect(ctx).state, 'missing');
  c('ccusage').install(ctx);
  assert.ok(ctx.calls.includes(`act npm install -g ccusage@${comps.CCUSAGE_VERSION}`));
  assert.strictEqual(ctx.manifest.components.ccusage.installedByAskai, true);
  assert.strictEqual(c('ccusage').detect(ctx).state, 'ok');
  c('ccusage').install(ctx);
  assert.strictEqual(ctx.calls.filter(x => x.includes('npm install')).length, 1);

  assert.throws(() => c('ccusage').install(cctx(a, {}, { tools: {} })), /npm not found/);
  assert.throws(() => c('ccusage').install(cctx(a, {}, { tools: { npm: '/bin/npm' }, act: () => NO() })), /npm install -g ccusage failed/);
  assert.throws(() => c('ccusage').install(cctx(a, {}, { tools: { npm: '/bin/npm' }, act: () => OK })), /not on PATH yet/);
}));

test('ccusage: a copy the user already had is not askai\'s; uninstall --tools removes only askai\'s (or --force)', () => withDirs(a => {
  const tools = { npm: '/bin/npm', ccusage: '/bin/ccusage' };
  const pre = cctx(a, {}, { tools });
  c('ccusage').install(pre);
  assert.strictEqual(pre.manifest.components.ccusage.installedByAskai, false);
  assert.ok(!pre.calls.some(x => x.includes('npm install')));

  const keep = cctx(a, { tools: true }, { tools });
  keep.manifest.components.ccusage = pre.manifest.components.ccusage;
  const logs = capture(keep);
  c('ccusage').uninstall(keep);
  assert.ok(!keep.calls.some(x => x.includes('npm uninstall')));
  assert.ok(logs.some(l => /not installed by askai, left in place/.test(l)));

  const mine = cctx(a, { tools: true }, { tools });
  mine.manifest.components.ccusage = { installedByAskai: true };
  c('ccusage').uninstall(mine);
  assert.ok(mine.calls.includes('act npm uninstall -g ccusage'));

  const noTools = cctx(a, {}, { tools });
  noTools.manifest.components.ccusage = { installedByAskai: true };
  c('ccusage').uninstall(noTools);
  assert.deepStrictEqual(noTools.calls, [], 'without --tools nothing is removed');

  const forced = cctx(a, { tools: true, force: true }, { tools });
  c('ccusage').uninstall(forced);
  assert.ok(forced.calls.includes('act npm uninstall -g ccusage'));
}));

test('ccusage: update moves to the latest release and needs npm', () => withDirs(a => {
  assert.throws(() => c('ccusage').update(cctx(a, {}, { tools: {} })), /npm not found/);
  const up = cctx(a, {}, { tools: { npm: '/bin/npm' } });
  c('ccusage').update(up);
  assert.ok(up.calls.includes('act npm install -g ccusage@latest'));
}));

// ---- CLI flows (dry-run and file-only paths: nothing is installed) ---------------------------------------------------------
test('install --dry-run --target both --profile full lists the Cursor and opt-in tools and writes nothing', () => withDirs(a => {
  const r = cli(['install', '--dry-run', '--profile', 'full', '--rtk', '--context-mode', '--target', 'both', '--claude-home', a.home, '--cursor-home', a.cursorHome, '--no-path', '--yes']);
  for (const id of ['cursor-rtk', 'cursor-context-mode', 'cursor-serena', 'markitdown', 'ccusage', 'rules']) assert.match(r.out, new RegExp(`\\b${id}\\b`), `${id} is listed`);
  assert.match(r.out, /profile: full/);
  assert.match(r.out, /mcp\.json and hooks\.json/);
  // The real Claude CLI probe creates .claude.json and backups/; telemetry stays disabled and AskAI writes nothing.
  assert.deepStrictEqual(fs.readdirSync(a.home).filter(n => n !== '.claude.json' && n !== 'backups'), [], 'dry-run wrote nothing into the claude home');
  assert.deepStrictEqual(fs.readdirSync(a.cursorHome), [], 'nor into the Cursor home');
}));

test('install --dry-run --target cursor: only Cursor components, no Claude-only ones', () => withDirs(a => {
  const r = cli(['install', '--dry-run', '--profile', 'coding', '--target', 'cursor', '--claude-home', a.home, '--cursor-home', a.cursorHome, '--no-path', '--yes']);
  assert.match(r.out, /cursor-serena/);
  assert.doesNotMatch(r.out, /\bstatusline\b|\bbaseline\b|\bcaveman\b/);
  assert.doesNotMatch(r.out, /askai-status/, 'no Claude slash commands for a Cursor-only target');
  assert.deepStrictEqual(fs.readdirSync(a.cursorHome), []);
}));

test('install --target cursor without a Cursor directory in a sandbox is an error, not a silent no-op', () => {
  const home = tmpHome();
  try {
    const r = cli(['install', '--dry-run', '--target', 'cursor', '--claude-home', home, '--no-path', '--yes']);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err + r.out, /cursor/i);
    assert.deepStrictEqual(fs.readdirSync(home), []);
  } finally { rm(home); }
});

test('full uninstall removes the Cursor rule files `askai project` wrote and forgets the projects; the user\'s rules stay', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts']);
  assert.strictEqual(project(a).code, 0);
  const own = path.join(a.proj, '.cursor', 'rules', 'my-rule.mdc');
  write(own, 'keep me');
  const r = cli(['uninstall', '--claude-home', a.home, '--cursor-home', a.cursorHome, '--no-path', '--yes']);
  assert.strictEqual(r.code, 0, r.err + r.out);
  assert.match(r.out, /\[cursor project\]/);
  assert.deepStrictEqual(rulesIn(a.proj), ['my-rule.mdc']);
  assert.strictEqual(fs.readFileSync(own, 'utf8'), 'keep me');
}));

test('uninstall --only leaves the Cursor project rules alone', () => withDirs(a => {
  touch(a.proj, ['a.ts', 'b.ts', 'c.ts']);
  assert.strictEqual(project(a).code, 0);
  const r = cli(['uninstall', '--only', 'ccusage', '--claude-home', a.home, '--cursor-home', a.cursorHome, '--no-path', '--yes']);
  assert.strictEqual(r.code, 0, r.err + r.out);
  assert.deepStrictEqual(rulesIn(a.proj), ['askai-coding.mdc', 'askai-tokens.mdc']);
}));
