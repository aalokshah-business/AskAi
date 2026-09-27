'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../lib/claude-config');
const comps = require('../lib/components');
const { tmpHome, rm, write, readJson, makeCtx, fs, path } = require('./helpers');

const c = id => comps.byId(id);
// Run fn(home) against a temp claude home, always cleaned up.
function withHome(fn) {
  const home = tmpHome();
  try { return fn(home); } finally { rm(home); }
}
function capture(ctx) {
  const logs = [];
  ctx.log = { info: m => logs.push(m), warn: m => logs.push(`warn: ${m}`), step: () => {}, plan: () => {} };
  return logs;
}
const settingsOf = home => readJson(`${home}/settings.json`);

test('baseline: installs keys, keeps user values, removes legacy hooks, uninstall only removes what it added', () => withHome(home => {
  write(`${home}/settings.json`, JSON.stringify({
    env: { CLAUDE_CODE_SUBAGENT_MODEL: 'opus', KEEP: 'x' },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'powershell -File askai-hook.ps1' }] }] },
  }));
  const ctx = makeCtx(home);
  c('baseline').install(ctx);
  let s = settingsOf(home);
  assert.strictEqual(s.env.CLAUDE_CODE_SUBAGENT_MODEL, 'opus', 'user model choice not overridden');
  assert.strictEqual(s.autoCompactWindow, 150000);
  assert.ok(!s.hooks, 'legacy hook removed');
  assert.strictEqual(c('baseline').detect(ctx).state, 'ok');
  assert.ok(ctx.manifest.settings.length > 0);
  assert.ok(ctx.manifest.settings.every(e => e.key !== 'env.CLAUDE_CODE_SUBAGENT_MODEL'), 'key the user already had is not in the manifest');

  const before = fs.readFileSync(`${home}/settings.json`, 'utf8');
  c('baseline').install(ctx);
  assert.strictEqual(fs.readFileSync(`${home}/settings.json`, 'utf8'), before, 'second install writes nothing');

  s.autoCompactWindow = 99999; // user changed it after install
  write(`${home}/settings.json`, JSON.stringify(s));
  c('baseline').uninstall(ctx);
  s = settingsOf(home);
  assert.strictEqual(s.autoCompactWindow, 99999, 'user-changed value survives uninstall');
  assert.strictEqual(s.env.KEEP, 'x');
  assert.ok(!s.skillOverrides, 'overrides askai added are gone');
}));

test('baseline: dry-run changes nothing', () => withHome(home => {
  write(`${home}/settings.json`, '{"a":1}');
  const ctx = makeCtx(home, { dry: true });
  c('baseline').install(ctx);
  assert.strictEqual(fs.readFileSync(`${home}/settings.json`, 'utf8'), '{"a":1}');
  assert.ok(!fs.existsSync(`${home}/askai`), 'no backups or manifest in dry-run');
}));

test('caveman: block added once, existing CLAUDE.md preserved and backed up, removal restores the file', () => withHome(home => {
  const original = '# Mine\nKeep this.\n';
  write(`${home}/CLAUDE.md`, original);
  const ctx = makeCtx(home, { caveman: 'full' });
  c('caveman').install(ctx);
  const after = fs.readFileSync(`${home}/CLAUDE.md`, 'utf8');
  assert.ok(after.startsWith(original) && after.includes('askai:begin') && /Terse output \(caveman, full\)/.test(after));
  assert.strictEqual(c('caveman').detect(ctx).state, 'ok');
  const backups = fs.readdirSync(`${home}/askai/backups`);
  assert.strictEqual(fs.readFileSync(`${home}/askai/backups/${backups[0]}/CLAUDE.md`, 'utf8'), original);

  c('caveman').install(ctx);
  assert.strictEqual(fs.readFileSync(`${home}/CLAUDE.md`, 'utf8'), after, 'idempotent');
  c('caveman').uninstall(ctx);
  assert.strictEqual(fs.readFileSync(`${home}/CLAUDE.md`, 'utf8'), original);
}));

test('caveman: an existing terse directive is not duplicated', () => withHome(home => {
  write(`${home}/CLAUDE.md`, '# Terse output (caveman, full)\nmine\n');
  const ctx = makeCtx(home, { caveman: 'full' });
  c('caveman').install(ctx);
  const text = fs.readFileSync(`${home}/CLAUDE.md`, 'utf8');
  assert.strictEqual((text.match(/Terse output \(caveman/g) || []).length, 1);
  assert.ok(text.includes('Token rules (askai)'));
}));

test('statusline: sets when free, leaves another statusLine alone, uninstall removes only ours', () => withHome(home => {
  const ctx = makeCtx(home);
  c('statusline').install(ctx);
  assert.match(settingsOf(home).statusLine.command, /askai\.js" statusline$/);
  assert.strictEqual(c('statusline').detect(ctx).state, 'ok');
  c('statusline').uninstall(ctx);
  assert.ok(!('statusLine' in settingsOf(home)));

  write(`${home}/settings.json`, JSON.stringify({ statusLine: { type: 'command', command: 'my-line.sh' } }));
  const ctx2 = makeCtx(home);
  c('statusline').install(ctx2);
  assert.strictEqual(c('statusline').detect(ctx2).state, 'other');
  c('statusline').uninstall(ctx2);
  assert.strictEqual(settingsOf(home).statusLine.command, 'my-line.sh');
}));

test('rtk: already installed + gain works -> only runs init, records not-installed-by-askai, hook flagged as askai-registered', () => withHome(home => {
  const fakes = {
    tools: { rtk: '/bin/rtk', rg: '/bin/rg' },
    probe: () => ({ ok: true, status: 0, stdout: 'rtk 0.1', stderr: '', error: null }),
    act: (cmd, args, ctx) => {
      if (cmd === 'rtk' && args[0] === 'init' && args.includes('--auto-patch')) {
        const s = ctx.settings();
        s.hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] };
        cfg.writeJson(ctx.paths.settings, s);
      }
      return { ok: true, status: 0, stdout: '', stderr: '', error: null };
    },
  };
  const ctx = makeCtx(home, {}, fakes);
  assert.strictEqual(c('rtk').detect(ctx).state, 'partial');
  c('rtk').install(ctx);
  assert.ok(ctx.calls.includes('act rtk init -g --auto-patch'));
  assert.ok(!ctx.calls.some(x => x.includes('winget')), 'no winget when rtk already present');
  assert.strictEqual(ctx.manifest.components.rtk.installedByAskai, false);
  assert.strictEqual(ctx.manifest.components.rtk.hook, true);
  assert.strictEqual(c('rtk').detect(ctx).state, 'ok');

  ctx.calls.length = 0;
  c('rtk').install(ctx);
  assert.ok(!ctx.calls.some(x => x.startsWith('act')), 'second install runs nothing');
}));

test('rtk: gain failing after install is reported as the wrong package', () => withHome(home => {
  const ctx = makeCtx(home, {}, { tools: { rtk: '/bin/rtk', rg: '/bin/rg' } });
  assert.throws(() => c('rtk').install(ctx), /rtk gain.*fails/);
}));

test('rtk: hook the user set up themselves is left alone on uninstall unless --force', () => withHome(home => {
  write(`${home}/settings.json`, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } }));
  const fakes = { tools: { rtk: '/bin/rtk' }, probe: () => ({ ok: true, status: 0, stdout: 'rtk', stderr: '', error: null }) };
  const ctx = makeCtx(home, {}, fakes);
  const logs = capture(ctx);
  c('rtk').uninstall(ctx);
  assert.ok(!ctx.calls.some(x => x.includes('--uninstall')));
  assert.ok(logs.some(l => /left in place/.test(l)));

  const forced = makeCtx(home, { force: true }, fakes);
  c('rtk').uninstall(forced);
  assert.ok(forced.calls.includes('act rtk init -g --uninstall'));
  assert.ok(!('hooks' in settingsOf(home)), 'fallback removes the hook when rtk init --uninstall leaves it');
}));

test('context-mode: refuses old Node; skips when already enabled; installs via marketplace + plugin otherwise', () => withHome(home => {
  assert.throws(() => c('context-mode').install(makeCtx(home, {}, { nodeVersion: '20.11.0' })), /too old/);

  write(`${home}/settings.json`, JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': true } }));
  const pre = makeCtx(home, {}, { nodeVersion: '24.0.0' });
  c('context-mode').install(pre);
  assert.strictEqual(pre.calls.filter(x => x.startsWith('act')).length, 0);
  assert.strictEqual(pre.manifest.components['context-mode'].installedByAskai, false);
}));

test('context-mode: fresh install runs marketplace add + plugin install and verifies it is enabled', () => withHome(home => {
  const fakes = {
    nodeVersion: '24.0.0',
    act: (cmd, args, ctx) => {
      if (args[0] === 'plugin' && args[1] === 'install') {
        const s = ctx.settings();
        s.enabledPlugins = { ...(s.enabledPlugins || {}), [args[2]]: true };
        cfg.writeJson(ctx.paths.settings, s);
      }
      return { ok: true, status: 0, stdout: '', stderr: '', error: null };
    },
  };
  const ctx = makeCtx(home, {}, fakes);
  c('context-mode').install(ctx);
  assert.deepStrictEqual(ctx.calls.filter(x => x.startsWith('act')), [
    'act /fake/claude plugin marketplace add mksglu/context-mode',
    'act /fake/claude plugin install context-mode@context-mode',
  ]);
  assert.strictEqual(ctx.manifest.components['context-mode'].installedByAskai, true);
  assert.strictEqual(c('context-mode').detect(ctx).state, 'ok');

  // uninstall: askai added it -> removed (plugin + marketplace)
  ctx.calls.length = 0;
  c('context-mode').uninstall(ctx);
  assert.ok(ctx.calls.includes('act /fake/claude plugin uninstall context-mode@context-mode'));
  assert.ok(ctx.calls.includes('act /fake/claude plugin marketplace remove context-mode'));
}));

test('context-mode: failed install surfaces an error instead of recording success', () => withHome(home => {
  const fakes = { nodeVersion: '24.0.0', act: () => ({ ok: false, status: 1, stdout: '', stderr: 'boom', error: null }) };
  const ctx = makeCtx(home, {}, fakes);
  assert.throws(() => c('context-mode').install(ctx), /marketplace add mksglu\/context-mode failed: boom/);
  assert.ok(!ctx.manifest.components['context-mode']);
}));

test('context-mode: a plugin the user installed is not removed without --force', () => withHome(home => {
  write(`${home}/settings.json`, JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': true } }));
  const ctx = makeCtx(home, {}, { nodeVersion: '24.0.0' });
  const logs = capture(ctx);
  c('context-mode').uninstall(ctx);
  assert.ok(!ctx.calls.some(x => x.startsWith('act')));
  assert.ok(logs.some(l => /left in place/.test(l)));
  const forced = makeCtx(home, { force: true }, { nodeVersion: '24.0.0' });
  c('context-mode').uninstall(forced);
  assert.ok(forced.calls.some(x => x.includes('plugin uninstall context-mode@context-mode')));
}));

test('opt-in components: caveman-plugin, markitdown, ccusage and rules; the Cursor mirrors are not opt-in', () => {
  const optIn = comps.ALL.filter(x => x.optIn).map(x => x.id).sort();
  assert.deepStrictEqual(optIn, ['caveman-plugin', 'ccusage', 'markitdown', 'rules']);
  for (const id of ['caveman-plugin', 'markitdown', 'ccusage']) assert.ok(c(id).optInFlag, `${id} has a flag`);
  for (const id of ['cursor-rtk', 'cursor-context-mode', 'cursor-serena']) {
    assert.strictEqual(c(id).host, 'cursor');
    assert.ok(!c(id).optIn);
  }
});

test('serena: registers the MCP server at user scope with the dashboard off; uninstall only removes it when askai added it', () => withHome(home => {
  const fakes = {
    tools: { serena: '/bin/serena' },
    act: (cmd, args, ctx) => {
      if (args[0] === 'mcp' && args[1] === 'add') {
        const j = cfg.readJson(ctx.paths.userJson);
        j.mcpServers = { ...(j.mcpServers || {}), serena: { command: args[6], args: args.slice(7) } };
        cfg.writeJson(ctx.paths.userJson, j);
      }
      if (args[0] === 'mcp' && args[1] === 'remove') {
        const j = cfg.readJson(ctx.paths.userJson);
        delete j.mcpServers.serena;
        cfg.writeJson(ctx.paths.userJson, j);
      }
      return { ok: true, status: 0, stdout: '', stderr: '', error: null };
    },
  };
  const ctx = makeCtx(home, {}, fakes);
  assert.strictEqual(c('serena').detect(ctx).state, 'partial');
  c('serena').install(ctx);
  const add = ctx.calls.find(x => x.includes('mcp add'));
  assert.match(add, /mcp add --scope user serena -- \/bin\/serena start-mcp-server --context claude-code --project-from-cwd --open-web-dashboard False/);
  assert.ok(!ctx.calls.some(x => x.includes('uv tool install')), 'binary already present: no install');
  assert.strictEqual(ctx.manifest.components.serena.mcp, true);
  assert.strictEqual(c('serena').detect(ctx).state, 'ok');
  c('serena').install(ctx);
  assert.strictEqual(ctx.calls.filter(x => x.includes('mcp add')).length, 1, 'no second registration');

  c('serena').uninstall(ctx);
  assert.ok(ctx.calls.some(x => x.includes('mcp remove --scope user serena')));

  // user registered it themselves -> left alone
  write(`${home}/.claude.json`, JSON.stringify({ mcpServers: { serena: { command: 'x' } } }));
  const other = makeCtx(home, {}, fakes);
  const logs = capture(other);
  c('serena').uninstall(other);
  assert.ok(!other.calls.some(x => x.includes('mcp remove')));
  assert.ok(logs.some(l => /left in place/.test(l)));
}));

// ---- serena: uv python link repair, ownership, user PATH -----------------------------------------------------------
const OK = { ok: true, status: 0, stdout: '', stderr: '', error: null };
const NO = (stderr = '') => ({ ok: false, status: 2, stdout: '', stderr, error: null });
const FULL = 'cpython-3.13.15-windows-x86_64-none', MINOR = 'cpython-3.13-windows-x86_64-none';
const present = p => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };

// A fake uv python dir holding one real interpreter dir (with a marker file) and, optionally, its minor-version link.
function pythonDir(home, { link = 'valid' } = {}) {
  const dir = `${home}/uv-python`;
  write(`${dir}/${FULL}/python.exe`, 'interpreter');
  if (link !== 'none') fs.symlinkSync(`${dir}/${FULL}`, `${dir}/${MINOR}`, 'junction');
  if (link === 'dangling') fs.rmSync(`${dir}/${FULL}`, { recursive: true, force: true }); // the link now points at nothing
  return dir;
}

// Fakes for a machine without serena: `uv tool install` results come from script(n) (n = 1-based attempt); success puts serena on PATH.
function serenaFakes({ pyDir, script = () => OK, mcpAddFails = false, tools = { uv: '/bin/uv' } }) {
  let installs = 0;
  return {
    tools,
    probe: (cmd, args) => (args[0] === 'python' && args[1] === 'dir' && pyDir ? { ...OK, stdout: `${pyDir}\n` } : NO()),
    act: (cmd, args, ctx) => {
      if (args[0] === 'tool' && args[1] === 'install') {
        const r = script(++installs);
        if (r.ok) tools.serena = '/bin/serena';
        return r;
      }
      if (args[0] === 'mcp' && args[1] === 'add') {
        if (mcpAddFails) return NO('boom');
        const j = cfg.readJson(ctx.paths.userJson);
        j.mcpServers = { ...(j.mcpServers || {}), serena: { command: args[6] } };
        cfg.writeJson(ctx.paths.userJson, j);
      }
      if (args[0] === 'mcp' && args[1] === 'remove') {
        const j = cfg.readJson(ctx.paths.userJson);
        delete j.mcpServers.serena;
        cfg.writeJson(ctx.paths.userJson, j);
      }
      return OK;
    },
  };
}
const installCalls = ctx => ctx.calls.filter(x => x.startsWith('act uv tool install'));

test('serena: a dangling uv python minor-version link is removed before install; the real interpreter dir is kept', () => withHome(home => {
  const pyDir = pythonDir(home, { link: 'dangling' });
  assert.ok(present(`${pyDir}/${MINOR}`) && !present(`${pyDir}/${FULL}`), 'setup: link exists, target gone');
  const ctx = makeCtx(home, {}, serenaFakes({ pyDir }));
  capture(ctx);
  c('serena').install(ctx);
  assert.ok(!present(`${pyDir}/${MINOR}`), 'stale link removed');
  assert.strictEqual(installCalls(ctx).length, 1, 'installed once, no retry needed');
  assert.strictEqual(ctx.manifest.components.serena.installedByAskai, true);
}));

test('serena: a valid link is left alone when the install works', () => withHome(home => {
  const pyDir = pythonDir(home);
  const ctx = makeCtx(home, {}, serenaFakes({ pyDir }));
  capture(ctx);
  c('serena').install(ctx);
  assert.ok(present(`${pyDir}/${MINOR}`), 'valid link kept');
  assert.strictEqual(fs.readFileSync(`${pyDir}/${FULL}/python.exe`, 'utf8'), 'interpreter');
}));

test('serena: uv naming the missing-target error triggers a link repair and one more attempt; the target dir survives', () => withHome(home => {
  const pyDir = pythonDir(home);
  const error = `error: Missing expected target directory for Python minor version link at ${path.join(pyDir, FULL)}`;
  const ctx = makeCtx(home, {}, serenaFakes({ pyDir, script: n => (n < 3 ? NO(error) : OK) }));
  const logs = capture(ctx);
  c('serena').install(ctx);
  assert.strictEqual(installCalls(ctx).length, 3, 'live attempt, captured attempt, retry after the repair');
  assert.ok(!present(`${pyDir}/${MINOR}`), 'the named link was removed');
  assert.strictEqual(fs.readFileSync(`${pyDir}/${FULL}/python.exe`, 'utf8'), 'interpreter', 'link target untouched');
  assert.ok(logs.some(l => /removed stale python link/.test(l) && /left alone/.test(l)));
}));

test('serena: an unrelated uv failure throws after one captured re-run and touches no links', () => withHome(home => {
  const pyDir = pythonDir(home);
  const ctx = makeCtx(home, {}, serenaFakes({ pyDir, script: () => NO('error: network unreachable') }));
  capture(ctx);
  assert.throws(() => c('serena').install(ctx), /uv tool install serena-agent failed \(exit 2\)/);
  assert.strictEqual(installCalls(ctx).length, 2);
  assert.ok(present(`${pyDir}/${MINOR}`), 'link untouched');
  assert.ok(!ctx.manifest.components.serena, 'nothing recorded for a failed install');
}));

test('serena: a link error that names a path outside uv\'s python dir is ignored', () => withHome(home => {
  const pyDir = pythonDir(home);
  const other = `${home}/elsewhere`;
  write(`${other}/${FULL}/python.exe`, 'x');
  fs.symlinkSync(`${other}/${FULL}`, `${other}/${MINOR}`, 'junction');
  const error = `error: Missing expected target directory for Python minor version link at ${path.join(other, FULL)}`;
  const ctx = makeCtx(home, {}, serenaFakes({ pyDir, script: () => NO(error) }));
  capture(ctx);
  assert.throws(() => c('serena').install(ctx), /failed/);
  assert.ok(present(`${other}/${MINOR}`) && present(`${pyDir}/${MINOR}`));
  assert.strictEqual(installCalls(ctx).length, 2, 'no retry: nothing was repaired');
}));

test('serena: ownership is recorded as soon as uv installs it, so uninstall --tools works even if the MCP step then fails', () => withHome(home => {
  const fakes = serenaFakes({ mcpAddFails: true });
  const ctx = makeCtx(home, {}, fakes);
  capture(ctx);
  assert.throws(() => c('serena').install(ctx), /claude mcp add serena failed/);
  assert.strictEqual(ctx.manifest.components.serena.installedByAskai, true);
  const un = makeCtx(home, { tools: true }, fakes);
  un.manifest.components.serena = ctx.manifest.components.serena;
  capture(un);
  c('serena').uninstall(un);
  assert.ok(un.calls.includes('act uv tool uninstall serena-agent'));
}));

test('serena: a tool finished by hand after an askai run failed at the uv step is adopted; uninstall --tools removes it', () => withHome(home => {
  const fakes = serenaFakes({ tools: { uv: '/bin/uv', serena: '/bin/serena' } });
  const ctx = makeCtx(home, {}, fakes);
  ctx.manifest.runs = [{ command: 'install', results: [{ id: 'serena', result: 'failed', detail: 'uv tool install serena-agent failed (exit 2)' }] }];
  const logs = capture(ctx);
  c('serena').install(ctx);
  assert.deepStrictEqual([ctx.manifest.components.serena.installedByAskai, ctx.manifest.components.serena.mcp], [true, true]);
  assert.strictEqual(installCalls(ctx).length, 0, 'already present: not installed again');
  assert.ok(logs.some(l => /recording it as installed by askai/.test(l)));

  // adoption sticks after the failed runs scroll out of the manifest
  ctx.manifest.runs = [];
  c('serena').install(ctx);
  assert.strictEqual(ctx.manifest.components.serena.installedByAskai, true);

  const un = makeCtx(home, { tools: true }, fakes);
  un.manifest.components.serena = ctx.manifest.components.serena;
  capture(un);
  c('serena').uninstall(un);
  assert.ok(un.calls.some(x => x === 'act uv tool uninstall serena-agent'));
  assert.ok(un.calls.some(x => x.includes('mcp remove --scope user serena')));
}));

test('serena: a tool the user installed themselves stays theirs; only --force removes it', () => withHome(home => {
  const fakes = serenaFakes({ tools: { uv: '/bin/uv', serena: '/bin/serena' } });
  const ctx = makeCtx(home, {}, fakes);
  ctx.manifest.runs = [{ command: 'install', results: [{ id: 'serena', result: 'failed', detail: 'claude mcp add serena failed: boom' }] }];
  capture(ctx);
  c('serena').install(ctx);
  assert.strictEqual(ctx.manifest.components.serena.installedByAskai, false, 'a failure at another step is not evidence askai installed it');

  const keep = makeCtx(home, { tools: true }, fakes);
  keep.manifest.components.serena = { ...ctx.manifest.components.serena, mcp: false };
  const logs = capture(keep);
  c('serena').uninstall(keep);
  assert.ok(!keep.calls.some(x => x.includes('uv tool uninstall')));
  assert.ok(logs.some(l => /not installed by askai, left in place/.test(l)));

  const forced = makeCtx(home, { tools: true, force: true }, fakes);
  forced.manifest.components.serena = keep.manifest.components.serena;
  capture(forced);
  c('serena').uninstall(forced);
  assert.ok(forced.calls.includes('act uv tool uninstall serena-agent'));

  const noTools = makeCtx(home, { force: true }, fakes);
  capture(noTools);
  c('serena').uninstall(noTools);
  assert.ok(!noTools.calls.some(x => x.includes('uv tool uninstall')), 'without --tools the binary is never removed');
}));

test('serena: adds the uv bin dir to the user PATH, records it only when askai changed it, and undoes it with --tools', () => withHome(home => {
  const fakes = serenaFakes({});
  const ctx = makeCtx(home, {}, fakes);
  const edits = [];
  ctx.editPath = (dir, add) => { edits.push([dir, add]); return 'changed'; };
  capture(ctx);
  c('serena').install(ctx);
  const dir = path.dirname('/bin/serena');
  assert.deepStrictEqual(edits, [[dir, true]]);
  assert.strictEqual(ctx.manifest.components.serena.pathDir, dir);

  const same = makeCtx(home, {}, serenaFakes({ tools: { uv: '/bin/uv', serena: '/bin/serena' } }));
  same.editPath = () => 'unchanged';
  capture(same);
  c('serena').install(same);
  assert.strictEqual(same.manifest.components.serena.pathDir, undefined, 'entry the user already had is not askai\'s to remove');

  const un = makeCtx(home, { tools: true }, fakes);
  un.manifest.components.serena = ctx.manifest.components.serena;
  const undo = [];
  un.editPath = (d, add) => { undo.push([d, add]); return 'changed'; };
  capture(un);
  c('serena').uninstall(un);
  assert.deepStrictEqual(undo, [[dir, false]]);

  const noTools = makeCtx(home, {}, fakes);
  noTools.manifest.components.serena = ctx.manifest.components.serena;
  noTools.editPath = () => { throw new Error('PATH must stay without --tools'); };
  capture(noTools);
  c('serena').uninstall(noTools);
}));

test('serena: a PATH edit that errors only warns; the install still completes', () => withHome(home => {
  const ctx = makeCtx(home, {}, serenaFakes({}));
  ctx.editPath = () => 'error: registry locked';
  const logs = capture(ctx);
  c('serena').install(ctx);
  assert.ok(logs.some(l => /warn: could not add .* to the user PATH/.test(l)));
  assert.strictEqual(ctx.manifest.components.serena.mcp, true);
  assert.strictEqual(ctx.manifest.components.serena.pathDir, undefined);
}));

test('serena: dry-run plans the stale link removal and changes nothing', () => withHome(home => {
  const pyDir = pythonDir(home, { link: 'dangling' });
  const ctx = makeCtx(home, { dry: true }, serenaFakes({ pyDir }));
  const plan = [];
  ctx.log = { info: () => {}, warn: () => {}, step: () => {}, plan: m => plan.push(m) };
  c('serena').install(ctx);
  assert.ok(plan.some(m => /remove stale uv python link/.test(m)));
  assert.ok(present(`${pyDir}/${MINOR}`), 'nothing removed in dry-run');
  assert.strictEqual(installCalls(ctx).length, 1);
}));

test('claude: present CLI is detected and never reinstalled; missing CLI needs winget', () => withHome(home => {
  const ok = makeCtx(home, {}, { claude: '/fake/claude', probe: () => ({ ok: true, status: 0, stdout: '2.1.0 (Claude Code)', stderr: '', error: null }) });
  assert.strictEqual(c('claude').detect(ok).state, 'ok');
  const missing = makeCtx(home, {}, { claude: null });
  assert.strictEqual(c('claude').detect(missing).state, 'missing');
  assert.throws(() => c('claude').install(missing), /winget/);
}));

test('nodeOk compares against 22.5', () => {
  assert.ok(!comps.nodeOk('20.11.0') && !comps.nodeOk('22.4.9'));
  assert.ok(comps.nodeOk('22.5.0') && comps.nodeOk('24.19.0') && comps.nodeOk('23.0.0'));
});
