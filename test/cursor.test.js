'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cursor = require('../lib/cursor');
const rulesLib = require('../lib/rules');
const profiles = require('../lib/profiles');
const { tmpHome, rm, write, readJson, makeCtx, fs, path } = require('./helpers');

const read = f => fs.readFileSync(f, 'utf8');
// A claude home plus a Cursor home and a project directory, all under the OS temp dir.
function withDirs(fn, opts = {}, fakes = {}) {
  const home = tmpHome(), cursorHome = `${home}-cursor`, proj = `${home}-proj`;
  try { return fn(makeCtx(home, { cursorHome, ...opts }, fakes), { home, cursorHome, proj }); } finally { rm(home); rm(cursorHome); rm(proj); }
}
function capture(ctx) {
  const out = [];
  // Mutate in place: ctx.editJson closes over the original log object.
  Object.assign(ctx.log, { info: m => out.push(m), warn: m => out.push(`warn: ${m}`), step: m => out.push(m), plan: m => out.push(`plan: ${m}`) });
  return out;
}

// ---- hosts ----------------------------------------------------------------------------------------------------------------
test('hosts: explicit targets', () => {
  const p = cursor.cursorPaths('/nowhere/.cursor');
  const h = target => cursor.hosts({ opts: { target }, cursorPaths: p, which: () => null });
  assert.deepStrictEqual(h('claude'), { target: 'claude', claude: true, cursor: false });
  assert.deepStrictEqual(h('cursor'), { target: 'cursor', claude: false, cursor: true });
  assert.deepStrictEqual(h('both'), { target: 'both', claude: true, cursor: true });
});

test('hosts: auto is Claude, plus Cursor when its directory exists, the cursor command is on PATH, or --cursor-home was given', () => {
  const home = tmpHome();
  try {
    const missing = path.join(home, 'no-cursor');
    const auto = (o, which = () => null, dir = missing) => cursor.hosts({ opts: { target: 'auto', ...o }, cursorPaths: cursor.cursorPaths(dir), which });
    assert.deepStrictEqual(auto({}), { target: 'auto', claude: true, cursor: false }, 'no directory, no command: Claude only');
    assert.strictEqual(auto({}, () => null, home).cursor, true, 'the directory exists');
    assert.strictEqual(auto({}, n => (n === 'cursor' ? '/bin/cursor' : null)).cursor, true, 'cursor is on PATH');
    assert.strictEqual(auto({ cursorHome: missing }).cursor, true, 'an explicit --cursor-home is a request for Cursor');
    assert.strictEqual(cursor.hosts({ opts: {}, cursorPaths: null, which: () => '/bin/cursor' }).cursor, false, 'a sandboxed run without --cursor-home never looks at the real Cursor');
    assert.strictEqual(cursor.hosts({ opts: {}, cursorPaths: null, which: () => null }).target, 'auto', 'target defaults to auto');
  } finally { rm(home); }
});

test('hosts: cursor or both in a sandbox without --cursor-home is an error that says what to pass', () => {
  for (const target of ['cursor', 'both']) {
    assert.throws(() => cursor.hosts({ opts: { target }, cursorPaths: null, which: () => null }), /--target .* needs --cursor-home DIR/);
  }
  assert.doesNotThrow(() => cursor.hosts({ opts: { target: 'claude' }, cursorPaths: null, which: () => null }));
});

test('hosts: buildCtx keeps the real ~/.cursor out of a sandboxed run', () => withDirs((ctx, d) => {
  assert.strictEqual(ctx.cursorPaths.home, path.resolve(d.cursorHome));
  const sandboxed = makeCtx(d.home);
  assert.strictEqual(sandboxed.cursorPaths, null);
}));

// ---- mcp.json -------------------------------------------------------------------------------------------------------------
test('mcp: a missing file has no servers; addMcp creates the file and the directory', () => withDirs((ctx, d) => {
  assert.deepStrictEqual(cursor.mcpServers(ctx), {});
  assert.strictEqual(cursor.addMcp(ctx, 'serena', { command: 'serena', args: ['x'] }), 'added');
  assert.deepStrictEqual(readJson(path.join(d.cursorHome, 'mcp.json')), { mcpServers: { serena: { command: 'serena', args: ['x'] } } });
  assert.deepStrictEqual(Object.keys(cursor.mcpServers(ctx)), ['serena']);
}));

test('mcp: addMcp never replaces an entry that exists and keeps every other key', () => withDirs((ctx, d) => {
  const f = path.join(d.cursorHome, 'mcp.json');
  write(f, JSON.stringify({ other: 1, mcpServers: { serena: { command: 'my-serena' }, github: { url: 'https://x' } } }));
  assert.strictEqual(cursor.addMcp(ctx, 'serena', { command: 'serena' }), 'present');
  assert.strictEqual(cursor.addMcp(ctx, 'context-mode', { command: 'context-mode' }), 'added');
  assert.deepStrictEqual(readJson(f), { other: 1, mcpServers: { serena: { command: 'my-serena' }, github: { url: 'https://x' }, 'context-mode': { command: 'context-mode' } } });
}));

test('mcp: an unchanged file is not rewritten or backed up', () => withDirs((ctx, d) => {
  const f = path.join(d.cursorHome, 'mcp.json');
  write(f, JSON.stringify({ mcpServers: { serena: { command: 'serena' } } }));
  const before = fs.statSync(f).mtimeMs;
  assert.strictEqual(cursor.addMcp(ctx, 'serena', { command: 'other' }), 'present');
  assert.strictEqual(fs.statSync(f).mtimeMs, before);
  assert.ok(!fs.existsSync(ctx.paths.backups), 'no backup for a no-op');
}));

test('mcp: a change is backed up first', () => withDirs((ctx, d) => {
  const f = path.join(d.cursorHome, 'mcp.json');
  write(f, JSON.stringify({ mcpServers: {} }));
  cursor.addMcp(ctx, 'serena', { command: 'serena' });
  const stamp = fs.readdirSync(ctx.paths.backups)[0];
  assert.deepStrictEqual(readJson(path.join(ctx.paths.backups, stamp, 'mcp.json')), { mcpServers: {} });
}));

test('mcp: "mcpServers" that is not an object, or a file that is not JSON, is refused and left as it was', () => withDirs((ctx, d) => {
  const f = path.join(d.cursorHome, 'mcp.json');
  write(f, '{"mcpServers": []}');
  assert.throws(() => cursor.addMcp(ctx, 'serena', { command: 'serena' }), /"mcpServers" is not an object/);
  assert.strictEqual(read(f), '{"mcpServers": []}');
  write(f, '{ not json');
  assert.throws(() => cursor.addMcp(ctx, 'serena', { command: 'serena' }), /cannot parse .*mcp\.json/);
  assert.throws(() => cursor.mcpServers(ctx), /cannot parse/);
  assert.strictEqual(read(f), '{ not json');
}));

test('mcp: removeMcp removes only the named entry and says whether it did', () => withDirs((ctx, d) => {
  const f = path.join(d.cursorHome, 'mcp.json');
  write(f, JSON.stringify({ mcpServers: { serena: { command: 'serena' }, github: { url: 'x' } } }));
  assert.strictEqual(cursor.removeMcp(ctx, 'serena'), true);
  assert.deepStrictEqual(readJson(f), { mcpServers: { github: { url: 'x' } } });
  assert.strictEqual(cursor.removeMcp(ctx, 'serena'), false);
  write(f, JSON.stringify({}));
  assert.strictEqual(cursor.removeMcp(ctx, 'serena'), false);
}));

test('mcp: dry-run plans the change and writes nothing', () => withDirs((ctx, d) => {
  const logs = capture(ctx);
  assert.strictEqual(cursor.addMcp(ctx, 'serena', { command: 'serena' }), 'added');
  assert.ok(logs.some(l => /^plan: update .*mcp\.json/.test(l)));
  assert.ok(!fs.existsSync(d.cursorHome), 'nothing on disk');
}, { dry: true }));

// ---- hooks.json -----------------------------------------------------------------------------------------------------------
test('hookCommands: reads flat entries and nested { hooks: [...] } entries, ignores everything else', () => {
  const json = { hooks: {
    preToolUse: [{ command: 'rtk hook cursor', matcher: 'Shell' }, { command: 'echo hi' }],
    afterFileEdit: [{ hooks: [{ command: 'fmt' }, { command: 7 }, null] }],
    junk: 'not an array',
    empty: [],
    nulls: [null, 5, 'x'],
  } };
  assert.deepStrictEqual(cursor.hookCommands(json), [
    { event: 'preToolUse', command: 'rtk hook cursor' },
    { event: 'preToolUse', command: 'echo hi' },
    { event: 'afterFileEdit', command: 'fmt' },
  ]);
  assert.deepStrictEqual(cursor.hookCommands({}), []);
  assert.deepStrictEqual(cursor.hookCommands({ hooks: 'x' }), []);
});

test('rtkHooked: true only when a hook command runs rtk; false with no file or no Cursor home', () => withDirs((ctx, d) => {
  const f = path.join(d.cursorHome, 'hooks.json');
  assert.strictEqual(cursor.rtkHooked(ctx), false, 'no file');
  write(f, JSON.stringify({ hooks: { preToolUse: [{ command: 'echo hi' }, { command: 'startkit run' }] } }));
  assert.strictEqual(cursor.rtkHooked(ctx), false, 'a word that merely contains rtk does not count');
  write(f, JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: 'rtk hook cursor' }] } }));
  assert.strictEqual(cursor.rtkHooked(ctx), true);
  write(f, JSON.stringify({ hooks: { preToolUse: [{ hooks: [{ command: 'C:/Users/x/.cargo/bin/rtk.exe hook cursor' }] }] } }));
  assert.strictEqual(cursor.rtkHooked(ctx), true, 'nested format and an .exe path');
  assert.strictEqual(cursor.rtkHooked({ cursorPaths: null }), false);
}));

test('removeRtkHooks: drops only rtk entries, counts them, drops event arrays that end up empty', () => {
  const json = { version: 1, hooks: {
    preToolUse: [{ command: 'rtk hook cursor' }, { command: 'mine' }],
    beforeShellExecution: [{ command: 'rtk rewrite' }],
    afterFileEdit: [{ hooks: [{ command: 'rtk x' }] }, { hooks: [{ command: 'keep' }] }],
    weird: 'text',
  } };
  assert.strictEqual(cursor.removeRtkHooks(json), 3);
  assert.deepStrictEqual(json, { version: 1, hooks: {
    preToolUse: [{ command: 'mine' }],
    afterFileEdit: [{ hooks: [{ command: 'keep' }] }],
    weird: 'text',
  } });
  assert.strictEqual(cursor.removeRtkHooks(json), 0);
  assert.strictEqual(cursor.removeRtkHooks({}), 0);
  assert.strictEqual(cursor.removeRtkHooks({ hooks: [] }), 0);
});

// ---- project rules --------------------------------------------------------------------------------------------------------
test('projectFiles: an always-applied tokens file plus one file per rule kind of the profile', () => {
  const names = (p, present = [], c = 'full') => cursor.projectFiles(profiles.get(p), present, c).map(f => f.name);
  assert.deepStrictEqual(names('minimal'), ['askai-tokens.mdc']);
  assert.deepStrictEqual(names('coding'), ['askai-tokens.mdc', 'askai-coding.mdc']);
  assert.deepStrictEqual(names('docs'), ['askai-tokens.mdc', 'askai-docs.mdc']);
  assert.deepStrictEqual(names('full'), ['askai-tokens.mdc', 'askai-coding.mdc', 'askai-docs.mdc']);
  for (const f of cursor.projectFiles(profiles.get('full'), [], 'full')) assert.ok(f.text.includes(rulesLib.MDC_MARKER), `${f.name} is marked`);
});

test('projectFiles: no Claude-only text, tool lines only for the tools present, terse section follows the level', () => {
  const tokens = (present, level) => cursor.projectFiles(profiles.get('minimal'), present, level)[0].text;
  const t = tokens(['serena'], 'full');
  assert.ok(!/Explore agent|SendMessage|Agent prompts/.test(t), 'Cursor has none of the Claude Code subagent tools');
  assert.match(t, /find_symbol/);
  assert.ok(!/ctx_batch_execute/.test(t));
  assert.match(t, /Terse output \(caveman, full\)/);
  assert.match(tokens([], 'ultra'), /caveman, ultra/);
  assert.ok(!/Terse output/.test(tokens([], 'off')), 'off leaves the terse section out');
});

test('writeProject: writes, then reports unchanged; overwrites a marked file that was edited', () => withDirs((ctx, d) => {
  const files = cursor.projectFiles(profiles.get('full'), [], 'full');
  const r1 = cursor.writeProject(ctx, d.proj, files, false);
  assert.deepStrictEqual(r1.written, ['askai-tokens.mdc', 'askai-coding.mdc', 'askai-docs.mdc']);
  for (const f of files) assert.strictEqual(read(path.join(cursor.rulesDir(d.proj), f.name)), f.text);
  const r2 = cursor.writeProject(ctx, d.proj, files, false);
  assert.deepStrictEqual([r2.written, r2.unchanged.length], [[], 3]);

  const p = path.join(cursor.rulesDir(d.proj), 'askai-coding.mdc');
  write(p, `${read(p)}my edit\n`);
  assert.deepStrictEqual(cursor.writeProject(ctx, d.proj, files, false).written, ['askai-coding.mdc'], 'marked files are askai\'s: edits are overwritten');
  assert.strictEqual(read(p), files[1].text);
}));

test('writeProject: a file without the marker is skipped, --force replaces it', () => withDirs((ctx, d) => {
  const files = cursor.projectFiles(profiles.get('coding'), [], 'full');
  const p = path.join(cursor.rulesDir(d.proj), 'askai-coding.mdc');
  write(p, 'my own rule\n');
  const r = cursor.writeProject(ctx, d.proj, files, false);
  assert.deepStrictEqual([r.skipped, r.written], [['askai-coding.mdc'], ['askai-tokens.mdc']]);
  assert.strictEqual(read(p), 'my own rule\n');
  const f = cursor.writeProject(ctx, d.proj, files, true);
  assert.deepStrictEqual(f.written, ['askai-coding.mdc']);
  assert.ok(read(p).includes(rulesLib.MDC_MARKER));
}));

test('writeProject: a narrower set removes marked askai files it no longer wants and nothing else', () => withDirs((ctx, d) => {
  cursor.writeProject(ctx, d.proj, cursor.projectFiles(profiles.get('full'), [], 'full'), false);
  const rd = cursor.rulesDir(d.proj);
  write(path.join(rd, 'mine.mdc'), 'user rule\n');
  write(path.join(rd, 'askai-handmade.mdc'), 'not marked\n');
  const r = cursor.writeProject(ctx, d.proj, cursor.projectFiles(profiles.get('docs'), [], 'full'), false);
  assert.deepStrictEqual(r.removed, ['askai-coding.mdc']);
  assert.deepStrictEqual(fs.readdirSync(rd).sort(), ['askai-docs.mdc', 'askai-handmade.mdc', 'askai-tokens.mdc', 'mine.mdc']);
}));

test('writeProject: dry-run plans and writes nothing', () => withDirs((ctx, d) => {
  const logs = capture(ctx);
  const r = cursor.writeProject(ctx, d.proj, cursor.projectFiles(profiles.get('coding'), [], 'full'), false);
  assert.strictEqual(r.written.length, 2);
  assert.ok(!fs.existsSync(d.proj));
  assert.strictEqual(logs.filter(l => /^plan: write /.test(l)).length, 2);
}, { dry: true }));

test('removeProject: removes the marked askai files only; a project with none is a no-op', () => withDirs((ctx, d) => {
  assert.deepStrictEqual(cursor.removeProject(ctx, d.proj), [], 'no .cursor/rules at all');
  cursor.writeProject(ctx, d.proj, cursor.projectFiles(profiles.get('full'), [], 'full'), false);
  const rd = cursor.rulesDir(d.proj);
  write(path.join(rd, 'mine.mdc'), 'user rule\n');
  write(path.join(rd, 'askai-handmade.mdc'), 'not marked\n');
  assert.deepStrictEqual(cursor.removeProject(ctx, d.proj).sort(), ['askai-coding.mdc', 'askai-docs.mdc', 'askai-tokens.mdc']);
  assert.deepStrictEqual(fs.readdirSync(rd).sort(), ['askai-handmade.mdc', 'mine.mdc']);
}));

test('removeProject: dry-run leaves the files', () => withDirs((ctx, d) => {
  cursor.writeProject(makeCtx(d.home), d.proj, cursor.projectFiles(profiles.get('coding'), [], 'full'), false);
  assert.strictEqual(cursor.removeProject(ctx, d.proj).length, 2);
  assert.strictEqual(fs.readdirSync(cursor.rulesDir(d.proj)).length, 2);
}, { dry: true }));
