'use strict';
// The v1.3 daily commands: next, handoff, weigh, run, errors, snapshot, hide-local, stop.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const session = require('./session');

function git(dir, args) {
  const r = cp.spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

function next(ctx, dir) {
  const findings = require('./findings').collectFindings(ctx, dir);
  const clean = f => String(f.message || '').replace(new RegExp('^' + String(f.id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[: ]*'), '');
  const now = findings.filter(f => f.severity === 'now').slice(0, 3);
  const later = findings.filter(f => f.severity === 'later').slice(0, 2);
  const name = path.basename(path.resolve(dir || '.'));
  const lines = [name, '', 'Do now'];
  const platform = require('./platform');
  if (!now.length) lines.push(`  ${platform.mark('ok')} nothing to fix now`);
  now.forEach((f, i) => lines.push(`  ${i + 1} ${platform.mark('bad')} ${f.id}  ${clean(f)}  ${f.fix || ''}`.trim()));
  lines.push('', 'Later');
  if (ctx.which && ctx.which('claude') && require('./tips').isPeak()) lines.push('  ! time  Claude peak hours now: big jobs drain the window faster');
  if (!later.length && !(ctx.which && ctx.which('claude') && require('./tips').isPeak())) lines.push(`  ${platform.mark('ok')} nothing later`);
  later.forEach(f => lines.push(`  ! ${f.id}  ${clean(f)}  ${f.fix || ''}`.trim()));
  lines.push('', 'Details: askai check · Spend: askai savings');
  return lines.slice(0, 15).join('\n');
}

function ticket(branch) {
  const m = /([A-Z]+-\d+)/.exec(branch || '');
  return m ? m[1] : '';
}

function snapshotOnce(dir) {
  const stat = git(dir, ['status', '--porcelain']);
  const diff = git(dir, ['diff', '--stat', 'HEAD']);
  const tree = crypto.createHash('sha1').update(`${stat.out}\n${diff.out}`).digest('hex');
  const mark = path.join(dir, session.DIR, 'snapshots', 'tree.sha');
  let prev = '';
  try { prev = fs.readFileSync(mark, 'utf8').trim(); } catch (_) { /* first snapshot */ }
  if (prev === tree) return 'snapshot unchanged';
  const text = snapshot(dir, {});
  fs.mkdirSync(path.dirname(mark), { recursive: true });
  fs.writeFileSync(mark, `${tree}\n`);
  const first = String(text).split(/\r?\n/).find(Boolean) || 'snapshot written';
  return first;
}

function writeHandoff(dir, o = {}) {
  session.ensure(dir, false);
  const sentence = String(o.sentence || o.goal || (Array.isArray(o._) ? o._.filter(x => x && x !== 'handoff').join(' ') : '') || '').trim();
  const file = path.join(dir, session.DIR, 'HANDOFF.md');
  if (!sentence && fs.existsSync(file)) {
    const prev = fs.readFileSync(file, 'utf8');
    if (/^Next: \S/m.test(prev) && !/TODO\(you\)/.test(prev)) return { file, text: prev, extra: '', kept: true };
  }
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = git(dir, ['rev-parse', '--short', 'HEAD']);
  const stat = git(dir, ['diff', '--stat', 'HEAD']);
  const status = git(dir, ['status', '--short']);
  const log = git(dir, ['log', '-3', '--format=%s']);
  const branchName = branch.ok ? branch.out : '(no git)';
  const id = ticket(branchName);
  const rows = status.ok ? status.out.split(/\r?\n/).filter(Boolean) : [];
  const tracked = rows.filter(l => !l.startsWith('??')).length;
  const untracked = rows.filter(l => l.startsWith('??')).length;
  const goal = branchName.replace(/^feature\//, '').replace(/[-_]/g, ' ');
  const subjects = log.ok && log.out ? log.out : '(none)';
  const text = [
    '# HANDOFF',
    '',
    `Branch: ${branchName}`,
    `Commit: ${commit.ok ? commit.out : '(none)'}`,
    `Ticket: ${id || '(none)'}`,
    `Goal draft: ${goal}`,
    '',
    'Diff stat:',
    stat.ok && stat.out ? stat.out : '(clean)',
    '',
    `Tracked changes: ${tracked}`,
    `Untracked files: ${untracked}`,
    '',
    'Recent commits:',
    subjects,
    '',
    ...(sentence ? [`Next: ${sentence}`, ''] : ['TODO(you): acceptance criteria', 'TODO(you): decisions and why', 'TODO(you): next steps', '']),
  ].join('\n');
  fs.writeFileSync(file, text);
  const host = o.for || o['for'];
  const prompts = {
    claude: 'Read .ai-work/HANDOFF.md. Continue from the Goal draft. Do not re-scan the repo.',
    codex: 'Read AGENTS.md and .ai-work/HANDOFF.md. Continue the Goal draft.',
    cursor: 'Read .ai-work/HANDOFF.md only. Continue the Goal draft.',
    agy: 'Read GEMINI.md and .ai-work/HANDOFF.md. Continue the Goal draft.',
  };
  const extra = [];
  if (host) extra.push(prompts[host] || prompts.claude);
  if (o.fill) extra.push(['Fill only the TODO(you) lines in .ai-work/HANDOFF.md.', 'Use the facts already in that file.', 'Do not invent acceptance criteria.', 'Leave every other file unchanged.'].join('\n'));
  return { file, ticket: id, text, extra: extra.join('\n') };
}

function estimate(text) {
  return Math.ceil(Buffer.byteLength(String(text)) / 4);
}

function weigh(target, threshold = 8000) {
  const file = path.resolve(target);
  let text = '';
  try { text = fs.readFileSync(file); } catch (e) { return { ok: false, text: `askai: cannot read ${file}` }; }
  const tokens = estimate(text);
  const lines = [`${file}`, `estimate: ${tokens} tokens`];
  if (tokens > threshold) lines.push(`ctx.large-file: over ${threshold} tokens. Search with rg. Do not read this file whole.`);
  return { ok: true, tokens, text: lines.join('\n') };
}

function runCmd(dir, cmd, o = {}) {
  session.ensure(dir, false);
  const risky = /\b(copy_dut|flash|reboot)\b/i.test(cmd);
  if (risky && !o.yes) return { code: 1, text: `Refusing risky command without --yes: ${cmd}` };
  const logDir = path.join(dir, session.DIR);
  const log = path.join(logDir, 'last.log');
  for (let i = 4; i >= 1; i--) {
    const from = path.join(logDir, `last.log.${i}`);
    const to = path.join(logDir, `last.log.${i + 1}`);
    try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (_) { /* keep going */ }
  }
  try { if (fs.existsSync(log)) fs.renameSync(log, path.join(logDir, 'last.log.1')); } catch (_) { /* first run */ }
  try { fs.unlinkSync(path.join(logDir, 'last.log.6')); } catch (_) { /* rotate keeps five */ }
  const r = cp.spawnSync(cmd, { cwd: dir, encoding: 'utf8', shell: true, timeout: 120000, windowsHide: true });
  const body = `${r.stdout || ''}${r.stderr || ''}`;
  fs.writeFileSync(log, body);
  const all = body.split(/\r?\n/);
  const errors = all.filter(l => /error:|FAILED|undefined reference/i.test(l)).slice(0, 5);
  const tail = all.filter(Boolean).slice(-20);
  const code = r.status == null ? 1 : r.status;
  const kept = Math.max(0, all.length - tail.length);
  let text = [`exit ${code} · ${all.length} lines · ${errors.length} error line(s)`, errors.join('\n'), tail.join('\n'), log, `estimate: ${estimate(tail.join('\n'))} tokens shown, ${kept} lines kept out of chat`].filter(Boolean).join('\n');
  if (code === 0 && o.save) {
    const file = path.join(dir, session.DIR, 'named-runs.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first name */ }
    data[o.save] = { cmd, at: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    text += `\nsaved ${o.save}`;
  } else if (code === 0 && !risky) text += `\nOffer: askai run --save NAME -- ${cmd}`;
  return { code, text };
}

function errors(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return 'No run logged. Use: askai run -- <command>'; }
  const lines = text.split(/\r?\n/);
  const hit = [];
  const re = /error:|undefined reference|\bld: |FAILED|\[ +FAILED +\]|pytest FAILED|ninja: |CMake Error|tsc /i;
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const block = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
    if (!hit.includes(block)) hit.push(block);
  }
  return hit.length ? hit.slice(0, 20).join('\n---\n') : 'No error lines in that log.';
}

function snapshot(dir, o = {}) {
  session.ensure(dir, false);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(dir, session.DIR, 'snapshots');
  fs.mkdirSync(folder, { recursive: true });
  const diff = git(dir, ['diff', 'HEAD', '--binary']);
  const patch = path.join(folder, `${stamp}.patch`);
  fs.writeFileSync(patch, diff.ok ? diff.out : '');
  const untracked = git(dir, ['ls-files', '--others', '--exclude-standard']);
  const list = path.join(folder, `${stamp}.untracked.txt`);
  fs.writeFileSync(list, untracked.ok ? untracked.out : '');
  const lines = [`snapshot ${patch}`, `untracked ${list}`];
  if (o.includeUntracked && untracked.ok) {
    const skip = /^\.(agents|claude|codex|cursor|ai-work|serena)\// ;
    for (const rel of untracked.out.split(/\r?\n/).filter(Boolean)) {
      if (skip.test(rel.replace(/\\/g, '/'))) continue;
      const src = path.join(dir, rel);
      let size = 0;
      try { size = fs.statSync(src).size; } catch (_) { continue; }
      if (!fs.statSync(src).isFile() || size > 1024 * 1024) continue;
      const dest = path.join(folder, stamp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      lines.push(`kept ${rel}`);
    }
  }
  return lines.join('\n');
}

function hideLocal(dir, o = {}) {
  const top = git(dir, ['rev-parse', '--git-path', 'info/exclude']);
  if (!top.ok) return { code: 1, text: 'askai: not a git repository' };
  const exclude = path.resolve(dir, top.out);
  const names = ['.agents/', '.claude/', '.codex/', '.cursor/', '.ai-work/', '.serena/', 'graphify-out/', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorignore', 'docs/ai/'];
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  let cur = '';
  try { cur = fs.readFileSync(exclude, 'utf8'); } catch (_) { /* new */ }
  if (o.shared) {
    return { code: 0, text: ['shared: leave these tracked when the team should see them:', ...names, 'Keep local: .ai-work/ .serena/ graphify-out/'].join('\n') };
  }
  if (o.undo) {
    const next = cur.split(/\r?\n/).filter(l => !l.startsWith('# askai hide-local') && !names.includes(l)).join('\n');
    fs.writeFileSync(exclude, next.endsWith('\n') || !next ? next : `${next}\n`);
    return { code: 0, text: `restored ${exclude}` };
  }
  const add = names.filter(n => !cur.split(/\r?\n/).includes(n));
  if (!add.length) return { code: 0, text: `already hidden in ${exclude}` };
  fs.appendFileSync(exclude, `${cur.endsWith('\n') || !cur ? '' : '\n'}# askai hide-local\n${add.join('\n')}\n`);
  const offers = ignoreOffers(dir);
  return { code: 0, text: [`hid ${add.length} paths in ${exclude}`, offers].filter(Boolean).join('\n') };
}
function ignoreOffers(dir) {
  const lines = [];
  const stems = new Map();
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return ''; }
  for (const e of ents) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    const stem = path.basename(e.name, path.extname(e.name));
    if (!stems.has(stem)) stems.set(stem, new Set());
    stems.get(stem).add(ext);
    if (/\.log$/i.test(e.name) || /_logs/i.test(e.name)) lines.push(e.name);
  }
  const dupes = [];
  for (const [stem, exts] of stems) if (exts.has('.md') && (exts.has('.docx') || exts.has('.pdf') || exts.has('.pptx'))) dupes.push(stem);
  const out = [];
  if (dupes.length) out.push(`offer .cursorignore for originals: ${dupes.slice(0, 8).join(', ')}`);
  if (lines.length) out.push(`offer .cursorignore for logs: ${lines.slice(0, 8).join(', ')}`);
  return out.join('\n');
}

function killable(agents, self = process.pid, parent = process.ppid) {
  const banned = /^(tmux|sshd|sshd-session|cursor|cursor-server)$/i;
  return (agents || []).filter(a => Number(a.pid) !== Number(self) && Number(a.pid) !== Number(parent) && !banned.test(a.name));
}
function stop(o = {}) {
  const agents = killable(o.agents || session.runningAgents());
  if (!agents.length) return { code: 0, text: `${require('./platform').mark('ok')} none running` };
  const list = agents.map(a => `${a.name} ${a.pid}`).join('\n');
  if (!o.yes) return { code: 0, text: `${list}\nConfirm with askai stop --yes` };
  for (const a of agents) {
    try { process.kill(Number(a.pid), 'SIGTERM'); } catch (_) { /* already gone */ }
  }
  return { code: 0, text: `stopped\n${list}` };
}

function bootstrap(dir, profile, o = {}) {
  if (!o.repo) {
    return [
      'Personal Dev Containers dotfiles: keep the install script in your own repo, not this project.',
      'Cursor runs that script in every container. Verify it once inside a Cursor devcontainer.',
      'Docs: https://code.visualstudio.com/docs/devcontainers/containers#_personalizing-with-dotfile-repositories',
      'Write into this repo only with: askai bootstrap --repo',
    ].join('\n');
  }
  const name = profile || 'lean';
  const folder = path.join(dir, '.devcontainer');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'askai-postcreate.sh');
  const body = `#!/bin/sh\naskai install --yes --profile ${name}\naskai project refresh\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) return `already ${file}`;
  fs.writeFileSync(file, body);
  return `wrote ${file}\npostCreateCommand: bash .devcontainer/askai-postcreate.sh\nmounts (optional): { "source": "askai-home", "target": "/root/.askai", "type": "volume" }`;
}

const OFFICE = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']);
function namedRuns(dir) {
  const hits = [];
  const walk = (folder, depth) => {
    if (depth > 2 || hits.length >= 12) return;
    let ents = [];
    try { ents = fs.readdirSync(folder, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.ai-work') continue;
      const p = path.join(folder, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(sh|ps1|bat)$/i.test(e.name)) hits.push(path.relative(dir, p).replace(/\\/g, '/'));
    }
  };
  walk(dir, 0);
  return hits.map(rel => `- ${rel}${/\b(copy_dut|flash|reboot)\b/i.test(rel) ? ' (risky: true; askai run refuses without --yes)' : ''}`);
}
function scanOffice(dir, o = {}) {
  const found = [];
  const walk = (folder, depth) => {
    if (depth > 4 || found.length >= 40) return;
    let ents = [];
    try { ents = fs.readdirSync(folder, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.ai-work') continue;
      const p = path.join(folder, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (OFFICE.has(path.extname(e.name).toLowerCase())) found.push(p);
    }
  };
  walk(dir, 0);
  if (!found.length) return 'No PDF or Office files to convert.';
  const lines = found.map(f => {
    const rel = path.relative(dir, f);
    let n = 0;
    try { n = fs.statSync(f).size; } catch (_) { /* missing */ }
    if (!o.yes) return `${rel}  estimate: ${Math.ceil(n / 4)} tokens if converted`;
    let hash = '0';
    try { hash = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12); } catch (_) { /* unreadable */ }
    const out = path.join(dir, '.ai-work', 'converted', `${hash}.md`);
    if (fs.existsSync(out)) return `${rel} -> ${path.relative(dir, out)} (cached)`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = cp.spawnSync('markitdown', [f, '-o', out], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0 && fs.existsSync(out)) {
      const md = fs.readFileSync(out);
      return `${rel} -> ${path.relative(dir, out)}  estimate: ${Math.ceil(md.length / 4)} tokens`;
    }
    try { fs.unlinkSync(out); } catch (_) { /* no partial */ }
    return `${rel}  estimate: ${Math.ceil(n / 4)} tokens if converted (markitdown unavailable)`;
  });
  if (o.ignoreOriginals) {
    const ig = path.join(dir, '.cursorignore');
    let cur = '';
    try { cur = fs.readFileSync(ig, 'utf8'); } catch (_) { /* new */ }
    const rels = found.map(f => path.relative(dir, f).replace(/\\/g, '/'));
    const add = rels.filter(r => !cur.split(/\r?\n/).includes(r));
    if (add.length) fs.appendFileSync(ig, `${cur.endsWith('\n') || !cur ? '' : '\n'}# askai convert scan --ignore-originals\n${add.join('\n')}\n`);
    lines.push(`cursorignore: ${add.length} original(s)`);
  }
  return lines.join('\n');
}

module.exports = { next, writeHandoff, weigh, runCmd, errors, snapshot, snapshotOnce, hideLocal, stop, killable, estimate, bootstrap, scanOffice, namedRuns };
