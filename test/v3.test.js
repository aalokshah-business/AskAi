'use strict';
// askai 3.0: Codex and Antigravity hosts, cross-platform installs, the hook-free session ledger, scaffold, tips and peak.
// Same rules as the other suites: throwaway folders under the OS temp dir, fake process runners, nothing real is touched.
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, readJson, write, makeCtx, cli, fs, path } = require('./helpers');
const comps = require('../lib/components');
const cursor = require('../lib/cursor');
const toml = require('../lib/toml-lite');
const pkg = require('../lib/pkg');
const session = require('../lib/session');
const scaffold = require('../lib/scaffold');
const tips = require('../lib/tips');
const agents = require('../lib/agents');
const { parseArgs, select } = require('../askai');

const c = id => comps.byId(id);
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };
const hostCtx = (home, opts = {}, fakes = {}) => {
  const ctx = makeCtx(home, { codexHome: path.join(home, 'codex'), agyHome: path.join(home, 'gemini'), cursorHome: path.join(home, 'cursor'), ...opts }, fakes);
  ctx.hostSel = { claude: true, cursor: true, codex: true, agy: true };
  return ctx;
};
const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const quiet = () => {};

// ---- toml-lite -----------------------------------------------------------------------------------------------------
test('toml-lite: adds keys only when absent, keeps comments, tables and CRLF, removes only unchanged values', () => {
  const src = '# mine\r\nmodel = "gpt-6.1-sol"\r\n\r\n[mcp_servers.docs]\r\ncommand = "x"\r\n';
  let r = toml.setIfAbsent(src, 'model_reasoning_effort', 'medium');
  assert.ok(r.changed && r.text.includes('\r\nmodel_reasoning_effort = "medium"\r\n') && r.text.startsWith('# mine'));
  assert.strictEqual(toml.setIfAbsent(r.text, 'model', 'other').changed, false, 'existing key is the user\'s');
  r = toml.setIfAbsent(r.text, 'default_subagent_reasoning_effort', 'medium', 'agents');
  assert.ok(/\[agents\]\r\ndefault_subagent_reasoning_effort = "medium"/.test(r.text));
  assert.strictEqual(toml.get(r.text, 'default_subagent_reasoning_effort', 'agents'), '"medium"');
  assert.ok(toml.hasTable(r.text, 'mcp_servers.docs') && !toml.hasTable(r.text, 'mcp_servers.serena'));
  assert.strictEqual(toml.removeIfEqual(r.text, 'model', 'something-else').changed, false);
  const back = toml.removeIfEqual(r.text, 'model_reasoning_effort', 'medium');
  assert.ok(back.changed && !back.text.includes('model_reasoning_effort'));
});

// ---- hosts and args ----------------------------------------------------------------------------------------------------
test('hosts: comma lists, all, and auto detection of Codex and Antigravity; sandboxed runs need their homes', () => withHome(home => {
  const p = { cursorPaths: null, codexPaths: agents.codexPaths(path.join(home, 'codex'), true), agyPaths: agents.agyPaths(path.join(home, 'gemini')), which: () => null };
  const h = (target, extra = {}) => cursor.hosts({ ...p, ...extra, opts: { target, ...(extra.opts || {}) } });
  assert.deepStrictEqual(h('claude,codex'), { target: 'claude,codex', claude: true, cursor: false, codex: true, agy: false });
  assert.throws(() => h('all'), /--cursor-home/, 'all needs every sandbox home');
  assert.deepStrictEqual(h('auto'), { target: 'auto', claude: false, cursor: false, codex: false, agy: false }, 'nothing present yet');
  fs.mkdirSync(path.join(home, 'codex'), { recursive: true });
  fs.mkdirSync(path.join(home, 'gemini', 'antigravity-cli'), { recursive: true });
  assert.ok(!h('auto').codex && !h('auto').agy, 'config directories are not hosts');
  assert.ok(h('auto', { which: n => (n === 'codex' || n === 'agy' ? n : null) }).codex, 'the CLI is the host');
  assert.throws(() => cursor.hosts({ cursorPaths: null, codexPaths: null, agyPaths: null, which: () => null, opts: { target: 'codex' } }), /--codex-home/);
  assert.ok(cursor.targetValid('claude,agy') && !cursor.targetValid('auto,codex') && !cursor.targetValid('nope'));
}));

test('parseArgs: new targets and options are accepted, bad values are not', () => {
  assert.strictEqual(parseArgs(['install', '--target', 'claude,codex', '--main-model', 'haiku', '--lean']).mainModel, 'haiku');
  assert.throws(() => parseArgs(['install', '--target', 'auto,cursor']), /--target must be/);
  assert.throws(() => parseArgs(['session', 'measure', '--success', '2']), /--success/);
  const o = parseArgs(['session', 'measure', '--input-tokens', '900', '--usage-source', '/usage', '--rework-minutes', '3']);
  assert.deepStrictEqual([o.inputTokens, o.usageSource, o.reworkMinutes], ['900', '/usage', '3']);
});

test('select: Codex and Antigravity components follow the tools they mirror and only for their host', () => {
  const ids = (o, hs) => select(o, 'install', undefined, hs).map(x => x.id);
  const claudeOnly = { claude: true, cursor: false, codex: false, agy: false };
  assert.ok(!ids({ profile: 'coding' }, claudeOnly).some(i => /^(codex|agy)-/.test(i)));
  const all = ids({ profile: 'coding', rtk: true }, { claude: true, cursor: true, codex: true, agy: true });
  for (const i of ['codex-baseline', 'codex-rules', 'codex-rtk', 'codex-serena', 'agy-rules', 'agy-rtk', 'agy-serena']) assert.ok(all.includes(i), i);
  const minimal = ids({ profile: 'minimal', rtk: true }, { claude: false, cursor: false, codex: true, agy: true });
  assert.ok(minimal.includes('codex-rtk') && !minimal.includes('codex-serena') && !minimal.includes('agy-serena'), 'minimal has no MCP servers');
  assert.ok(ids({}, claudeOnly).includes('lean') && !ids({ skip: 'lean' }, claudeOnly).includes('lean'), 'lean is in every profile since 4.0; --skip removes it');
});

// ---- Codex ---------------------------------------------------------------------------------------------------------
test('codex-baseline: adds the four keys (and --codex-model), keeps the user\'s values, uninstall removes only its own', () => withHome(home => {
  const ctx = hostCtx(home);
  write(ctx.codexPaths.config, 'model_reasoning_effort = "high"\n\n[mcp_servers.docs]\ncommand = "x"\n');
  assert.strictEqual(c('codex-baseline').detect(ctx).state, 'partial');
  c('codex-baseline').install(ctx);
  const t = read(ctx.codexPaths.config);
  assert.ok(t.includes('model_reasoning_effort = "high"') && t.includes('model_verbosity = "low"') && t.includes('personality = "none"'));
  assert.ok(/\[agents\]\ndefault_subagent_reasoning_effort = "medium"/.test(t) && t.includes('[mcp_servers.docs]'));
  assert.strictEqual(c('codex-baseline').detect(ctx).state, 'ok');
  const withModel = hostCtx(home, { codexModel: 'gpt-6-luna' });
  withModel.manifest = ctx.manifest;
  c('codex-baseline').install(withModel);
  assert.ok(read(ctx.codexPaths.config).includes('model = "gpt-6-luna"'));
  c('codex-baseline').uninstall(withModel);
  const after = read(ctx.codexPaths.config);
  assert.ok(after.includes('model_reasoning_effort = "high"') && !after.includes('model_verbosity') && !after.includes('gpt-6-luna'));
  assert.ok(!after.includes('[agents]') && after.includes('[mcp_servers.docs]'), 'the [agents] table askai created is gone, the user\'s table stays');
}));

test('codex-rules and agy-rules: one managed block each, idempotent, user text kept, removed cleanly', () => withHome(home => {
  const ctx = hostCtx(home, { caveman: 'lite' });
  write(ctx.codexPaths.agentsMd, '# My global rules\n- be kind\n');
  for (const id of ['codex-rules', 'agy-rules']) {
    c(id).install(ctx);
    c(id).install(ctx);
    const file = id === 'codex-rules' ? ctx.codexPaths.agentsMd : ctx.agyPaths.rulesMd;
    const t = read(file);
    assert.strictEqual((t.match(/askai:begin/g) || []).length, 1, `${id}: one block`);
    assert.ok(t.includes('## Token rules (askai)') && t.includes('caveman, lite') && !t.includes('SendMessage'), `${id}: no Claude-only tool names`);
    assert.strictEqual(c(id).detect(ctx).state, 'ok');
    c(id).uninstall(ctx);
    if (id === 'codex-rules') assert.ok(!read(file).includes('askai:begin'));
    else assert.strictEqual(read(file), null, 'GEMINI.md was created by askai and is removed when empty');
  }
  assert.ok(read(ctx.codexPaths.agentsMd).startsWith('# My global rules'));
}));

test('codex-rtk and agy-rtk: run RTK\'s own init; uninstall only what askai wired', () => withHome(home => {
  const good = { ok: true, status: 0, stdout: '', stderr: '', error: null };
  const fakes = { tools: { rtk: '/fake/rtk', rg: '/fake/rg' }, probe: () => good };
  const ctx = hostCtx(home, {}, fakes);
  c('codex-rtk').install(ctx);
  assert.ok(ctx.calls.includes('act rtk init -g --codex'));
  c('agy-rtk').install(ctx);
  assert.ok(ctx.calls.includes('act rtk init --agent antigravity --auto-patch'));
  write(ctx.codexPaths.rtkMd, 'rtk');
  const other = hostCtx(home, {}, fakes);
  other.calls = [];
  c('codex-rtk').uninstall(other);
  assert.ok(!other.calls.some(x => x.includes('--uninstall')), 'a fresh manifest did not wire it, so nothing is removed');
  c('codex-rtk').uninstall(ctx);
  assert.ok(ctx.calls.includes('act rtk init -g --codex --uninstall'));
}));

test('agy-serena adds an entry only when absent and removes only its own', () => withHome(home => {
  const fakes = { tools: { uv: '/fake/uv', serena: '/fake/serena' }, probe: () => ({ ok: true, status: 0, stdout: '', stderr: '', error: null }) };
  const ctx = hostCtx(home, {}, fakes);
  write(ctx.agyPaths.mcp, JSON.stringify({ mcpServers: { github: { serverUrl: 'https://x' } } }));
  c('agy-serena').install(ctx);
  const j = readJson(ctx.agyPaths.mcp);
  assert.ok(j.mcpServers.github && j.mcpServers.serena && j.mcpServers.serena.args.includes('--context'));
  c('agy-serena').uninstall(ctx);
  assert.ok(!readJson(ctx.agyPaths.mcp).mcpServers.serena && readJson(ctx.agyPaths.mcp).mcpServers.github);
}));

// ---- handoff and lean ------------------------------------------------------------------------------------------------
test('retired handoff launcher is not installed and cleanup removes only its own files', () => withHome(home => {
  const ctx = hostCtx(home);
  const userFile = path.join(ctx.agyPaths.appSkills, 'askai-handoff', 'SKILL.md');
  write(userFile, 'my own skill');
  c('handoff').install(ctx);
  const cursorCmd = path.join(ctx.cursorPaths.home, 'commands', 'askai-handoff.md');
  assert.ok(!fs.existsSync(cursorCmd), 'retired component creates no launcher');
  assert.strictEqual(read(userFile), 'my own skill', 'a file askai did not write is left alone');
  assert.strictEqual(c('handoff').detect(ctx).state, 'other');
  const text = 'old AskAI launcher';
  write(cursorCmd, text);
  ctx.manifest.components.handoff = { files: [{ path: cursorCmd, sha: require('crypto').createHash('sha1').update(text).digest('hex') }] };
  c('handoff').uninstall(ctx);
  assert.ok(!fs.existsSync(cursorCmd) && read(userFile) === 'my own skill');
  const dry = hostCtx(home, { dry: true });
  c('handoff').install(dry);
  assert.ok(!fs.existsSync(cursorCmd), 'dry-run writes nothing');
}));

test('lean: three keys added only when absent and removed only while unchanged', () => withHome(home => {
  const ctx = makeCtx(home);
  write(ctx.paths.settings, JSON.stringify({ includeGitInstructions: true, permissions: { deny: ['Bash(rm -rf:*)'] } }));
  c('lean').install(ctx);
  const s = readJson(ctx.paths.settings);
  assert.deepStrictEqual([s.promptSuggestionEnabled, s.bashOutputMaxChars, s.includeGitInstructions], [false, 15000, true]);
  assert.ok(s.permissions.deny.includes('Read(./node_modules/**)') && s.permissions.deny.includes('Read(**/.env)') && s.permissions.deny[0] === 'Bash(rm -rf:*)');
  c('lean').uninstall(ctx);
  const t = readJson(ctx.paths.settings);
  assert.ok(!('promptSuggestionEnabled' in t) && !('bashOutputMaxChars' in t) && t.includeGitInstructions === true);
  assert.deepStrictEqual(t.permissions.deny, ['Bash(rm -rf:*)'], 'only the user\'s own deny rule is left');
}));

// ---- cross-platform installs -------------------------------------------------------------------------------------------
test('pkg: off Windows it prefers Homebrew, then the vendor script, then cargo, and says what to run when none exists', { skip: process.platform === 'win32' ? 'Unix package-manager routing only' : false }, () => withHome(home => {
  const mk = tools => { const ctx = makeCtx(home); ctx.which = n => tools[n] || null; return ctx; };
  const brew = mk({ brew: '/b/brew' });
  pkg.install(brew, 'rtk-ai.rtk', () => true);
  assert.ok(brew.calls.includes('act brew install rtk'));
  const script = mk({ curl: '/u/curl' });
  pkg.install(script, 'astral-sh.uv', () => true);
  assert.ok(script.calls.some(x => x.includes('astral.sh/uv/install.sh')));
  assert.ok(!script.calls.some(x => x.includes('pip install')), 'a present uv does not also install from PyPI');
  const cargo = mk({ cargo: '/c/cargo' });
  pkg.install(cargo, 'rtk-ai.rtk', () => true);
  assert.ok(cargo.calls.includes('act cargo install --git https://github.com/rtk-ai/rtk rtk'), 'git install naming the rtk package (the repo also holds rtk-proxy), not the unrelated crate');
  assert.throws(() => pkg.install(mk({}), 'rtk-ai.rtk', () => false), /rustup|brew\.sh/);
  // The error must name the tool ("rtk"), never the winget id ("rtk-ai.rtk") used only as pkg.js's internal lookup key.
  assert.throws(() => pkg.install(mk({}), 'rtk-ai.rtk', () => false), err => !/rtk-ai\.rtk/.test(err.message) && /\brtk\b/.test(err.message));
  assert.throws(() => pkg.install(mk({}), 'BurntSushi.ripgrep.MSVC', () => false), err => !/BurntSushi/.test(err.message) && /\bripgrep\b/.test(err.message));
  if (process.platform === 'linux') assert.throws(() => pkg.install(mk({}), 'rtk-ai.rtk', () => false), /Rust.*rustup\.rs.*Homebrew/s, 'Linux should lead with Rust, not Homebrew');
  assert.match(pkg.describe(mk({ curl: '/u/curl' }), 'Anthropic.ClaudeCode'), /claude\.ai\/install\.sh/);
}));

test('pkg: rtk\'s cargo install provisions Rust via rustup first when cargo is missing, using its absolute path, without touching the real cargo', { skip: process.platform === 'win32' ? 'Unix package-manager routing only' : false }, () => withHome(home => {
  const savedHome = process.env.HOME;
  process.env.HOME = '/home/dev';
  try {
    const cargoBin = '/home/dev/.cargo/bin/cargo';
    let installed = false;
    const ctx = makeCtx(home);
    ctx.which = n => ({ curl: '/usr/bin/curl' }[n] || null);
    ctx.probe = (cmd, args) => {
      ctx.calls.push(['probe', cmd, ...args].join(' '));
      if (cmd === 'test' && args[1] === cargoBin) return installed ? { ok: true, status: 0, stdout: '', stderr: '', error: null } : { ok: false, status: 1, stdout: '', stderr: '', error: null };
      return { ok: false, status: 1, stdout: '', stderr: '', error: null };
    };
    ctx.act = (label, cmd, args) => {
      ctx.calls.push(['act', cmd, ...(args || [])].join(' '));
      if (cmd === 'sh' && String(args[1]).includes('sh.rustup.rs')) installed = true;
      return { ok: true, status: 0, stdout: '', stderr: '', error: null };
    };
    // Still fails in this same process -- refreshPath is a no-op on Unix, so ~/.cargo/bin never reaches this
    // process's PATH without a new shell -- but the cargo install itself must actually have run.
    assert.throws(() => pkg.install(ctx, 'rtk-ai.rtk', () => false), /not on PATH yet/);
    assert.ok(ctx.calls.some(x => x.includes('sh.rustup.rs')), 'installs Rust via rustup when cargo is missing');
    assert.ok(ctx.calls.includes(`act ${cargoBin} install --git https://github.com/rtk-ai/rtk rtk`), 'runs cargo install with the freshly-provisioned absolute path, not the unresolvable bare "cargo"');
  } finally { process.env.HOME = savedHome; }
}));

test('pkg: a missing system package is installed by askai itself when sudo works without a password, never by prompting', { skip: process.platform === 'win32' ? 'Unix package managers only' : false }, () => withHome(home => {
  const mk = (tools, sudoWorks) => {
    const ctx = makeCtx(home); ctx.which = n => tools[n] || null;
    ctx.probe = (cmd, args) => { ctx.calls.push(['probe', cmd, ...args].join(' ')); return { ok: cmd === 'sudo' && sudoWorks, status: 0, stdout: '', stderr: '', error: null }; };
    return ctx;
  };
  const savedUid = process.getuid; process.getuid = () => 1000;
  try {
    const yes = mk({ 'apt-get': '/usr/bin/apt-get', sudo: '/usr/bin/sudo' }, true);
    assert.throws(() => pkg.install(yes, 'BurntSushi.ripgrep.MSVC', () => false), /not on PATH yet/, 'it ran the install; the tool is simply not visible to this fake PATH');
    assert.ok(yes.calls.includes('act sudo -n apt-get install -y ripgrep'), yes.calls.join(' | '));
    assert.ok(yes.calls.some(c => c === 'probe sudo -n true'), 'asks sudo non-interactively first');
    const gh = mk({ 'apt-get': '/usr/bin/apt-get', sudo: '/usr/bin/sudo' }, true);
    assert.throws(() => pkg.install(gh, 'GitHub.cli', () => false), /not on PATH yet/); assert.ok(gh.calls.includes('act sudo -n apt-get install -y gh'));
    const no = mk({ 'apt-get': '/usr/bin/apt-get', sudo: '/usr/bin/sudo' }, false);
    assert.throws(() => pkg.install(no, 'jqlang.jq', () => false), /jq: no Homebrew found; sudo apt-get install jq/);
    assert.ok(!no.calls.some(c => c.startsWith('act ')), 'without passwordless sudo nothing privileged is attempted');
  } finally { process.getuid = savedUid; }
}));

test('pkg: uv falls back to pip when its installer host is blocked', () => withHome(home => {
  const ctx = makeCtx(home);
  const win = process.platform === 'win32';
  const tools = win ? { winget: 'C:\\Windows\\winget.exe', python: 'C:\\Python\\python.exe' } : { curl: '/u/curl', python3: '/u/python3' };
  const py = win ? 'python' : 'python3';
  ctx.which = n => (n === 'uv' && ctx._uv ? (win ? 'C:\\Users\\u\\.local\\bin\\uv.exe' : '/home/.local/bin/uv') : tools[n] || null);
  ctx.act = (label, cmd, args) => {
    ctx.calls.push(['act', cmd, ...args].join(' '));
    const primary = win ? cmd === 'winget' : cmd === 'sh';
    if (primary) return { ok: false, status: 56, stdout: '', stderr: 'connection reset by peer', error: null };
    ctx._uv = true;
    return { ok: true, status: 0, stdout: '', stderr: '', error: null };
  };
  pkg.install(ctx, 'astral-sh.uv', () => !!ctx.which('uv'));
  if (!win) assert.strictEqual(ctx.calls.filter(x => x.includes('astral.sh')).length, 1, 'a blocked uv host is not retried');
  assert.ok(ctx.calls.some(x => x.includes(`${py} -m pip install --user uv`)));
  const neither = makeCtx(home);
  neither.which = n => tools[n] || null;
  neither.act = (label, cmd, args) => {
    neither.calls.push(['act', cmd, ...args].join(' '));
    return { ok: false, status: 1, stdout: '', stderr: 'connection reset by peer', error: null };
  };
  assert.throws(() => pkg.install(neither, 'astral-sh.uv', () => false), /pip install --user uv/);
  assert.match(pkg.describeOther({ which: () => null }, 'astral-sh.uv'), /pip install --user uv/);
}));

// ---- session, scaffold, tips -----------------------------------------------------------------------------------------
test('session: init, ledger entries, measurements with commas, and the report', () => withHome(home => {
  const out = [];
  const p = m => out.push(m);
  assert.strictEqual(session.run('init', { repo: home }, p), 0);
  for (const f of ['SESSION_LEDGER.md', 'HANDOFF.md', 'measurements.csv']) assert.ok(fs.existsSync(path.join(home, '.ai-work', f)), f);
  require('child_process').spawnSync('git', ['init'], { cwd: home, encoding: 'utf8' });
  session.run('init', { repo: home }, p);
  assert.ok(read(path.join(home, '.git', 'info', 'exclude')).includes('/.ai-work/'));
  assert.ok(!fs.existsSync(path.join(home, '.gitignore')) || !read(path.join(home, '.gitignore')).includes('/.ai-work/'));
  session.run('start', { repo: home, tool: 'codex', task: 'Fix nav' }, p);
  session.run('pause', { repo: home, summary: 'menu closes', next: 'check 320px' }, p);
  const ledger = read(path.join(home, '.ai-work', 'SESSION_LEDGER.md'));
  assert.ok(ledger.includes('START') && ledger.includes('**task:** Fix nav') && ledger.includes('**next step:** check 320px'));
  session.run('measure', { repo: home, tool: 'codex', difficulty: 'simple', task: 'a, b', minutes: '20', inputTokens: '9000', outputTokens: '1000', success: '1' }, p);
  session.run('measure', { repo: home, tool: 'codex', difficulty: 'simple', task: 'c', minutes: '40', inputTokens: '1000', outputTokens: '0', success: '0' }, p);
  const rows = session.parseCsv(read(path.join(home, '.ai-work', 'measurements.csv')));
  assert.strictEqual(rows[0].task, 'a, b');
  out.length = 0;
  session.run('report', { repo: home, _: ['session', 'report'] }, p);
  assert.ok(/codex\s+simple\s+2\s+1\s+50%\s+30\.0/.test(out.join('\n')), out.join('\n'));
  assert.strictEqual(session.run('bogus', { repo: home }, quiet), 1);
  session.run('init', { repo: home }, quiet);
  assert.strictEqual((read(path.join(home, '.git', 'info', 'exclude')).match(/\/\.ai-work\//g) || []).length, 1, 'init is idempotent');
}));

test('scaffold: writes the repo files once, never overwrites, and hints at @AGENTS.md', () => withHome(home => {
  write(path.join(home, 'CLAUDE.md'), '# my existing CLAUDE.md\n');
  const out = [];
  assert.strictEqual(scaffold.run(home, {}, m => out.push(m)), 0);
  assert.ok(read(path.join(home, 'AGENTS.md')).includes('AGENTS.md') && fs.existsSync(path.join(home, 'docs', 'ai', 'PROJECT_PROFILE.md')));
  assert.strictEqual(read(path.join(home, 'CLAUDE.md')), '# my existing CLAUDE.md\n');
  assert.ok(out.join('\n').includes('@AGENTS.md'));
  assert.ok(fs.existsSync(path.join(home, '.cursorignore')) && fs.existsSync(path.join(home, '.ai-work', 'HANDOFF.md')));
}));

test('tips and peak: every topic renders; the peak window follows US Eastern weekdays', () => {
  for (const t of [undefined, 'claude', 'codex', 'agy', 'antigravity', 'cursor', 'session', 'habits', 'all']) assert.ok(tips.render(t).length > 50, String(t));
  assert.throws(() => tips.render('emacs'), /unknown tips topic/);
  assert.strictEqual(tips.isPeak(new Date('2026-10-21T13:00:00Z')), true, 'Wednesday 09:00 EDT');
  assert.strictEqual(tips.isPeak(new Date('2026-10-21T19:00:00Z')), false, 'Wednesday 15:00 EDT');
  assert.strictEqual(tips.isPeak(new Date('2026-10-24T14:00:00Z')), false, 'Saturday');
  assert.match(tips.localWindow(new Date('2026-10-21T13:00:00Z')), /^\d\d:\d\d-\d\d:\d\d$/);
});

// ---- CLI -----------------------------------------------------------------------------------------------------------
test('CLI: version, tips, peak and a four-host dry-run install that writes nothing', () => withHome(home => {
  assert.strictEqual(cli(['version']).out.trim(), '1.3.0');
  assert.strictEqual(cli(['tips', 'agy']).code, 0);
  assert.strictEqual(cli(['tips', 'peak', '--json']).code, 0);
  const homes = ['--claude-home', path.join(home, 'claude'), '--cursor-home', path.join(home, 'cursor'), '--codex-home', path.join(home, 'codex'), '--agy-home', path.join(home, 'gemini')];
  const r = cli(['install', '--dry-run', '--yes', '--target', 'all', '--profile', 'minimal', ...homes]);
  assert.ok(r.out.includes('codex-baseline') && r.out.includes('agy-rules') && !/\n\s+handoff\s/.test(r.out), r.out + r.err);
  assert.ok(!fs.existsSync(path.join(home, 'codex', 'config.toml')) && !fs.existsSync(path.join(home, 'gemini', 'GEMINI.md')), 'dry-run wrote nothing');
  assert.strictEqual(cli(['session', 'status', '--repo', home]).code, 0);
}));

// ---- 3.1: evidence-based defaults ---------------------------------------------------------------------------------------
test('3.1: RTK and Context Mode are opt-in everywhere, and their host twins follow the flags', () => {
  const ids = (o, hs) => select(o, 'install', undefined, hs).map(x => x.id);
  const all = { claude: true, cursor: true, codex: true, agy: true };
  const plain = ids({ profile: 'full' }, all);
  assert.ok(!plain.some(i => /(^|-)rtk$|context-mode/.test(i)), plain.join(','));
  const opted = ids({ profile: 'minimal', rtk: true, contextMode: true }, all);
  for (const i of ['rtk', 'cursor-rtk', 'codex-rtk', 'agy-rtk', 'context-mode', 'cursor-context-mode']) assert.ok(opted.includes(i), i);
  assert.ok(ids({ profile: 'coding' }, all).includes('agy-path-rules') && !ids({ profile: 'minimal' }, all).includes('code-intel'));
});

test('3.1: the token rules carry the build-lean line on every host', () => {
  const cfg = require('../lib/claude-config');
  for (const host of [undefined, 'cursor']) assert.match(cfg.buildRules([], host), /smallest change that solves the task/);
});

test('3.1: lean adds the idle-drain switches, inside env where needed, and removes only its own', () => withHome(home => {
  const ctx = makeCtx(home);
  write(ctx.paths.settings, JSON.stringify({ env: { MINE: '1' } }));
  c('lean').install(ctx);
  const s = readJson(ctx.paths.settings);
  assert.deepStrictEqual([s.awaySummaryEnabled, s.crossSessionInbound, s.env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES, s.env.MINE], [false, 'hold', '0', '1']);
  assert.strictEqual(c('lean').detect(ctx).state, 'ok');
  c('lean').uninstall(ctx);
  const t = readJson(ctx.paths.settings);
  assert.ok(!('awaySummaryEnabled' in t) && !('crossSessionInbound' in t) && t.env.MINE === '1' && !('CLAUDE_CODE_GOAL_CHECKIN_MINUTES' in t.env));
}));

test('codex-baseline turns off automatic recaps in [tui]', () => withHome(home => {
  const ctx = hostCtx(home);
  c('codex-baseline').install(ctx);
  assert.match(read(ctx.codexPaths.config), /\[tui\]\nauto_recap = false/);
}));

test('3.1: agy-path-rules writes glob-triggered rules for the profile, keeps foreign files, removes its own', () => withHome(home => {
  const ctx = hostCtx(home, { profile: 'full' });
  const dir = path.join(ctx.agyPaths.home, 'config', 'rules');
  write(path.join(dir, 'askai-docs.md'), 'mine, no marker');
  c('agy-path-rules').install(ctx);
  const coding = read(path.join(dir, 'askai-coding.md'));
  assert.ok(coding.startsWith('---\ntrigger: glob\nglobs: "') && coding.includes('**/*.ts') && coding.includes('askai:managed'));
  assert.strictEqual(read(path.join(dir, 'askai-docs.md')), 'mine, no marker', 'a file without the marker is never overwritten');
  c('agy-path-rules').uninstall(ctx);
  assert.ok(!fs.existsSync(path.join(dir, 'askai-coding.md')) && read(path.join(dir, 'askai-docs.md')) === 'mine, no marker');
}));

test('3.1: code-intel installs the language server with npm and the official plugin; unknown languages are refused', () => withHome(home => {
  const good = { ok: true, status: 0, stdout: '', stderr: '', error: null };
  const ctx = makeCtx(home, { lsp: 'ts,python' }, { tools: { npm: '/bin/npm' }, probe: () => ({ ...good, stdout: '"typescript-lsp" "pyright-lsp"' }) });
  c('code-intel').install(ctx);
  assert.ok(ctx.calls.includes('act npm install -g typescript-language-server typescript') && ctx.calls.includes('act npm install -g pyright'));
  assert.ok(ctx.calls.includes('act /fake/claude plugin install typescript-lsp@claude-plugins-official') && ctx.calls.includes('act /fake/claude plugin install pyright-lsp@claude-plugins-official'));
  assert.deepStrictEqual(ctx.manifest.components['code-intel'].plugins, ['typescript-lsp', 'pyright-lsp']);
  assert.throws(() => c('code-intel').install(makeCtx(home, { lsp: 'cobol' })), /unknown language "cobol"/);
  assert.throws(() => c('code-intel').install(makeCtx(home, { lsp: '' })), /name the languages/);
}));

test('3.1: doctor flags a CLAUDE.md over 200 lines and survives an unreadable settings.json', () => withHome(home => {
  const ctx = makeCtx(home);
  write(ctx.paths.claudeMd, Array.from({ length: 230 }, (_, i) => `line ${i}`).join('\n'));
  const status = require('../lib/status');
  assert.ok(status.doctor(ctx).some(r => r.id === 'claude-md' && /230 lines/.test(r.msg)));
  write(ctx.paths.settings, '{ broken');
  assert.ok(status.doctor(ctx).some(r => r.id === 'settings' && r.level === 'fail'));
}));
