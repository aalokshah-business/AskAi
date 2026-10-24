'use strict';
// askai test: run the commands that only read this machine, then write one capture.
// Install, update, and anything that launches an agent or writes project files are left out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const PLAN = [
  { args: ['version'], timeout: 20000 },
  { args: ['version','--json'], timeout: 20000 },
  { args: ['help'], timeout: 20000 },
  { args: ['status'], timeout: 45000 },
  { args: ['status','--brief'], timeout: 20000 },
  { args: ['check'], timeout: 45000 },
  { args: ['ask'], timeout: 20000 },
  { args: ['ask', 'compact'], timeout: 20000 },
  { args: ['profiles'], timeout: 20000 },
  { args: ['suggest', '.'], timeout: 45000 },
  { args: ['tips'], timeout: 20000 },
  { args: ['tips', 'peak'], timeout: 20000 },
  { args: ['guide'], timeout: 20000 },
  { args: ['models'], timeout: 30000 },
  { args: ['mcp'], timeout: 30000 },
  { args: ['mcp','telemetry'], timeout: 30000 },
  { args: ['plugins'], timeout: 30000 },
  { args: ['plugins', 'ready'], timeout: 45000 },
  { args: ['infra'], timeout: 60000 },
  { args: ['audit'], timeout: 60000 },
  { args: ['todo'], timeout: 45000 },
  { args: ['savings', '7'], timeout: 120000 },
  { args: ['savings'], timeout: 90000 },
  { args: ['docs'], timeout: 20000 },
  { args: ['chat'], timeout: 20000 },
  { args: ['statusline', '--demo'], timeout: 20000 },
  { args: ['prompt', 'fix the login check'], timeout: 20000 },
  { args: ['context'], timeout: 20000 },
  { args: ['clear'], timeout: 30000 },
  { args: ['diff'], timeout: 30000 },
  { args: ['session', 'status'], timeout: 30000 },
  { args: ['review', 'status'], timeout: 90000 },
  { args: ['project', 'list'], timeout: 30000 },
  { args: ['project', 'show'], timeout: 30000 },
  { args: ['restore'], timeout: 30000 },
  { args: ['shell', 'init', 'powershell'], timeout: 20000 },
  { args: ['go', 'claude', '--dry-run', 'say hi'], timeout: 30000 },
  { args: ['map', '--dry-run'], timeout: 45000 },
  { args: ['scaffold', '--dry-run'], timeout: 30000 },
  { args: ['next'], timeout: 45000 },
  { args: ['weigh'], timeout: 20000 },
  { args: ['route', 'rename the helper'], timeout: 20000 },
  { args: ['route', 'design the auth model'], timeout: 20000 },
  { args: ['route', 'add the export'], timeout: 20000 },
  { args: ['errors'], timeout: 20000 },
  { args: ['handoff', 'next step'], timeout: 30000 },
  { args: ['snapshot'], timeout: 30000 },
  { args: ['stop', '--dry-run'], timeout: 20000 },
  { args: ['check', '--json'], timeout: 45000 },
  { args: ['check', '--env'], timeout: 20000 },
  { args: ['savings', '--cache'], timeout: 30000 },
  { args: ['plugins', 'info', 'rtk'], timeout: 20000 },
];
const EXPECT = {
  clear: { exit: 1, why: 'a fresh fixture handoff is still a template' },
  'project show': { exit: 1, why: 'no project is selected in the fixture' },
  'mcp on': { exit: 1, why: 'server name is required' },
  'mcp off': { exit: 1, why: 'server name is required' },
  'why handoff.empty': { exit: 1, why: 'fixture handoff has become a draft, not the empty template' },
};

const SKIPPED = 'cli (interactive). hook is retired. writes run on a throwaway fixture, not this repo.';
const READONLY = new Set(['status', 'check', 'audit', 'mcp', 'infra', 'plugins', 'todo', 'savings', 'next']);

function defaultOut(cwd) {
  const root = cwd || process.cwd();
  const local = path.join(root, '.ai-work', 'askai-test.txt');
  try { fs.mkdirSync(path.dirname(local), { recursive: true }); return local; }
  catch (_) {
    const tmp = path.join(os.tmpdir(), 'askai-test.txt');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    return tmp;
  }
}
function sandboxEnv(cwd) {
  const home = path.join(cwd || process.cwd(), '.ai-work', 'sandbox-home');
  fs.mkdirSync(home, { recursive: true });
  return {
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    ASKAI_SANDBOX: '1',
  };
}

function clip(text, max = 800) {
  const lines = String(text || '').replace(/\s+$/, '').split(/\r?\n/);
  if (lines.length <= max) return lines.join('\n');
  return `${lines.slice(0, max).join('\n')}\n… ${lines.length - max} more lines not copied`;
}

function spawnAskai(askai, args, timeout, cwd, opts = {}) {
  const env = { ...process.env, NO_COLOR: '1' };
  if (!opts.real) Object.assign(env, sandboxEnv(cwd));
  const r = cp.spawnSync(process.execPath, [askai, ...args], {
    encoding: 'utf8',
    timeout,
    cwd,
    env,
    stdio: opts.notty ? ['ignore', 'pipe', 'pipe'] : undefined,
    maxBuffer: 12 * 1024 * 1024,
  });
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  return {
    code: timedOut ? null : (r.status == null ? 1 : r.status),
    timedOut,
    error: r.error && !timedOut ? r.error.message : '',
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function normalize(raw) {
  return {
    code: raw && raw.code != null ? raw.code : null,
    timedOut: !!(raw && raw.timedOut),
    error: raw && raw.error ? String(raw.error) : '',
    stdout: raw && raw.stdout ? String(raw.stdout) : '',
    stderr: raw && raw.stderr ? String(raw.stderr) : '',
  };
}

function firstLine(text) {
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const hit = lines.find(l => /FAIL|failing|to improve|warning\(s\)|failure\(s\)|empty template|not a git|Give the level/.test(l));
  const raw = hit || lines[0] || '';
  const dot = raw.indexOf('. ');
  const sentence = dot > 10 ? raw.slice(0, dot + 1) : raw;
  return sentence.slice(0, 80);
}

function lookReason(row) {
  if (row.timedOut || row.error) return '';
  const text = `${row.stdout}\n${row.stderr}`;
  if (row.args[0] === 'context' && /Give the level/.test(text)) return '';
  const parts = [];
  const failing = text.match(/(\d+) failing/);
  const failures = text.match(/(\d+) failure\(s\)/);
  const warnings = text.match(/(\d+) warning\(s\)/);
  const improve = text.match(/(\d+) to improve/);
  if (failing && Number(failing[1]) > 0) parts.push(`${failing[1]} failing`);
  if (failures && Number(failures[1]) > 0) parts.push(`${failures[1]} failure(s)`);
  if (warnings && Number(warnings[1]) > 0) parts.push(`${warnings[1]} warning(s)`);
  if (improve && Number(improve[1]) > 0) parts.push(`${improve[1]} to improve`);
  let expect = (row.expect && row.expect.exit != null) ? row.expect.exit : (EXPECT[row.label] != null ? EXPECT[row.label].exit : (EXPECT[row.args[0]] ? EXPECT[row.args[0]].exit : 0));
  if (row.args[0] === 'update' && row.args.includes('--check')) expect = row.code;
  if (row.code && row.code !== expect) parts.push(`exit ${row.code}`);
  if (!parts.length) return '';
  const line = firstLine(text);
  if (!line) return parts.join(', ');
  const prefix = parts.join(', ');
  const cleaned = line.replace(/^(exit \d+|(\d+) (failing|failure\(s\)|warning\(s\)|to improve))[: ·—\s]*/i, '').trim();
  if (!cleaned || cleaned.toLowerCase() === prefix.toLowerCase()) return prefix;
  return `${prefix} — ${cleaned}`;
}

function header(meta = {}) {
  const platform = require('./platform');
  return {
    os: meta.os || `${os.platform()} ${os.release()}`,
    shell: meta.shell || platform.shellName(),
    node: meta.node || process.version,
    stdinTTY: meta.stdinTTY != null ? meta.stdinTTY : !!process.stdin.isTTY,
    stdoutTTY: meta.stdoutTTY != null ? meta.stdoutTTY : !!process.stdout.isTTY,
    git: meta.git || 'unknown',
    container: meta.container != null ? meta.container : platform.inContainer(),
    sandbox: 'yes',
  };
}
function renderCapture(results, meta) {
  const h = header(meta);
  const blocks = [
    '# askai test',
    `version: ${meta.version || ''}`,
    `when: ${meta.when}`,
    `cwd: ${meta.cwd}`,
    `os: ${h.os}`,
    `shell: ${h.shell}`,
    `node: ${h.node}`,
    `tty: stdin ${h.stdinTTY ? 'yes' : 'no'}, stdout ${h.stdoutTTY ? 'yes' : 'no'}`,
    `git: ${h.git}; safe.directory ${meta.safe || 'ok'}`,
    `container: ${h.container ? 'yes' : 'no'}`,
    `sandbox: ${meta.mode === 'real' ? 'no' : h.sandbox}`,
    `mode: ${meta.mode || 'sandbox'}`,
    meta.mode === 'real'
      ? 'homes: real Cursor and Claude homes. This mode does not write.'
      : 'homes: sandbox, not the real Cursor or Claude home. askai test --real reads those homes and does not write.',
    `skipped: ${SKIPPED}`,
    '',
  ];
  for (const row of results) {
    const exit = row.timedOut ? 'timeout' : (row.error ? `error: ${row.error}` : String(row.code));
    blocks.push(`## askai ${row.label}`, `exit: ${exit}`, `ms: ${row.ms}`, '--- stdout ---', clip(row.stdout), '--- stderr ---', clip(row.stderr), '');
  }
  return blocks.join('\n');
}

function judge(row) {
  const flags = [];
  let budgets = {};
  try { budgets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'budgets.json'), 'utf8')); } catch (_) { budgets = {}; }
  const key = row.args[0] === 'session' ? 'session status' : row.args[0];
  const lines = String(row.stdout || '').split(/\r?\n/).filter(l => l.length);
  const cap = budgets[key];
  if (cap && lines.length > cap) flags.push(`over budget ${lines.length}>${cap}`);
  const wide = lines.some(l => l.length > (l.includes('|') ? 160 : 120));
  if (wide) flags.push('line over 120');
  if (row.ms > 3000) flags.push(`slow ${row.ms}ms`);
  const err = String(row.stderr || '').replace(/Node 20 is end-of-life[^\n]*\n?/g, '').replace(/working\.\.\.\n?/g, '').trim();
  if (row.code === 0 && err) flags.push('stderr on exit 0');
  const seen = new Map();
  for (const l of lines) {
    if (l.length >= 80 && !/^[ |+\-]+$/.test(l) && !/\bFinding\b.*\bEvidence\b/.test(l)) seen.set(l, (seen.get(l) || 0) + 1);
    if (/\?$/.test(l) && l.length > 40 && !/\?/.test(l.slice(0, -1))) flags.push('cut off');
    if (/^(?:\?\?|[ MADRCU]{2}) /.test(l) && l.slice(0,2).trim()) flags.push('raw git status');
    if (l.includes('|') && /\d/.test(l) && !/[1-9]/.test(l)) flags.push('zero table');
  }
  if ([...seen.values()].some(n => n > 1)) flags.push('repeated block');
  return [...new Set(flags)];
}
function summarize(results, file, opts = {}) {
  const unfinished = results.filter(r => r.timedOut || r.error);
  const look = results.filter(r => r.look);
  const lines = [];
  if (!unfinished.length && !look.length) lines.push(`askai test — ${results.length} commands ran, all finished fine`);
  else if (!unfinished.length) lines.push(`askai test — ${results.length} commands ran, all finished`);
  else lines.push(`askai test — ${results.length} commands ran · ${unfinished.length} did not finish`);
  if (unfinished.length) {
    lines.push('', 'Did not finish:');
    const w = Math.min(36, Math.max(20, ...unfinished.slice(0, 8).map(r => r.label.length)));
    unfinished.slice(0, 8).forEach((r, i) => lines.push(` ${String(i + 1).padStart(2)} ${r.label.padEnd(w)}  ${r.timedOut ? 'timed out' : r.error}`));
  }
  if (look.length) {
    lines.push('', `${look.length} need a look:`);
    const w = Math.min(36, Math.max(20, ...look.slice(0, 8).map(r => r.label.length)));
    look.slice(0, 8).forEach((r, i) => {
      const idx = String(i + 1).padStart(2);
      lines.push(` ${idx} ${r.label.padEnd(w)}  │ ${r.look}`);
    });
    if (look.length > 8) lines.push(`    ... and ${look.length - 8} more in the capture`);
  }
  const flagged = results.filter(r => (r.flags || []).length);
  const defects = flagged.filter(r => (r.flags || []).some(f => f === 'stderr on exit 0' || f === 'line over 120')).length;
  const failedChecks = results.filter(r => {
    const expect = (r.expect && r.expect.exit != null) ? r.expect.exit : (EXPECT[r.label] != null ? EXPECT[r.label].exit : (EXPECT[r.args[0]] ? EXPECT[r.args[0]].exit : 0));
    return !r.timedOut && !r.error && r.code !== expect;
  }).length;
  lines.push('', `${flagged.length} commands with presentation flags (review hints) · ${failedChecks} checks failed`);
  if (opts.mode !== 'real') {
    lines.push('not evaluated: MCP servers on the real Cursor home (sandbox home is empty)');
    lines.push('not evaluated: ripgrep, jq and gh on this machine (sandbox PATH)');
  }
  lines.push('', `Capture: ${file}`);
  lines.push('That file is the full output, for improving AskAI.');
  return lines.join('\n');
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askai-fixture-'));
  const write = (rel, text) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  cp.spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  for (let i = 1; i <= 5; i++) write(`src/f${i}.js`, `module.exports = ${i};\n`);
  write('AGENTS.md', '# Fixture project\nSearch source before reading.\n');
  cp.spawnSync('git', ['add', 'src'], { cwd: dir, stdio: 'ignore' });
  cp.spawnSync('git', ['-c', 'user.email=askai@example.com', '-c', 'user.name=AskAI', 'commit', '-m', 'fixture'], { cwd: dir, stdio: 'ignore' });
  for (let i = 1; i <= 5; i++) write(`src/f${i}.js`, `module.exports = ${i + 10};\n`);
  for (let i = 1; i <= 24; i++) write(`.ai-work/notes/n${i}.md`, `note ${i}\n`);
  write('.ai-work/HANDOFF.md', '# HANDOFF\nTODO(you): next steps\n');
  write('ThirdParty/lib.js', 'module.exports = 1;\n');
  write('_out/built.js', 'module.exports = 1;\n');
  write('docs/ai/SOURCE_INDEX.md', `${Array.from({ length: 7000 }, (_, i) => `line ${i}`).join('\n')}\n`);
  return dir;
}
function fullPlan() {
  const extra = [
    ['setup', '--dry-run'], ['install', '--dry-run', '--profile', 'lean'], ['install', '--dry-run', '--profile', 'code'],
    ['install', '--dry-run', '--profile', 'full'], ['install', '--dry-run', '--profile', 'experimental'],
    ['uninstall', '--dry-run'], ['update', '--check'], ['tools', 'update', '--dry-run'],
    ['profiles', 'migrate', '--dry-run'], ['init'], ['project', 'refresh'], ['project', 'hide-local'], ['project', 'hide-local', '--undo'],
    ['break'], ['resume'], ['handoff'], ['snapshot'], ['clear'], ['next'], ['weigh'],
    ['route', 'say hi'], ['route', 'fix the login bug in src/auth.ts'], ['route', 'design the auth boundary'],
    ['run', '--', 'node', '-e', '"process.exit(0)"'], ['run', '--', 'node', '-e', '"process.exit(1)"'],
    ['errors'], ['stop', '--dry-run'], ['convert', 'scan'], ['graph', '--print'],
    ['mcp', 'on'], ['mcp', 'off'], ['bootstrap', '--dry-run'],
    ['savings', '--cache'], ['savings', '--full'], ['savings', '--week'],
    ['check', '--all'], ['check', '--json'], ['check', '--env'], ['check', '--fix', '--dry-run'],
    ['version', '--all'], ['models', 'verify'],
    ['session','quota','plan'], ['session','quota','report'],
  ];
  let plugins = []; let topics = []; let moments = []; let hosts = []; let commands = [];
  try { plugins = require('./plugins').P.map(p => p.id); } catch (_) { /* none */ }
  try { topics = require('./knowledge').loadAll(path.join(__dirname, '..', 'knowledge')).map(e => e.id); } catch (_) { /* none */ }
  try { moments = require('./guide').ORDER || []; } catch (_) { /* none */ }
  try { hosts = ['claude', 'codex', 'cursor', 'agy']; } catch (_) { /* none */ }
  try { commands = require('./help').names(); } catch (_) { /* none */ }
  const steps = PLAN.concat(extra.map(args => ({ args, timeout: 20000,
    ...(args[0] === 'run' && args.at(-1) === '"process.exit(1)"' ? {expect:{exit:1}} : {}) })));
  for (const id of plugins) steps.push({ args: ['plugins', 'info', id], timeout: 20000 });
  for (const id of topics) steps.push({ args: ['ask', id], timeout: 20000 });
  for (const id of moments) steps.push({ args: ['guide', id], timeout: 20000 });
  for (const id of hosts) steps.push({ args: ['tips', id], timeout: 20000 });
  for (const id of commands) steps.push({ args: ['help', id], timeout: 20000 });
  for (const id of ['handoff.empty', 'agents.drift', 'ctx.large-file']) steps.push({ args: ['why', id], timeout: 20000 });
  return steps;
}
function rowJson(row) {
  const lines = String(row.stdout || '').split(/\r?\n/);
  return { cmd: row.label, exit: row.code, ms: row.ms, lines: lines.filter(l => l.length).length, maxWidth: lines.reduce((n, l) => Math.max(n, l.length), 0), flags: row.flags || [] };
}
function compareJson(file, rows) {
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return [`compare: ${e.message}`]; }
  const by = new Map((Array.isArray(prev) ? prev : []).map(r => [r.cmd, r]));
  const out = [];
  for (const row of rows) {
    const old = by.get(row.cmd);
    if (!old) continue;
    if (row.lines > old.lines) out.push(`${row.cmd}: lines ${old.lines} -> ${row.lines}`);
    if (old.ms && row.ms > old.ms * 1.5 && row.ms - old.ms > 500) out.push(`${row.cmd}: ms ${old.ms} -> ${row.ms}`);
  }
  return out;
}
function run(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const file = opts.out || defaultOut(cwd);
  const askai = opts.askai || path.join(__dirname, '..', 'askai.js');
  const steps = opts.plan || (opts.runner ? PLAN : (opts.real ? PLAN.filter(s => READONLY.has(s.args[0])) : fullPlan()));
  const runner = opts.runner || ((args, timeout, extra) => spawnAskai(askai, args, timeout, cwd, { ...opts, ...extra }));
  const results = [];
  for (const step of steps) {
    const started = Date.now();
    let raw;
    try { raw = normalize(runner(step.args, step.timeout)); }
    catch (e) { raw = { code: null, timedOut: false, error: e.message, stdout: '', stderr: '' }; }
    const row = { ...raw, args: step.args, label: step.args.join(' '), expect: step.expect, ms: Date.now() - started };
    row.look = lookReason(row);
    row.flags = judge(row);
    results.push(row);
  }
  if (opts.notty && !opts.runner) {
    for (const args of [['help'], ['status'], ['check']]) {
      const started = Date.now();
      let raw;
      try { raw = normalize(runner(args, 20000, { notty: true })); }
      catch (e) { raw = { code: null, timedOut: false, error: e.message, stdout: '', stderr: '' }; }
      const row = { ...raw, args, label: `${args.join(' ')} (notty)`, ms: Date.now() - started };
      row.look = lookReason(row);
      row.flags = judge(row);
      results.push(row);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const platform = require('./platform');
  let git = 'absent';
  let safe = 'ok';
  try {
    const facts = platform.gitFacts(cwd);
    git = facts.version || 'absent';
    safe = facts.dubious ? 'blocked' : 'ok';
  } catch (_) { /* git is optional for the header */ }
  const mode = opts.mode || (opts.real ? 'real' : 'sandbox');
  const meta = header({
    version: opts.version || '', os: `${os.platform()} ${os.release()}`, node: process.version,
    git, container: platform.inContainer(), stdinTTY: !!process.stdin.isTTY, stdoutTTY: !!process.stdout.isTTY,
  });
  const rows = results.map(rowJson);
  fs.writeFileSync(file, renderCapture(results, { version: opts.version || '', when: new Date().toISOString(), cwd, mode, safe, ...meta }));
  if (opts.json) fs.writeFileSync(`${file}.json`, `${JSON.stringify(rows, null, 2)}\n`);
  const compared = opts.compare ? compareJson(opts.compare, rows) : [];
  const summary = [summarize(results, file, { mode }), ...compared].filter(Boolean).join('\n');
  return { file, results, rows, header: meta, summary, failedToRun: results.some(r => r.timedOut || r.error) };
}

module.exports = { PLAN, SKIPPED, READONLY, run, defaultOut, lookReason, sandboxEnv, header, judge, makeFixture, fullPlan, compareJson };
