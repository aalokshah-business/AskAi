'use strict';
// askai 4.2: install.ps1 matches askai.js; AskAI applies every token-setup setting; takeover of a previous token-setup run;
// token-setup steps aside when AskAI is installed.
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const { tmpHome, rm, fs, path } = require('./helpers');
const ROOT = path.join(__dirname, '..');
const ASKAI = path.join(ROOT, 'askai.js');
const TS = path.join(ROOT, 'standalone', 'token-setup.mjs');
const read = f => fs.readFileSync(f, 'utf8');
const ONLY = 'token-kit,baseline,lean,caveman,rules,handoff,codex-baseline,codex-rules,agy-baseline,agy-rules,cursor-rules';
const homes = H => ['--claude-home', path.join(H, '.claude'), '--codex-home', path.join(H, '.codex'), '--agy-home', path.join(H, '.gemini'), '--cursor-home', path.join(H, '.cursor')];
const askai = (H, ...a) => cp.spawnSync(process.execPath, [ASKAI, ...a, ...homes(H)], { encoding: 'utf8', env: { ...process.env, HOME: H, USERPROFILE: H } });
const ts = (H, ...a) => cp.spawnSync(process.execPath, [TS, '--home', H, '--tools', 'claude,codex,agy,cursor', ...a], { encoding: 'utf8' });
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };

test('install.ps1: every option it passes is an askai.js flag, every -Action is a command, every parameter is documented', () => {
  const ps = read(path.join(ROOT, 'install.ps1')).replace(/\r\n/g, '\n');
  const js = read(ASKAI);
  const flags = [...ps.matchAll(/\$argv \+= (?:@\()?'(--[a-z-]+)'/g)].map(m => m[1]);
  assert.ok(flags.length >= 25, `found ${flags.length} flags`);
  for (const f of flags) assert.match(js, new RegExp(`['"]?${f.slice(2)}['"]?: ?'`), `askai.js accepts ${f}`);
  const actions = /\[ValidateSet\(([^)]*)\)\]\[string\]\$Action/.exec(ps)[1].match(/'([a-z]+)'/g).map(x => x.slice(1, -1));
  for (const a of actions) assert.match(js, new RegExp(`case '${a}'`), `askai.js has command ${a}`);
  const params = [...ps.matchAll(/^\s*(?:\[[^\]]*\])*\$([A-Za-z0-9]+)/gm)].map(m => m[1]).filter(n => !['argv', 'node', 'script'].includes(n));
  const documented = [...ps.matchAll(/^\.PARAMETER (\w+)/gm)].map(m => m[1]);
  const declared = /param\(([\s\S]*?)\n\)/.exec(ps)[1].match(/\$([A-Za-z0-9]+)/g).map(x => x.slice(1));
  for (const p of declared) assert.ok(documented.includes(p), `.PARAMETER ${p} is documented`);
  assert.ok(!/RTK, Context Mode, Serena and the token rules/.test(ps), 'help text is current');
  assert.ok(params.length > 0);
});

test('AskAI applies every setting the standalone script applies, with the same values', () => {
  const A = tmpHome(), B = tmpHome();
  try {
    const r = askai(A, 'install', '--yes', '--target', 'all', '--only', ONLY);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(ts(B, '--apply').status, 0);
    const sa = JSON.parse(read(path.join(A, '.claude', 'settings.json'))), sb = JSON.parse(read(path.join(B, '.claude', 'settings.json')));
    for (const [k, v] of Object.entries(sb)) {
      if (k === 'statusLine') continue;
      if (k === 'env') { for (const [ek, ev] of Object.entries(v)) assert.strictEqual(sa.env[ek], ev, `env.${ek}`); continue; }
      if (k === 'permissions') { for (const d of v.deny) assert.ok(sa.permissions.deny.includes(d), d); continue; }
      assert.deepStrictEqual(sa[k], v, k);
    }
    const toml = t => { let tab = ''; const m = {}; for (const l of t.split(/\r?\n/)) { const h = /^\[([^\]]+)\]/.exec(l); if (h) tab = h[1]; const kv = /^(\w+) = (.+)$/.exec(l); if (kv) m[`${tab}.${kv[1]}`] = kv[2]; } return m; };
    const ca = toml(read(path.join(A, '.codex', 'config.toml'))), cb = toml(read(path.join(B, '.codex', 'config.toml')));
    for (const [k, v] of Object.entries(cb)) assert.strictEqual(ca[k], v, `config.toml ${k}`);
    assert.strictEqual(JSON.parse(read(path.join(A, '.gemini', 'antigravity-cli', 'settings.json'))).useG1Credits, false);
  } finally { rm(A); rm(B); }
});

test('askai install takes over a previous token-setup run: same settings, one rules block, no duplicate handoff', () => withHome(H => {
  fs.mkdirSync(path.join(H, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(H, '.claude', 'CLAUDE.md'), '# my own notes\n');
  assert.strictEqual(ts(H, '--apply').status, 0);
  assert.ok(fs.existsSync(path.join(H, '.token-kit', 'state.json')) && read(path.join(H, '.claude', 'CLAUDE.md')).includes('token-kit:begin'));
  const dry = askai(H, 'install', '--dry-run', '--yes', '--target', 'all', '--only', ONLY);
  assert.match(dry.stdout, /token-kit\s+partial/);
  const r = askai(H, 'install', '--yes', '--target', 'all', '--only', ONLY);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(path.join(H, '.token-kit', 'state.json')), 'token-setup state removed');
  for (const f of [['.claude', 'CLAUDE.md'], ['.codex', 'AGENTS.md'], ['.gemini', 'GEMINI.md']]) assert.ok(!read(path.join(H, ...f)).includes('token-kit:begin'), `${f.join('/')}: no token-kit block`);
  assert.ok(read(path.join(H, '.claude', 'CLAUDE.md')).startsWith('# my own notes'), 'user text kept');
  assert.ok(!fs.existsSync(path.join(H, '.claude', 'commands', 'handoff.md')) && fs.existsSync(path.join(H, '.claude', 'commands', 'askai-cli.md')));
  assert.ok(!fs.existsSync(path.join(H, '.cursor', 'rules', 'token-rules.mdc')));
  const s = JSON.parse(read(path.join(H, '.claude', 'settings.json')));
  assert.strictEqual(s.model, 'haiku'); assert.strictEqual(s.effortLevel, 'medium'); assert.strictEqual(s.promptSuggestionEnabled, false);
  // and token-setup now steps aside
  const again = ts(H, '--apply');
  assert.strictEqual(again.status, 0); assert.match(again.stdout, /AskAI is installed/);
  assert.ok(!fs.existsSync(path.join(H, '.token-kit', 'state.json')) && !read(path.join(H, '.claude', 'CLAUDE.md')).includes('token-kit:begin'));
}));

test('install then uninstall through the CLI leaves nothing of AskAI behind in any of the four tools', () => withHome(H => {
  const only = 'token-kit,baseline,lean,caveman,rules,statusline,prompt-hooks,handoff,cursor-rules,codex-baseline,codex-rules,agy-baseline,agy-rules,agy-path-rules';
  const inst = askai(H, 'install', '--yes', '--target', 'all', '--profile', 'coding', '--only', only);
  assert.strictEqual(inst.status, 0, inst.stdout + inst.stderr);
  const has = (dir, re) => { try { return fs.readdirSync(dir).some(f => re.test(f)); } catch (_) { return false; } };
  assert.ok(has(path.join(H, '.cursor', 'rules'), /^askai-.*\.mdc$/) && has(path.join(H, '.claude', 'rules'), /^askai-/), 'rules written');
  assert.ok(fs.existsSync(path.join(H, '.claude', 'askai', 'app', 'docs', 'INSTALL.md')) && fs.existsSync(path.join(H, '.claude', 'askai', 'app', 'docs', 'askai-mediator.png')), 'the installed copy carries the documents');
  const un = askai(H, 'uninstall', '--yes');
  assert.strictEqual(un.status, 0, un.stdout + un.stderr);
  assert.ok(!has(path.join(H, '.cursor', 'rules'), /^askai-/), 'no Cursor rules left: ' + un.stdout);
  assert.ok(!has(path.join(H, '.claude', 'rules'), /^askai-/), 'no Claude path rules left');
  assert.ok(!has(path.join(H, '.claude', 'commands'), /^askai-/) && !has(path.join(H, '.cursor', 'commands'), /^askai-/), 'no commands left');
  const json = f => { try { return JSON.parse(read(f)); } catch (_) { return {}; } };
  const s = json(path.join(H, '.claude', 'settings.json'));
  for (const k of ['model', 'effortLevel', 'autoCompactWindow', 'promptSuggestionEnabled', 'bashOutputMaxChars', 'statusLine']) assert.ok(!(k in s), `settings.json: ${k} removed`);
  assert.ok(!/askai/i.test(JSON.stringify(s)), 'no AskAI hook or setting left in settings.json');
  assert.ok(!('useG1Credits' in json(path.join(H, '.gemini', 'antigravity-cli', 'settings.json'))), 'Antigravity key removed');
  const text = f => { try { return read(f); } catch (_) { return ''; } };
  assert.ok(!/model_reasoning_effort|auto_recap/.test(text(path.join(H, '.codex', 'config.toml'))), 'Codex keys removed');
  for (const f of [['.claude', 'CLAUDE.md'], ['.codex', 'AGENTS.md'], ['.gemini', 'GEMINI.md']]) assert.ok(!/askai/i.test(text(path.join(H, ...f))), `${f.join('/')}: no askai block`);
}));

test('windows-selftest.ps1 only uses install.ps1 parameters and askai.js flags that exist, and works in a temporary folder', () => {
  const st = read(path.join(ROOT, 'scripts', 'windows-selftest.ps1')).replace(/\r\n/g, '\n');
  const ps = read(path.join(ROOT, 'install.ps1')).replace(/\r\n/g, '\n');
  const declared = /param\(([\s\S]*?)\n\)/.exec(ps)[1].match(/\$([A-Za-z]+)/g).map(x => x.slice(1).toLowerCase());
  const used = [...st.matchAll(/& \$ps1 ([^\n]*)/g)].flatMap(m => [...m[1].matchAll(/-([A-Za-z]+)/g)].map(x => x[1].toLowerCase()));
  const hashKeys = /\$homes = @\{([^}]*)\}/.exec(st)[1].match(/(\w+) =/g).map(x => x.replace(' =', '').toLowerCase());
  assert.ok(used.length >= 8, used.join(','));
  for (const p of [...used, ...hashKeys]) assert.ok(declared.includes(p), `install.ps1 declares -${p}`);
  const js = read(ASKAI);
  for (const f of [...st.matchAll(/'(--[a-z-]+)'/g)].map(m => m[1])) assert.match(js, new RegExp(`['"]?${f.slice(2)}['"]?: ?'`), `askai.js accepts ${f}`);
  assert.match(st, /GetTempPath\(\)/); assert.match(st, /Remove-Item -Recurse -Force \$tmp/);
});
