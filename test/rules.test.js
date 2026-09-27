'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rulesLib = require('../lib/rules');
const comps = require('../lib/components');
const { tmpHome, rm, write, makeCtx, fs, path } = require('./helpers');

const c = id => comps.byId(id);
const NL = String.fromCharCode(10);
function withHome(fn) {
  const home = tmpHome();
  try { return fn(home); } finally { rm(home); }
}
const ruleFile = (home, kind) => path.join(home, 'rules', `askai-${kind}.md`);
const read = f => fs.readFileSync(f, 'utf8');
const CM_ON = JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': true } });

// Replaces the silent logger with one that keeps every message, so a test can look for a warning.
function capture(ctx) {
  const out = [];
  ctx.log = { info: m => out.push(m), warn: m => out.push(`warn: ${m}`), step: m => out.push(m), plan: m => out.push(`plan: ${m}`) };
  return out;
}

test('rules.render: path-scoped frontmatter first, and lines about a tool only when it is present', () => {
  const bare = rulesLib.render('coding', []);
  assert.ok(bare.startsWith(`---${NL}paths:${NL}  - "**/*.{ts,`), 'paths: list comes first, so Claude loads the file only for matching files');
  assert.ok(bare.includes(`${NL}---${NL}# Code files (askai)${NL}`));
  assert.ok(!/get_symbols_overview|ctx_execute/.test(bare), 'no line about tools that are not there');
  assert.ok(bare.endsWith(NL));

  const full = rulesLib.render('coding', ['serena', 'context-mode']);
  assert.match(full, /get_symbols_overview/);
  assert.match(full, /ctx_batch_execute/);

  const docsBare = rulesLib.render('docs', []);
  assert.match(docsBare, /# Documents \(askai\)/);
  assert.ok(!/markitdown/.test(docsBare));
  assert.match(rulesLib.render('docs', ['markitdown']), /markitdown <file> -o <file>\.md/);
  assert.ok(rulesLib.render('docs', undefined), 'present may be omitted');
});

test('rules: unknown kinds and prototype keys render nothing; kinds and file names', () => {
  for (const k of ['nope', 'constructor', 'toString']) {
    assert.strictEqual(rulesLib.render(k, []), null);
    assert.strictEqual(rulesLib.renderCursor(k, []), null);
  }
  assert.deepStrictEqual(rulesLib.kinds(), ['coding', 'docs']);
  assert.strictEqual(rulesLib.fileName('docs'), 'askai-docs.md');
});

test('rules.sha: stable, content-sensitive, 16 hex chars', () => {
  assert.strictEqual(rulesLib.sha('a'), rulesLib.sha('a'));
  assert.notStrictEqual(rulesLib.sha('a'), rulesLib.sha('b'));
  assert.match(rulesLib.sha('a'), /^[0-9a-f]{16}$/);
});

test('rules.expandBraces: one group, several groups, and plain globs', () => {
  assert.deepStrictEqual(rulesLib.expandBraces('**/*.{a,b}'), ['**/*.a', '**/*.b']);
  assert.deepStrictEqual(rulesLib.expandBraces('x/*.md'), ['x/*.md']);
  assert.deepStrictEqual(rulesLib.expandBraces('{a,b}/{c,d}').sort(), ['a/c', 'a/d', 'b/c', 'b/d']);
});

test('rules.renderCursor: mdc frontmatter with expanded globs, marker, alwaysApply false; the tokens file is always applied', () => {
  const t = rulesLib.renderCursor('coding', ['serena']);
  const front = t.split('---')[1];
  assert.match(front, /description: Token-saving rules for code files \(askai\)/);
  assert.match(front, /globs: \*\*\/\*\.ts,\*\*\/\*\.tsx,/);
  assert.ok(!/[{}]/.test(front), 'no braces are left in the globs line');
  assert.match(front, /alwaysApply: false/);
  assert.ok(t.includes(rulesLib.MDC_MARKER));
  assert.match(t, /get_symbols_overview/);

  const tokens = rulesLib.renderCursorTokens(['rule one', 'rule two'].join(NL));
  assert.match(tokens.split('---')[1], /alwaysApply: true/);
  assert.ok(!/globs:/.test(tokens));
  assert.ok(tokens.includes(rulesLib.MDC_MARKER) && tokens.includes('rule one') && tokens.includes('rule two'));
  assert.deepStrictEqual(Object.values(rulesLib.MDC_NAMES).sort(), ['askai-coding.mdc', 'askai-docs.mdc', 'askai-tokens.mdc']);
});

test('presence: Claude reads enabledPlugins, the serena MCP entry and PATH; Cursor reads mcp.json', () => withHome(home => {
  const cursorHome = `${home}-cursor`;
  try {
    const ctx = makeCtx(home, { cursorHome }, { tools: { serena: '/fake/serena', markitdown: '/fake/markitdown' } });
    assert.deepStrictEqual(comps.presence(ctx), ['markitdown'], 'serena on PATH alone is not enough: it must be registered as an MCP server');

    write(ctx.paths.settings, JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': true, 'other@x': true } }));
    assert.deepStrictEqual(comps.presence(ctx).sort(), ['context-mode', 'markitdown']);
    write(ctx.paths.settings, JSON.stringify({ enabledPlugins: { 'context-mode@context-mode': false } }));
    assert.deepStrictEqual(comps.presence(ctx), ['markitdown'], 'a disabled plugin does not count');

    write(ctx.paths.userJson, JSON.stringify({ mcpServers: { serena: { command: 'serena' } } }));
    assert.ok(comps.presence(ctx).includes('serena'));

    assert.deepStrictEqual(comps.presence(ctx, 'cursor'), ['markitdown'], 'Cursor does not read the Claude config');
    write(path.join(cursorHome, 'mcp.json'), JSON.stringify({ mcpServers: { 'context-mode': { command: 'context-mode' }, serena: { command: 'serena' } } }));
    assert.deepStrictEqual(comps.presence(ctx, 'cursor').sort(), ['context-mode', 'markitdown', 'serena']);
  } finally { rm(`${home}-cursor`); }
}));

test('presence: without a Cursor home there is nothing to read; no tools gives an empty list', () => withHome(home => {
  const ctx = makeCtx(home);
  assert.strictEqual(ctx.cursorPaths, null);
  assert.deepStrictEqual(comps.presence(ctx, 'cursor'), []);
  assert.deepStrictEqual(comps.presence(ctx), []);
}));

test('rules component: writes the profile kinds, records hashes, and a second install rewrites nothing', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'full' });
  assert.strictEqual(c('rules').detect(ctx).state, 'missing');
  const first = capture(ctx);
  c('rules').install(ctx);
  assert.strictEqual(first.filter(m => /rules: wrote/.test(m)).length, 2);
  for (const k of ['coding', 'docs']) assert.ok(fs.existsSync(ruleFile(home, k)), `${k} written`);
  assert.strictEqual(c('rules').detect(ctx).state, 'ok');
  const rec = ctx.manifest.components.rules;
  assert.strictEqual(rec.installedByAskai, true);
  assert.strictEqual(rec.files.coding, rulesLib.sha(read(ruleFile(home, 'coding'))));

  const second = capture(ctx);
  c('rules').install(ctx);
  assert.deepStrictEqual(second, [], 'unchanged files are neither rewritten nor logged');
}));

test('rules component: uninstall removes unedited files and leaves an edited one', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'full' });
  c('rules').install(ctx);
  write(ruleFile(home, 'docs'), `${read(ruleFile(home, 'docs'))}- my own line${NL}`);
  const logs = capture(ctx);
  c('rules').uninstall(ctx);
  assert.ok(!fs.existsSync(ruleFile(home, 'coding')), 'unedited file removed');
  assert.ok(fs.existsSync(ruleFile(home, 'docs')), 'edited file stays');
  assert.ok(read(ruleFile(home, 'docs')).includes('my own line'));
  assert.ok(logs.some(l => /docs.*edited after askai wrote it, left in place/.test(l)));
  assert.strictEqual(ctx.manifest.components.rules.installedByAskai, false);
}));

test('rules component: a file that is not askai\'s is left alone; --force replaces it after a backup', () => withHome(home => {
  write(ruleFile(home, 'coding'), `my rule file${NL}`);
  const ctx = makeCtx(home, { profile: 'coding' });
  const logs = capture(ctx);
  c('rules').install(ctx);
  assert.strictEqual(read(ruleFile(home, 'coding')), `my rule file${NL}`);
  assert.ok(logs.some(l => /^warn: rules: .*left as is/.test(l)));
  assert.strictEqual((ctx.manifest.components.rules || {}).installedByAskai, false, 'askai does not claim a file it did not write');

  const forced = makeCtx(home, { profile: 'coding', force: true });
  c('rules').install(forced);
  assert.ok(read(ruleFile(home, 'coding')).startsWith(`---${NL}paths:`));
  const stamps = fs.readdirSync(path.join(home, 'askai', 'backups'));
  assert.strictEqual(stamps.length, 1);
  assert.strictEqual(read(path.join(home, 'askai', 'backups', stamps[0], 'askai-coding.md')), `my rule file${NL}`, 'the replaced file was backed up');
}));

test('rules component: a narrower profile removes the files a wider one wrote, and detect flags them until then', () => withHome(home => {
  const wide = makeCtx(home, { profile: 'full' });
  c('rules').install(wide);

  const docs = makeCtx(home, { profile: 'docs' });
  docs.manifest = wide.manifest;
  const d = c('rules').detect(docs);
  assert.strictEqual(d.state, 'partial');
  assert.match(d.detail, /coding rules left from another profile/);
  c('rules').install(docs);
  assert.ok(!fs.existsSync(ruleFile(home, 'coding')), 'coding rules removed');
  assert.ok(fs.existsSync(ruleFile(home, 'docs')));
  assert.strictEqual(c('rules').detect(docs).state, 'ok');
  assert.deepStrictEqual(Object.keys(docs.manifest.components.rules.files), ['docs']);

  const min = makeCtx(home, { profile: 'minimal' });
  min.manifest = docs.manifest;
  c('rules').install(min);
  assert.ok(!fs.existsSync(ruleFile(home, 'docs')));
  const m = c('rules').detect(min);
  assert.strictEqual(m.state, 'ok');
  assert.match(m.detail, /no rule files/);
}));

test('rules component: detect says partial when only some kinds are on disk, missing when none', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'full' });
  c('rules').install(ctx);
  fs.unlinkSync(ruleFile(home, 'docs'));
  const d = c('rules').detect(ctx);
  assert.strictEqual(d.state, 'partial');
  assert.match(d.detail, /coding present, docs missing/);
  fs.unlinkSync(ruleFile(home, 'coding'));
  assert.strictEqual(c('rules').detect(ctx).state, 'missing');
}));

test('rules component: dry-run plans the writes and changes nothing', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'full', dry: true });
  const logs = capture(ctx);
  c('rules').install(ctx);
  assert.ok(!fs.existsSync(path.join(home, 'rules')));
  assert.ok(!ctx.manifest.components.rules, 'nothing is recorded in a dry run');
  assert.strictEqual(logs.filter(m => /^plan: write .*askai-(coding|docs)\.md/.test(m)).length, 2);
}));

test('rules component: update refreshes the kinds askai wrote, with the tools present now, and adds no kinds', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'coding' });
  c('rules').install(ctx);
  assert.ok(!/ctx_batch_execute/.test(read(ruleFile(home, 'coding'))));
  write(ctx.paths.settings, CM_ON);
  c('rules').update(ctx);
  assert.match(read(ruleFile(home, 'coding')), /ctx_batch_execute/, 'a tool that arrived later shows up in the rule');
  assert.ok(!fs.existsSync(ruleFile(home, 'docs')));
}));

test('refreshDerived: rewrites the CLAUDE.md block and the rule files askai owns, and nothing else', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'coding', caveman: 'full' });
  c('caveman').install(ctx);
  c('rules').install(ctx);
  assert.ok(!/ctx_execute/.test(read(ctx.paths.claudeMd)));

  write(ctx.paths.settings, CM_ON);
  comps.refreshDerived(ctx);
  assert.match(read(ctx.paths.claudeMd), /ctx_execute/, 'the block now names the tool that is present');
  assert.match(read(ruleFile(home, 'coding')), /ctx_batch_execute/);
  assert.ok(!fs.existsSync(ruleFile(home, 'docs')));
}));

test('refreshDerived: writes nothing on a machine where askai manages nothing, and nothing in a dry run', () => withHome(home => {
  const ctx = makeCtx(home, { profile: 'full' });
  comps.refreshDerived(ctx);
  assert.deepStrictEqual(fs.readdirSync(home), [], 'no CLAUDE.md block, no rule files, no directories created');

  c('caveman').install(ctx);
  const before = read(ctx.paths.claudeMd);
  write(ctx.paths.settings, CM_ON);
  const dry = makeCtx(home, { profile: 'full', dry: true });
  comps.refreshDerived(dry);
  assert.strictEqual(read(ctx.paths.claudeMd), before);
}));

test('rules install leaves settings.json alone', () => withHome(home => {
  write(path.join(home, 'settings.json'), '{"a":1}');
  const ctx = makeCtx(home, { profile: 'coding' });
  c('rules').install(ctx);
  assert.strictEqual(read(path.join(home, 'settings.json')), '{"a":1}');
}));
