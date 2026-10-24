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

// Local ignore lives in .git/info/exclude. A tracked .gitignore is never written.
function excludePath(repo) {
  try {
    const r = cp.spawnSync('git', ['-C', repo, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.status !== 0 || !r.stdout) return null;
    return path.join(r.stdout.trim(), 'info', 'exclude');
  } catch (_) { return null; }
}
function ensure(repo, dry) {
  const did = [];
  const dir = path.join(repo, DIR);
  const ex = excludePath(repo);
  if (ex) {
    const old = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
    const want = IGNORE.filter(l => !old.split(/\r?\n/).includes(l));
    if (want.length) {
      did.push(`add ${want.join(', ')} to ${ex}`);
      if (!dry) {
        fs.mkdirSync(path.dirname(ex), { recursive: true });
        fs.appendFileSync(ex, `${old && !old.endsWith('\n') ? '\n' : ''}\n# Local AI session state and generated graphs (askai; never commit)\n${want.join('\n')}\n`);
      }
    }
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

function countUntracked(repo) {
  const entriesText = git(repo, ['status', '--short', '--untracked-files=normal']);
  const filesText = git(repo, ['status', '--short', '--untracked-files=all']);
  const rows = text => (String(text).startsWith('(') ? [] : String(text).split(/\r?\n/).filter(l => /^\?\?/.test(l)));
  const entries = rows(entriesText).length;
  const files = rows(filesText).length;
  return { entries, files, label: `${entries} entries (${files} files)` };
}
function state(repo) {
  const changes = git(repo, ['status', '--short']);
  const lines = changes.startsWith('(') ? [] : changes.split('\n').filter(Boolean);
  const counted = countUntracked(repo);
  const untracked = counted.entries;
  return { branch: git(repo, ['branch', '--show-current']), commit: git(repo, ['log', '-1', '--oneline']), changes, tracked: lines.length - untracked, untracked, untrackedFiles: counted.files, untrackedLabel: counted.label };
}
function handoffState(repo) {
  const ho = path.join(repo, DIR, HANDOFF);
  if (!fs.existsSync(ho)) return { state: 'missing', ageMin: null, hasFacts: false, hasNext: false };
  const text = fs.readFileSync(ho, 'utf8');
  const ageMin = (Date.now() - fs.statSync(ho).mtimeMs) / 60000;
  const branch = (text.match(/^Branch: .+$/m) || [''])[0];
  const hasFacts = /^Branch: \S/m.test(text) && !/\(none yet\)/.test(branch) && !/No session recorded/.test(text);
  const hasNext = /^Next: \S/m.test(text);
  const hasTodo = /TODO\(you\)/.test(text);
  const template = /No session recorded/.test(text) || (/\(none yet\)/.test(text) && !hasFacts);
  const base = { ageMin, hasFacts, hasNext };
  if (!hasFacts && !hasNext) return { state: 'template', ...base, hasFacts: false };
  if (hasNext && hasFacts && !hasTodo) return { state: 'complete', ...base };
  if (hasFacts || hasNext || hasTodo) return { state: 'draft', ...base };
  if (ageMin < 30 && !template) return { state: 'complete', ...base, hasFacts: true };
  return { state: 'template', ...base, hasFacts: false, hasNext: false };
}
function compactLedger(repo) {
  const jf = path.join(repo, DIR, LEDGER_JSONL);
  if (!fs.existsSync(jf)) return { wrote: 0, file: jf };
  const out = [];
  for (const line of fs.readFileSync(jf, 'utf8').split(/\n/).filter(Boolean)) {
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    let note = typeof e.note === 'string' ? e.note : '';
    if (/^(?:\?\?|[ MADRCU?]{1,2}) /m.test(note) || /\?$/.test(note)) note = note.split(/\r?\n/).filter(l => !/^(?:\?\?|[ MADRCU?]{1,2}) /.test(l) && !/\?$/.test(l)).join(' ');
    out.push(JSON.stringify({
      ts: e.ts || e.timestamp || '',
      event: e.event || e.title || 'note',
      branch: e.branch || '-',
      commit: e.commit || '-',
      tracked: e.tracked == null ? 0 : e.tracked,
      untracked: e.untracked == null ? 0 : e.untracked,
      note,
    }));
  }
  fs.writeFileSync(jf, out.length ? `${out.join('\n')}\n` : '');
  return { wrote: out.length, file: jf };
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
  const platform = require('./platform');
  const want = /^(claude|codex|agy|cursor-agent|agent)$/i;
  const found = platform.findProcesses();
  try {
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
  return require('./platform').copyToClipboard(text, {
    isTTY: !!process.stdout.isTTY,
    write: chunk => process.stdout.write(chunk),
  });
}

function quota(repo, o, print) {
  const file = path.join(repo,DIR,'quota-observations.jsonl');
  const requestedTool = o.tool === 'antigravity' ? 'agy' : o.tool;
  if (requestedTool && !['cursor','agy','claude','codex'].includes(requestedTool)) throw new Error('unknown quota environment');
  if (o._ && o._[2] === 'report') {
    const groups = new Map();
    if (fs.existsSync(file)) {
      if (fs.statSync(file).size > 4*1024*1024) throw new Error('quota log exceeds 4 MiB; archive it before reporting');
      for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
        let row; try { row=JSON.parse(line); } catch (_) { continue; }
        if (!row || typeof row !== 'object') continue;
        if (!Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100) continue;
        if (requestedTool && row.tool !== requestedTool) continue;
        const key = JSON.stringify([row.tool,row.windowId,row.variant,row.task,row.model,row.effort,row.experiment,row.limit]);
        if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(row);
      }
    }
    const summaries = [...groups.values()].map(rows=>{
      const first=rows[0], last=rows.at(-1);
      const reset=rows.some((r,i)=>i && r.percent < rows[i-1].percent);
      return {...first,samples:rows.length,delta:rows.length < 2 || reset ? null : last.percent-first.percent,reset};
    });
    if (o.json) print(JSON.stringify(summaries,null,2));
    else {
      print(require('./columns').table(['Tool','Window','Variant','Task','Observed quota change'],summaries.map(r=>[r.tool,r.windowId,r.variant || 'observation',r.task || '-',r.reset ? 'reset; use a new window ID' : r.delta === null ? 'need another reading' : `${r.delta.toFixed(2)} percentage points`])).join('\n'));
      if (!summaries.length) print('No quota observations recorded.');
      print('Manual dashboard observations only. Account-wide activity can affect deltas. No automatic Cursor/Antigravity quota API or proven net savings is claimed.');
      const paired = new Map();
      for (const row of summaries) if (row.delta !== null && row.experiment && row.task && row.model && row.effort && row.variant) {
        const key=JSON.stringify([row.tool,row.experiment,row.task,row.model,row.effort]);
        if (!paired.has(key)) paired.set(key,[]); paired.get(key).push(row);
      }
      for (const rows of paired.values()) {
        const baseline=rows.filter(r=>r.variant==='baseline'), askai=rows.filter(r=>r.variant==='askai');
        if (baseline.length===1 && askai.length===1) print(`Observed comparison ${baseline[0].experiment}: baseline ${baseline[0].delta.toFixed(2)} pp; AskAI ${askai[0].delta.toFixed(2)} pp; difference ${(baseline[0].delta-askai[0].delta).toFixed(2)} pp. Check matched workload, account, acceptance and absence of other activity before drawing a conclusion.`);
      }
    }
    return 0;
  }
  const tool = o.tool === 'antigravity' ? 'agy' : o.tool;
  const used=Number(o.used), limit=o.window === undefined ? 100 : Number(o.window);
  if (!['cursor','agy','claude','codex'].includes(tool) || o.used === undefined || !String(o.used).trim() || !String(o.windowId || '').trim() || !String(o.usageSource || '').trim() || !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || used < 0 || used > limit) {
    print('No observation saved. Use: askai session quota --tool cursor --used 23 --window 100 --window-id WINDOW --usage-source dashboard'); return 1;
  }
  if (o.variant && !['baseline','askai'].includes(o.variant)) throw new Error('--variant must be baseline or askai');
  const row={timestamp:now(),tool,windowId:o.windowId,used,limit,percent:100*used/limit,source:o.usageSource,variant:o.variant || '',task:o.task || '',model:o.model || '',effort:o.effort || '',experiment:o.name || ''};
  if (Object.values(row).some(v=>typeof v === 'string' && v.length > 500)) throw new Error('quota metadata must be at most 500 characters per field');
  if (!o.dry) { ensure(repo,false); fs.appendFileSync(file,JSON.stringify(row)+'\n'); }
  print(`${o.dry ? 'Would record' : 'Recorded'} ${tool} quota observation: ${row.percent.toFixed(2)}% used. This is a manual reading, not an API measurement.`); return 0;
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
    case 'quota': return quota(repo,o,print);
    case 'init': { const did = ensure(repo, dry); print(did.length ? did.map(d => `${dry ? '[dry-run] ' : ''}${d}`).join('\n') : `${path.join(repo, DIR)} already set up`); return 0; }
    case 'start': case 'pause': case 'finish': {
      const title = { start: 'START', pause: 'PAUSE / HANDOFF', finish: 'FINISH' }[action];
      const text = entry(repo, title, o, dry);
      print(dry ? `[dry-run] would append:${text}` : `ledger: ${path.join(repo, DIR, LEDGER)}`);
      if (action === 'pause') print('\nBefore you stop: ask the agent to write .ai-work/HANDOFF.md.');
      return 0;
    }
    case 'break': {
      if (dry) { print('would snapshot, write a handoff draft, and check processes'); return 0; }
      ensure(repo, false);
      let snap = 'snapshot skipped';
      try { snap = require('./daily').snapshotOnce(repo); } catch (_) { /* best effort */ }
      try { require('./daily').writeHandoff(repo, {}); } catch (_) { /* best effort */ }
      const hs = handoffState(repo);
      const agents = runningAgents();
      const s = state(repo);
      entry(repo, 'PAUSE / BREAK', o, false);
      fs.writeFileSync(path.join(repo, DIR, 'LAST_BREAK'), `${new Date().toISOString()}\n`);
      const lines = [
        'break',
        snap,
        `handoff ${hs.state}`,
        agents.length ? `running ${agents.map(a => `${a.name} ${a.pid}`).join(', ')}` : 'no agent CLIs running',
        (s.tracked || s.untracked) ? `tree ${s.tracked} tracked, ${s.untracked} untracked` : 'tree clean',
        'next: askai handoff "next step"',
        'back: askai resume',
      ];
      print(lines.slice(0, 8).join('\n'));
      return 0;
    }
    case 'resume': {
      const s = state(repo);
      const since = lastBreak(repo);
      if (since && !isNaN(since)) {
        const min = Math.round((Date.now() - since.getTime()) / 60000);
        const host = o.host || o.tool;
        let snap = o.snapshot;
        if (!snap && host === 'claude' && o.claudeHome) snap = { cache: require('./cache-policy').latestCache(o.claudeHome) };
        print(`${require('./cache-policy').advice(min, host, snap)}\n`);
      }
      print(`branch: ${s.branch} | commit: ${s.commit} | tracked ${s.tracked} | untracked ${s.untrackedLabel || s.untracked}`);
      const hs = handoffState(repo);
      if (hs.state === 'template' || hs.state === 'missing') print('Handoff: empty template');
      else if (hs.state === 'draft' && !hs.hasNext) print('Handoff: draft. askai handoff "next step"');
      else print(`Handoff: ${hs.state}`);
      print(`\n--- last ledger lines ---\n${tailEvents(repo, 3)}`);
      print(`\n=== paste into Claude Code, Codex, Antigravity or Cursor ===\n${RESUME_PROMPT}`);
      if (o.copy) {
        const file = path.join(repo, DIR, 'RESUME_PROMPT.md');
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, RESUME_PROMPT); print(`Fallback text saved: ${file}`); }
        catch (_) { print('(could not save fallback file; copy the prompt printed above)'); }
        const via = copy(RESUME_PROMPT);
        if (via === 'osc52') print('(OSC 52 clipboard request sent; paste is not verified. tmux and the outer terminal must permit clipboard writes.)');
        else if (via) print(`(copied with ${via}; verify by pasting in the destination)`);
        else print('(no clipboard tool found; use the saved file or copy the prompt above)');
      }
      return 0;
    }
    case 'status': {
      const s = state(repo);
      print(`repo:    ${repo}\nbranch:  ${s.branch}\ncommit:  ${s.commit}\ntracked ${s.tracked}  untracked ${s.untrackedLabel || s.untracked}\n\n--- last ledger lines ---\n${tailEvents(repo, 3)}`);
      return 0;
    }
    case 'measure': {
      if (!String(o.tool || '').trim() || !String(o.task || '').trim() || o.success === undefined) {
        print('No measurement saved. Use: askai session measure --tool cursor --task "completed task" --success 1 [--minutes N --input-tokens N --output-tokens N]');
        return 1;
      }
      const row = measureRow(o);
      if (FIELDS.some(f => typeof row[f] === 'number' && (!Number.isFinite(row[f]) || row[f] < 0)) || ![0, 1].includes(row.success)) {
        print('No measurement saved: numeric values must be finite and nonnegative; --success must be 0 or 1.'); return 1;
      }
      if (dry) { print(`[dry-run] ${JSON.stringify(row)}`); return 0; }
      ensure(repo, false);
      fs.appendFileSync(path.join(repo, DIR, METRICS), `${FIELDS.map(f => csvCell(row[f])).join(',')}\n`);
      print(`measurement added to ${path.join(repo, DIR, METRICS)}`);
      return 0;
    }
    case 'report': { print(report(o._ && o._.length > 2 ? o._.slice(2).map(d => path.resolve(d)) : [repo]).join('\n')); return 0; }
    case 'compact': {
      if (dry) { print('[dry-run] would rewrite session.jsonl into structured events'); return 0; }
      const r = compactLedger(repo);
      print(`rewrote ${r.wrote} events in ${r.file}`);
      return 0;
    }
    default:
      print('usage: askai session <init|pause|status|finish|measure|report|quota|compact> [--repo DIR] [--tool T] [--task "..."] [--summary "..."] [--next "..."]');
      return action ? 1 : 0;
  }
}

module.exports = { run, ensure, report, parseCsv, measureRow, runningAgents, lastBreak, handoffState, tailEvents, countUntracked, compactLedger, copyText: copy, FIELDS, DIR, RESUME_PROMPT };
