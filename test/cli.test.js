'use strict';
// End-to-end runs of askai.js against a throwaway --claude-home. Only the components that touch nothing outside that folder
// (baseline, caveman, statusline) are exercised, so no winget, uv, network or plugin command is ever run.
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, select, VERSION } = require('../askai');
const { ASKAI, WIN, tmpHome, rm, write, readJson, cli, fs, path } = require('./helpers');

const SAFE = ['--only', 'baseline,caveman,statusline', '--no-path', '--yes'];
const run = (home, ...args) => cli([...args, '--claude-home', home]);
function withHome(fn) {
  const home = tmpHome();
  try { return fn(home); } finally { rm(home); }
}
const sha = f => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('parseArgs: flags, values, --opt=value, and errors', () => {
  const o = parseArgs(['install', '--yes', '--only=a,b', '--caveman', 'ultra', '--dry-run']);
  assert.deepStrictEqual([o.yes, o.only, o.caveman, o.dry], [true, 'a,b', 'ultra', true]);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['--caveman', 'loud']), /must be lite, full, ultra or off/);
  assert.throws(() => parseArgs(['--only']), /needs a value/);
});

test('select: caveman-plugin only with --caveman-plugin or --only; unknown ids rejected; uninstall runs in reverse', () => {
  const ids = o => select(o, 'install').map(c => c.id);
  assert.ok(!ids({}).includes('caveman-plugin'));
  assert.ok(ids({ cavemanPlugin: true }).includes('caveman-plugin'));
  assert.deepStrictEqual(ids({ only: 'caveman-plugin' }), ['caveman-plugin']);
  assert.ok(!ids({ noStatusline: true }).includes('statusline'));
  assert.ok(!ids({ skip: 'serena' }).includes('serena'));
  assert.throws(() => select({ only: 'nope' }, 'install'), /unknown component "nope"/);
  const un = select({}, 'uninstall').map(c => c.id);
  assert.strictEqual(un[0], 'code-intel', 'uninstall runs in reverse of ALL');
  assert.ok(un.indexOf('statusline') < un.indexOf('claude'));
  assert.strictEqual(un[un.length - 1], 'token-kit', 'token-kit installs first, so it uninstalls last');
  assert.strictEqual(un[un.length - 2], 'claude');
});

test('version, help and usage exit codes', () => {
  assert.strictEqual(cli(['version']).out.trim(), VERSION);
  assert.strictEqual(cli(['help']).code, 0);
  assert.strictEqual(cli([]).code, 2);
  assert.strictEqual(cli(['bogus']).code, 2);
  assert.strictEqual(cli(['install', '--bogus']).code, 2);
});

test('install writes only into the given home, is idempotent, and records a manifest', () => withHome(home => {
  write(`${home}/CLAUDE.md`, '# Mine\n');
  write(`${home}/settings.json`, JSON.stringify({ model: 'opus' }));
  const r1 = run(home, 'install', ...SAFE);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  const s = readJson(`${home}/settings.json`);
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.autoCompactWindow, 150000);
  assert.match(s.statusLine.command, /askai\.js" statusline/);
  assert.ok(fs.readFileSync(`${home}/CLAUDE.md`, 'utf8').includes('askai:begin'));
  for (const f of ['askai/app/askai.js', 'askai/app/lib/components.js', 'askai/manifest.json', 'commands/askai-status.md', 'commands/askai-report.md']) {
    assert.ok(fs.existsSync(path.join(home, f)), `${f} exists`);
  }
  const cmdText = fs.readFileSync(`${home}/commands/askai-status.md`, 'utf8');
  assert.ok(!cmdText.includes('{{ASKAI}}'), 'placeholder substituted');
  assert.match(cmdText, /askai\.js/);
  assert.ok(fs.readdirSync(`${home}/askai/backups`).length >= 1, 'existing files were backed up');

  const before = ['settings.json', 'CLAUDE.md'].map(f => sha(path.join(home, f)));
  const r2 = run(home, 'install', ...SAFE);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  assert.deepStrictEqual(['settings.json', 'CLAUDE.md'].map(f => sha(path.join(home, f))), before, 'second run changes neither file');
}));

test('AskAI CLI entry installs and uninstalls in all four hosts', () => withHome(root => {
  const homes = Object.fromEntries(['claude', 'cursor', 'codex', 'agy'].map(n => [n, path.join(root, n)]));
  const flags = ['--claude-home', homes.claude, '--cursor-home', homes.cursor, '--codex-home', homes.codex, '--agy-home', homes.agy, '--target', 'all', '--only', 'baseline', '--no-path', '--yes'];
  const paths = [
    path.join(homes.claude, 'commands', 'askai-cli.md'),
    path.join(homes.cursor, 'commands', 'askai-cli.md'),
    path.join(homes.codex, 'prompts', 'askai-cli.md'),
    path.join(homes.codex, 'agents-skills', 'askai-cli', 'SKILL.md'),
    path.join(homes.agy, 'antigravity-cli', 'skills', 'askai-cli', 'SKILL.md'),
    path.join(homes.agy, 'config', 'skills', 'askai-cli', 'SKILL.md'),
  ];
  const first = cli(['install', ...flags]);
  assert.strictEqual(first.code, 0, first.out + first.err);
  for (const f of paths) assert.ok(fs.existsSync(f), `${f} exists`);
  assert.match(fs.readFileSync(paths[0], 'utf8'), /allowed-tools: Bash\(askai cli --launch\)[\s\S]*Run `askai cli --launch`/);
  assert.match(fs.readFileSync(paths[0], 'utf8'), /Print only its output, no commentary/);
  assert.match(fs.readFileSync(paths[2], 'utf8'), /Run `askai cli --launch`/);
  assert.match(fs.readFileSync(paths[3], 'utf8'), /name: askai-cli/);
  for (const f of paths) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\{\{ASKAI\}\}/);
  const second = cli(['install', ...flags]);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.match(second.out, /command entry points: 0 written/);
  const removed = cli(['uninstall', ...flags]);
  assert.strictEqual(removed.code, 0, removed.out + removed.err);
  for (const f of paths) assert.ok(!fs.existsSync(f), `${f} removed`);
}));

test('askai cli runs commands without prefixes and exits', () => {
  const cp = require('child_process');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'askai.js'), 'cli'], { input: 'version\nhelp cli\nexit\n', encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /AskAI CLI[\s\S]*askai> 1\.0\.2[\s\S]*askai cli: Open an AskAI-only terminal prompt/);
});

test('install replaces owned generic askai entry without deleting edited copies', () => withHome(home => {
  const flags = ['--claude-home', home, '--target', 'claude', '--only', 'baseline', '--no-path', '--yes'];
  assert.strictEqual(cli(['install', ...flags]).code, 0);
  const old = path.join(home, 'commands', 'askai.md');
  write(old, 'old generic command');
  const mf = path.join(home, 'askai', 'manifest.json');
  const man = readJson(mf); man.files.push({ path: old, sha: require('crypto').createHash('sha1').update(fs.readFileSync(old)).digest('hex') }); write(mf, JSON.stringify(man));
  const migrated = cli(['install', ...flags]);
  assert.strictEqual(migrated.code, 0, migrated.out + migrated.err);
  assert.ok(!fs.existsSync(old), migrated.out + migrated.err + JSON.stringify(readJson(mf).files));
  assert.ok(fs.existsSync(path.join(home, 'commands', 'askai-cli.md')));
  write(old, 'user edited command');
  const second = readJson(mf); second.files.push({ path: old, sha: 'not-current' }); write(mf, JSON.stringify(second));
  assert.strictEqual(cli(['install', ...flags]).code, 0);
  assert.strictEqual(fs.readFileSync(old, 'utf8'), 'user edited command');
}));

test('--dry-run writes nothing at all', () => withHome(home => {
  write(`${home}/settings.json`, '{"model":"opus"}');
  const before = sha(`${home}/settings.json`);
  const r = run(home, 'install', '--only', 'baseline,caveman,statusline', '--no-path', '--dry-run');
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /dry-run/);
  assert.strictEqual(sha(`${home}/settings.json`), before);
  assert.deepStrictEqual(fs.readdirSync(home).sort(), ['settings.json']);
}));

test('unparseable settings.json: install refuses and leaves the file untouched', () => withHome(home => {
  write(`${home}/settings.json`, '{ broken');
  const r = run(home, 'install', ...SAFE);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out + r.err, /cannot parse|will not overwrite/);
  assert.strictEqual(fs.readFileSync(`${home}/settings.json`, 'utf8'), '{ broken');
}));

test('non-interactive install without --yes refuses instead of hanging', () => withHome(home => {
  const r = cli(['install', '--only', 'baseline', '--no-path', '--claude-home', home]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out + r.err, /--yes/);
  assert.ok(!fs.existsSync(`${home}/settings.json`));
}));

test('uninstall removes only what askai added and keeps the rest and the backups', () => withHome(home => {
  const claudeMd = '# Mine\nKeep.\n';
  write(`${home}/CLAUDE.md`, claudeMd);
  write(`${home}/settings.json`, JSON.stringify({ model: 'opus', env: { KEEP: '1' } }));
  write(`${home}/commands/mine.md`, 'my own command');
  assert.strictEqual(run(home, 'install', ...SAFE).code, 0);

  const r = run(home, 'uninstall', ...SAFE);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const s = readJson(`${home}/settings.json`);
  assert.deepStrictEqual(s, { model: 'opus', env: { KEEP: '1' } });
  assert.strictEqual(fs.readFileSync(`${home}/CLAUDE.md`, 'utf8'), claudeMd);
  assert.ok(fs.existsSync(`${home}/commands/mine.md`), 'own command untouched');
  assert.ok(!fs.existsSync(`${home}/commands/askai-status.md`));
  assert.ok(!fs.existsSync(`${home}/askai/app`) && !fs.existsSync(`${home}/askai/manifest.json`));
  assert.ok(fs.existsSync(`${home}/askai/backups`), 'backups kept');
}));

test('uninstall on a machine askai never touched changes nothing', () => withHome(home => {
  write(`${home}/settings.json`, JSON.stringify({ autoCompactWindow: 150000, statusLine: { type: 'command', command: 'mine.sh' } }));
  const before = sha(`${home}/settings.json`);
  const r = run(home, 'uninstall', ...SAFE);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(sha(`${home}/settings.json`), before, 'values askai did not add are not removed');
}));

test('a command file the user edited after install is not deleted on uninstall', () => withHome(home => {
  assert.strictEqual(run(home, 'install', ...SAFE).code, 0);
  fs.appendFileSync(`${home}/commands/askai-status.md`, '\nmy edit\n');
  assert.strictEqual(run(home, 'uninstall', ...SAFE).code, 0);
  assert.ok(fs.existsSync(`${home}/commands/askai-status.md`));
  assert.ok(!fs.existsSync(`${home}/commands/askai-report.md`), 'unedited one is removed');
}));

test('restore lists backups and puts a backed-up file back', () => withHome(home => {
  assert.match(run(home, 'restore').out, /No backups yet/);
  write(`${home}/settings.json`, JSON.stringify({ model: 'opus' }));
  const original = fs.readFileSync(`${home}/settings.json`, 'utf8');
  assert.strictEqual(run(home, 'install', ...SAFE).code, 0);
  assert.notStrictEqual(fs.readFileSync(`${home}/settings.json`, 'utf8'), original);
  const stamp = fs.readdirSync(`${home}/askai/backups`)[0];
  assert.match(run(home, 'restore').out, new RegExp(stamp));
  assert.strictEqual(run(home, 'restore', stamp, '--yes').code, 0);
  assert.strictEqual(fs.readFileSync(`${home}/settings.json`, 'utf8'), original);
  assert.notStrictEqual(run(home, 'restore', 'no-such-stamp', '--yes').code, 0);
}));

test('status --json and doctor run read-only against an empty home', () => withHome(home => {
  const s = run(home, 'status', '--json', '--only', 'baseline,caveman,statusline');
  assert.strictEqual(s.code, 0, s.out + s.err);
  const j = JSON.parse(s.out);
  assert.ok(j && typeof j === 'object');
  run(home, 'doctor');
  // A real claude CLI, when present, may create its own .claude.json/backups here while answering `--version`; askai must not.
  for (const f of ['askai', 'settings.json', 'CLAUDE.md', 'commands']) assert.ok(!fs.existsSync(path.join(home, f)), `${f} not created`);
}));

test('report prints status, health, cache and spend sections and touches nothing of askai\'s', () => withHome(home => {
  const r = run(home, 'report', '1');
  assert.strictEqual(r.code, 0, r.out + r.err);
  // 4 sections, or 5 when ccusage happens to be on PATH: the total in the headings is dynamic.
  const at = [/1\/[45] +TOOLS AND MEASURED SAVINGS/, /2\/[45] +HEALTH/, /3\/[45] +CACHE AND CONTEXT PER SESSION, LAST 1h/, /\d\/[45] +SPEND FROM TRANSCRIPTS, LAST 1h/].map(re => r.out.search(re));
  assert.ok(at.every(i => i >= 0), `all four headings present: ${at}`);
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at, 'sections appear in order');
  assert.match(r.out, /(ok|warn) +node/, 'doctor rows are included');
  for (const f of ['askai', 'settings.json', 'CLAUDE.md', 'commands']) assert.ok(!fs.existsSync(path.join(home, f)), `${f} not created`);
}));

test('report --json is one JSON object with tools, health, cache, hosts and spend', () => withHome(home => {
  const r = run(home, 'report', '--hours', '1', '--json');
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.hours, 1);
  for (const k of ['hosts', 'cache', 'ccusage']) assert.ok(k in j, `${k} key present`);
  assert.strictEqual(j.hosts.claude, true);
  assert.strictEqual(j.hosts.cursor, false, 'a sandboxed run does not look at the real Cursor directory');
  assert.ok(Array.isArray(j.tools) && j.tools.length > 0);
  assert.ok(Array.isArray(j.health) && j.health.some(h => h.id === 'node'));
  assert.ok(j.spend && typeof j.spend === 'object' && !j.spend.error, JSON.stringify(j.spend).slice(0, 200));
}));

test('statusline prints a single line and never fails, even on garbage stdin', () => withHome(home => {
  const cp = require('child_process');
  for (const input of ['', 'not json', '{"model":{"display_name":"X"}}']) {
    const r = cp.spawnSync(process.execPath, [ASKAI, 'statusline', '--claude-home', home], { encoding: 'utf8', input });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim().split('\n').length, 1);
    assert.ok(r.stdout.trim().length > 0);
  }
}));

test('the installed copy is self-contained and runs from the app folder', () => withHome(home => {
  assert.strictEqual(run(home, 'install', ...SAFE).code, 0);
  const r = cli(['version'], { script: path.join(home, 'askai', 'app', 'askai.js') });
  assert.strictEqual(r.out.trim(), VERSION);
  const un = cli(['uninstall', ...SAFE, '--claude-home', home], { script: path.join(home, 'askai', 'app', 'askai.js') });
  assert.strictEqual(un.code, 0, un.out + un.err);
  assert.ok(!fs.existsSync(`${home}/commands/askai-status.md`));
}));

test('shim is written for Windows', { skip: !WIN }, () => withHome(home => {
  assert.strictEqual(run(home, 'install', ...SAFE).code, 0);
  const shim = fs.readFileSync(`${home}/askai/bin/askai.cmd`, 'utf8');
  assert.match(shim, /node "%~dp0\.\.\\app\\askai\.js" %\*/);
}));
