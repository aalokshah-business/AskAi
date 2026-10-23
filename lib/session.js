'use strict';
// askai session: a local, hook-free ledger that lets any agent pick a task up again. Nothing here runs inside the model loop and
// nothing is sent anywhere: it writes three files under <repo>/.ai-work/ (gitignored) when you run it.
//
//   HANDOFF.md          current state, written by the agent when asked for a handoff
//   SESSION_LEDGER.md   append-only history: start / pause / finish with branch, last commit and working tree
//   measurements.csv    one row per task, for comparing tools and settings by accepted tasks per subscription
//
// Merged from the ChatGPT efficiency kit's ai_session.py (same files and CSV columns), ported to Node so it ships inside askai.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DIR = '.ai-work';
const LEDGER = 'SESSION_LEDGER.md';
const LEDGER_JSONL = 'session.jsonl';
const HANDOFF = 'HANDOFF.md';
const METRICS = 'measurements.csv';
const FIELDS = ['timestamp', 'tool', 'model', 'effort', 'task', 'difficulty', 'elapsed_minutes', 'input_tokens', 'output_tokens',
  'cached_tokens', 'success', 'rework_minutes', 'usage_source', 'notes'];
const IGNORE = ['/.ai-work/', '/graphify-out/', '.claude/settings.local.json'];
const TEMPLATES = path.join(__dirname, '..', 'templates');
const RESUME_PROMPT = 'Read AGENTS.md, then .ai-work/HANDOFF.md, then only the files it lists. Run `git status --short` and '
  + '`git log -1 --oneline` and check the handoff against reality; do not trust earlier claims blindly. Summarise the current state '
  + 'in <= 6 lines, confirm the next step in one sentence, and wait for my go-ahead. Preserve uncommitted changes.';

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function git(repo, args) {
  try {
    const r = cp.spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : '(none)';
  } catch (_) { return '(git unavailable)'; }
}
function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(c => c !== ''));
  return head ? body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || '']))) : [];
}

// Create .ai-work/ with its three files and gitignore it. Returns the list of things it did (or would do in dry-run).
function ensure(repo, dry) {
  const did = [];
  const dir = path.join(repo, DIR);
  const gi = path.join(repo, '.gitignore');
  const old = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const want = IGNORE.filter(l => !old.split(/\r?\n/).includes(l));
  if (want.length) {
    did.push(`add ${want.join(', ')} to ${gi}`);
    if (!dry) fs.appendFileSync(gi, `${old && !old.endsWith('\n') ? '\n' : ''}\n# Local AI session state and generated graphs (askai; never commit)\n${want.join('\n')}\n`);
  }
  const files = [
    [LEDGER, () => '# AI Session Ledger (local; append-only; never store secrets)\n'],
    [HANDOFF, () => { try { return fs.readFileSync(path.join(TEMPLATES, 'HANDOFF.md'), 'utf8'); } catch (_) { return '# HANDOFF\n'; } }],
    [METRICS, () => `${FIELDS.join(',')}\n`],
  ];
  for (const [name, body] of files) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) continue;
    did.push(`create ${f}`);
    if (!dry) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, body()); }
  }
  return did;
}

function state(repo) {
  const changes = git(repo, ['status', '--short']);
  const lines = changes.startsWith('(') ? [] : changes.split('\n').filter(Boolean);
  const untracked = lines.filter(l => l.startsWith('??')).length;
  return { branch: git(repo, ['branch', '--show-current']), commit: git(repo, ['log', '-1', '--oneline']), changes, tracked: lines.length - untracked, untracked };
}
function handoffState(repo) {
  const ho = path.join(repo, DIR, HANDOFF);
  if (!fs.existsSync(ho)) return { state: 'missing', ageMin: null };
  const text = fs.readFileSync(ho, 'utf8');
  const ageMin = (Date.now() - fs.statSync(ho).mtimeMs) / 60000;
  const bullets = text.split(/\n/).map(l => l.trim()).filter(l => /^[-*] |\d+\. /.test(l));
  const emptyBullet = l => /\(none yet\)/.test(l) || (/<[^>\n]+>/.test(l) && !/[a-z]{4,}/i.test(l.replace(/<[^>]+>/g, '')));
  const template = /No session recorded/.test(text) || (bullets.length > 0 && bullets.every(emptyBullet));
  if (template) return { state: 'template', ageMin };
  if (ageMin < 30) return { state: 'fresh', ageMin };
  return { state: 'stale', ageMin };
}
function tailEvents(repo, n) {
  const jf = path.join(repo, DIR, LEDGER_JSONL);
  if (fs.existsSync(jf)) {
    const rows = fs.readFileSync(jf, 'utf8').split(/\n/).filter(Boolean).slice(-n);
    const lines = rows.map(line => {
      try {
        const e = JSON.parse(line);
        return `${e.ts} ${e.event}  branch ${e.branch || '-'}  commit ${e.commit || '-'}  tracked ${e.tracked}  untracked ${e.untracked}${e.note ? `  ${e.note}` : ''}`;
      } catch (_) { return null; }
    }).filter(Boolean);
    if (lines.length) return lines.join('\n');
  }
  const md = path.join(repo, DIR, LEDGER);
  if (!fs.existsSync(md)) return '(none)';
  return fs.readFileSync(md, 'utf8').split(/\n(?=## )/).slice(-n).join('\n').trim() || '(none)';
}

function entry(repo, title, o, dry) {
  const s = state(repo);
  const note = [o.task, o.summary, o.next, o.result].filter(v => v && String(v).trim()).map(v => String(v).trim()).join(' | ');
  const ev = { ts: now(), event: title, branch: s.branch, commit: s.commit, tracked: s.tracked, untracked: s.untracked, note };
  const fields = [['tool', o.tool], ['model', o.model], ['effort', o.effort], ['task', o.task], ['branch', s.branch], ['commit', s.commit],
    ['tracked', String(s.tracked)], ['untracked', String(s.untracked)], ['summary', o.summary], ['next step', o.next], ['result', o.result]];
  const text = `\n## ${ev.ts} - ${title}\n${fields.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `- **${k}:** ${String(v).trim()}`).join('\n')}\n`;
  if (!dry) {
    ensure(repo, false);
    fs.appendFileSync(path.join(repo, DIR, LEDGER), text);
    fs.appendFileSync(path.join(repo, DIR, LEDGER_JSONL), JSON.stringify(ev) + '\n');
  }
  return text;
}

function measureRow(o) {
  const num = (v, d = 0) => (v === undefined || v === '' ? d : Number(v));
  return { timestamp: now(), tool: o.tool || '', model: o.model || '', effort: o.effort || '', task: o.task || '', difficulty: o.difficulty || '',
    elapsed_minutes: num(o.minutes), input_tokens: num(o.inputTokens), output_tokens: num(o.outputTokens), cached_tokens: num(o.cachedTokens),
    success: num(o.success), rework_minutes: num(o.reworkMinutes), usage_source: o.usageSource || '', notes: o.notes || '' };
}

// Agent CLIs still running (a running session can keep spending through loops, goals and background agents).
function runningAgents() {
  const want = /^(claude|codex|agy|cursor-agent|agent)$/i;
  const found = [];
  try {
    if (process.platform === 'win32') {
      const r = cp.spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      for (const line of String(r.stdout || '').split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (!m) continue;
        const name = m[1].replace(/\.exe$/i, '');
        if (want.test(name)) found.push({ name, pid: m[2] });
      }
    } else {
      const r = cp.spawnSync('ps', ['-A', '-o', 'pid=,comm='], { encoding: 'utf8', timeout: 5000 });
      for (const line of String(r.stdout || '').split(/\n/)) {
        const m = /^\s*(\d+)\s+(\S+)/.exec(line);
        if (!m) continue;
        const name = path.basename(m[2]);
        if (want.test(name)) found.push({ name, pid: m[1] });
      }
    }
    const tmux = cp.spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{pane_current_command}'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (tmux.status === 0) {
      for (const line of String(tmux.stdout || '').split(/\n/)) {
        const m = /^(\d+)\s+(\S+)/.exec(line.trim());
        if (m && want.test(m[2]) && !found.some(f => f.pid === m[1])) found.push({ name: m[2], pid: m[1] });
      }
    }
  } catch (_) { /* detection is best effort */ }
  return found;
}
// When the last break started: .ai-work/LAST_BREAK, else the handoff file's time.
function lastBreak(repo) {
  const lb = path.join(repo, DIR, 'LAST_BREAK');
  try { return new Date(fs.readFileSync(lb, 'utf8').trim()); } catch (_) { /* none */ }
  try { return new Date(fs.statSync(path.join(repo, DIR, HANDOFF)).mtimeMs); } catch (_) { return null; }
}
function copy(text) {
  const tries = process.platform === 'win32' ? [['clip', []]] : process.platform === 'darwin' ? [['pbcopy', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, a] of tries) { try { const r = cp.spawnSync(cmd, a, { input: text, timeout: 3000 }); if (r.status === 0) return cmd; } catch (_) { /* next */ } }
  if (process.stdout.isTTY) {
    try { process.stdout.write(`\x1b]52;c;${Buffer.from(String(text)).toString('base64')}\x07`); return 'osc52'; } catch (_) { /* no tty write */ }
  }
  return null;
}

function report(dirs) {
  const rows = [];
  for (const d of dirs) {
    const f = fs.existsSync(path.join(d, DIR, METRICS)) ? path.join(d, DIR, METRICS) : d;
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    rows.push(...parseCsv(fs.readFileSync(f, 'utf8')));
  }
  if (!rows.length) return ['No measurements yet. Record one with: askai session measure --tool claude --task "..." --success 1 ...'];
  const n = (r, k) => Number(r[k]) || 0;
  const groups = new Map();
  for (const r of rows) { const k = `${r.tool || 'unknown'}|${r.difficulty || '-'}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = ['tool          difficulty  runs  accepted  pass%  med.min  rework  in.tokens  out.tokens  tokens/accepted', '-'.repeat(104)];
  for (const [k, rs] of [...groups].sort()) {
    const [tool, diff] = k.split('|');
    const ok = rs.reduce((a, r) => a + n(r, 'success'), 0);
    const tin = rs.reduce((a, r) => a + n(r, 'input_tokens'), 0), tout = rs.reduce((a, r) => a + n(r, 'output_tokens'), 0);
    out.push(`${tool.slice(0, 13).padEnd(14)}${diff.padEnd(12)}${String(rs.length).padStart(4)}${String(ok).padStart(10)}${(Math.round(100 * ok / rs.length) + '%').padStart(7)}`
      + `${median(rs.map(r => n(r, 'elapsed_minutes'))).toFixed(1).padStart(9)}${String(rs.reduce((a, r) => a + n(r, 'rework_minutes'), 0)).padStart(8)}`
      + `${tin.toLocaleString('en-US').padStart(11)}${tout.toLocaleString('en-US').padStart(12)}${(ok ? Math.round((tin + tout) / ok).toLocaleString('en-US') : 'n/a').padStart(17)}`);
  }
  out.push('', 'Primary score: accepted tasks per subscription-month, compared within one difficulty. These are your own numbers, not billing.');
  return out;
}

// Entry point for `askai session <action>`. Returns an exit code.
function run(action, o, print = console.log) {
  const repo = path.resolve(o.repo || process.cwd());
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) { print(`askai session: ${repo} is not a directory`); return 1; }
  const dry = !!o.dry;
  switch (action) {
    case 'init': { const did = ensure(repo, dry); print(did.length ? did.map(d => `${dry ? '[dry-run] ' : ''}${d}`).join('\n') : `${path.join(repo, DIR)} already set up`); return 0; }
    case 'start': case 'pause': case 'finish': {
      const title = { start: 'START', pause: 'PAUSE / HANDOFF', finish: 'FINISH' }[action];
      const text = entry(repo, title, o, dry);
      print(dry ? `[dry-run] would append:${text}` : `ledger: ${path.join(repo, DIR, LEDGER)}`);
      if (action === 'pause') print('\nBefore you stop: ask the agent to write .ai-work/HANDOFF.md.');
      return 0;
    }
    case 'break': {
      if (!dry) ensure(repo, false);
      const s = state(repo);
      const dirty = (s.changes || '').split(/\r?\n/).filter(Boolean).length;
      const hs = handoffState(repo);
      print('Before you step away');
      print(`  ${dirty ? `[ ] ${dirty} uncommitted file(s) (${s.tracked} tracked, ${s.untracked} untracked): run the focused test, then commit or stash` : '[x] working tree clean'}`);
      print(`  ${hs.state === 'fresh' ? '[x] handoff is fresh' : '[ ] HANDOFF.md is the empty template: write .ai-work/HANDOFF.md'}`);
      print('  [ ] stop background work: /loop tasks, /goal, agent teams, background agents, Cursor cloud agents');
      const agents = runningAgents();
      print(agents.length ? `  ✖ still running: ${agents.map(a => `${a.name} ${a.pid}`).join(', ')}` : '  ✔ no agent CLIs running');
      const text = entry(repo, 'PAUSE / BREAK', o, dry);
      if (!dry) fs.writeFileSync(path.join(repo, DIR, 'LAST_BREAK'), `${new Date().toISOString()}\n`);
      print(dry ? `\n[dry-run] would record:${text}` : `\nRecorded in ${path.join(repo, DIR, LEDGER)}. When you are back: askai resume`);
      if (!dry) { try { require('./daily').snapshot(repo, {}); require('./daily').writeHandoff(repo, {}); } catch (_) { /* snapshot is best effort */ } }
      return 0;
    }
    case 'resume': {
      const s = state(repo);
      const since = lastBreak(repo);
      if (since && !isNaN(since)) {
        const min = Math.round((Date.now() - since.getTime()) / 60000);
        const advice = min < 5 ? 'continue in the same chat' : min < 60 ? 'continue if you are on your subscription (1 h cache); start fresh if you are on usage credits (5 min cache)' : 'start a fresh chat with the prompt below: the cache has expired, so the old chat would be re-read at full price';
        print(`Away ${min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`}: ${advice}.\n`);
      }
      print(`branch: ${s.branch} | commit: ${s.commit} | tracked ${s.tracked} | untracked ${s.untracked}`);
      const hs = handoffState(repo);
      if (hs.state === 'template' || hs.state === 'missing') print('Handoff: empty template');
      else {
        const ho = path.join(repo, DIR, HANDOFF);
        print(`\n--- .ai-work/HANDOFF.md ---\n${fs.existsSync(ho) ? fs.readFileSync(ho, 'utf8').split(/\n/).slice(0, 12).join('\n') : '(none)'}`);
      }
      print(`\n--- last ledger lines ---\n${tailEvents(repo, 12)}`);
      print(`\n=== paste into Claude Code, Codex, Antigravity or Cursor ===\n${RESUME_PROMPT}`);
      if (o.copy) {
        const via = copy(RESUME_PROMPT);
        if (via) print(`(copied with ${via})`);
        else {
          const file = path.join(repo, DIR, 'RESUME_PROMPT.md');
          try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, RESUME_PROMPT); print(`(no clipboard tool found; wrote ${file})`); }
          catch (_) { print('(no clipboard tool found; copy it from above)'); }
        }
      }
      return 0;
    }
    case 'status': {
      const s = state(repo);
      print(`repo:    ${repo}\nbranch:  ${s.branch}\ncommit:  ${s.commit}\ntracked ${s.tracked}  untracked ${s.untracked}\n\n--- last ledger lines ---\n${tailEvents(repo, 12)}`);
      return 0;
    }
    case 'measure': {
      const row = measureRow(o);
      if (dry) { print(`[dry-run] ${JSON.stringify(row)}`); return 0; }
      ensure(repo, false);
      fs.appendFileSync(path.join(repo, DIR, METRICS), `${FIELDS.map(f => csvCell(row[f])).join(',')}\n`);
      print(`measurement added to ${path.join(repo, DIR, METRICS)}`);
      return 0;
    }
    case 'report': { print(report(o._ && o._.length > 2 ? o._.slice(2).map(d => path.resolve(d)) : [repo]).join('\n')); return 0; }
    default:
      print('usage: askai session <init|pause|status|finish|measure|report> [--repo DIR] [--tool T] [--task "..."] [--summary "..."] [--next "..."]');
      return action ? 1 : 0;
  }
}

module.exports = { run, ensure, report, parseCsv, measureRow, runningAgents, lastBreak, handoffState, tailEvents, copyText: copy, FIELDS, DIR, RESUME_PROMPT };
