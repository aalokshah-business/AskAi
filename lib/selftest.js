'use strict';
// askai test: run the commands that only read this machine, then write one capture.
// Install, update, and anything that launches an agent or writes project files are left out.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const PLAN = [
  { args: ['version'], timeout: 20000 },
  { args: ['help'], timeout: 20000 },
  { args: ['status'], timeout: 45000 },
  { args: ['doctor'], timeout: 45000 },
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
  { args: ['plugins'], timeout: 30000 },
  { args: ['plugins', 'ready'], timeout: 45000 },
  { args: ['infra'], timeout: 60000 },
  { args: ['audit'], timeout: 60000 },
  { args: ['todo'], timeout: 45000 },
  { args: ['usage', '7'], timeout: 120000 },
  { args: ['report'], timeout: 120000 },
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
];

const SKIPPED = 'install, uninstall, update, upgrade, tools update, setup, init, start, break, resume, convert, hook, graph, set, cli';

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

function spawnAskai(askai, args, timeout, cwd) {
  const r = cp.spawnSync(process.execPath, [askai, ...args], {
    encoding: 'utf8',
    timeout,
    cwd,
    env: { ...process.env, NO_COLOR: '1', ...sandboxEnv(cwd) },
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
  return (hit || lines[0] || '').slice(0, 140);
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
  if (row.code) parts.push(`exit ${row.code}`);
  if (!parts.length) return '';
  const line = firstLine(text);
  return `${parts.join(', ')}${line ? ` — ${line}` : ''}`;
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
    `git: ${h.git}`,
    `container: ${h.container ? 'yes' : 'no'}`,
    `sandbox: ${h.sandbox}`,
    `skipped: ${SKIPPED}`,
    '',
  ];
  for (const row of results) {
    const exit = row.timedOut ? 'timeout' : (row.error ? `error: ${row.error}` : String(row.code));
    blocks.push(`## askai ${row.label}`, `exit: ${exit}`, `ms: ${row.ms}`, '--- stdout ---', clip(row.stdout), '--- stderr ---', clip(row.stderr), '');
  }
  return blocks.join('\n');
}

function summarize(results, file) {
  const unfinished = results.filter(r => r.timedOut || r.error);
  const look = results.filter(r => r.look);
  const lines = [];
  if (!unfinished.length && !look.length) lines.push(`askai test — ${results.length} commands ran, all finished fine`);
  else if (!unfinished.length) lines.push(`askai test — ${results.length} commands ran, all finished`);
  else lines.push(`askai test — ${results.length} commands ran · ${unfinished.length} did not finish`);
  if (unfinished.length) {
    lines.push('Did not finish');
    unfinished.slice(0, 8).forEach((r, i) => lines.push(` ${i + 1} ${r.label.padEnd(28)} ${r.timedOut ? 'timed out' : r.error}`));
  }
  if (look.length) {
    lines.push(`${look.length} need a look`);
    look.slice(0, 8).forEach((r, i) => lines.push(` ${i + 1} ${r.label.padEnd(28)} ${r.look}`));
    if (look.length > 8) lines.push(` ${look.length - 8} more are in the capture`);
  }
  lines.push(`Capture: ${file}`);
  lines.push('That file is the full output, for improving AskAI.');
  return lines.join('\n');
}

function run(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const file = opts.out || defaultOut(cwd);
  const askai = opts.askai || path.join(__dirname, '..', 'askai.js');
  const runner = opts.runner || ((args, timeout) => spawnAskai(askai, args, timeout, cwd));
  const results = [];
  for (const step of PLAN) {
    const started = Date.now();
    let raw;
    try { raw = normalize(runner(step.args, step.timeout)); }
    catch (e) { raw = { code: null, timedOut: false, error: e.message, stdout: '', stderr: '' }; }
    const row = { ...raw, args: step.args, label: step.args.join(' '), ms: Date.now() - started };
    row.look = lookReason(row);
    results.push(row);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const platform = require('./platform');
  let git = 'absent';
  try {
    const r = cp.spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    git = r && r.stdout ? String(r.stdout).trim() : 'absent';
  } catch (_) { /* git is optional for the header */ }
  const meta = header({
    version: opts.version || '', os: `${os.platform()} ${os.release()}`, node: process.version,
    git, container: platform.inContainer(), stdinTTY: !!process.stdin.isTTY, stdoutTTY: !!process.stdout.isTTY,
  });
  fs.writeFileSync(file, renderCapture(results, { version: opts.version || '', when: new Date().toISOString(), cwd, ...meta }));
  return { file, results, header: meta, summary: summarize(results, file), failedToRun: results.some(r => r.timedOut || r.error) };
}

module.exports = { PLAN, SKIPPED, run, defaultOut, lookReason, sandboxEnv, header };
