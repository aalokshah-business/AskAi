'use strict';
// askai usage [days]: what the four tools spent, from the data each keeps on this machine.
//   Claude Code: ccusage when installed, else the transcript spend report askai already ships.
//   Codex: the session files under ~/.codex/sessions, read best effort (their format is not documented): cumulative
//   token totals are attributed to the date of each event's increase.
//   Antigravity and Cursor keep no local usage log askai can read: their own /usage, /credits and dashboard are named instead.
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.jsonl$/.test(e.name)) out.push(p);
  }
  return out;
}
function tokensIn(obj, best) {
  if (!obj || typeof obj !== 'object') return;
  const n = k => (typeof obj[k] === 'number' ? obj[k] : null);
  const inp = n('input_tokens'), out = n('output_tokens');
  if (inp != null && out != null) {
    const cached = n('cached_input_tokens') ?? n('cache_read_input_tokens') ?? 0;
    if (inp + out > best.input + best.output) { best.input = inp; best.output = out; best.cached = cached; }
  }
  for (const v of Object.values(obj)) if (v && typeof v === 'object') tokensIn(v, best);
}
const eventTime = (obj, mtime) => obj.timestamp == null ? mtime : (Date.parse(obj.timestamp) || -Infinity);
function codex(codexHome, days) {
  const since = Date.now() - days * 86400000;
  const files = walk(path.join(codexHome, 'sessions')).filter(f => { try { return fs.statSync(f).mtimeMs >= since; } catch (_) { return false; } });
  const byDay = new Map();
  let total = { sessions: 0, input: 0, output: 0, cached: 0 };
  for (const f of files) {
    const mtime = fs.statSync(f).mtimeMs;
    const best = { input: 0, output: 0, cached: 0 };
    let counted = false; const daysSeen = new Set();
    for (const line of (fs.readFileSync(f, 'utf8') || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch (_) { continue; }
      const next = { ...best }; tokensIn(j, next);
      const ts = eventTime(j, mtime);
      if (ts >= since && (next.input > best.input || next.output > best.output)) {
        const day = new Date(ts).toISOString().slice(0, 10);
        const d = byDay.get(day) || { sessions: 0, input: 0, output: 0, cached: 0 };
        for (const k of ['input', 'output', 'cached']) { const delta = Math.max(0, next[k] - best[k]); d[k] += delta; total[k] += delta; }
        if (!daysSeen.has(day)) { d.sessions++; daysSeen.add(day); }
        byDay.set(day, d); counted = true;
      }
      Object.assign(best, next);
    }
    if (counted) total.sessions++;
  }
  return { files: files.length, total, byDay: [...byDay].sort() };
}
const fmt = n => n.toLocaleString('en-US');
function ownNumbers(text) {
  const raw = String(text || '');
  const boxed = /[╭╮╯╰│┌┐└┘─]/.test(raw);
  const body = raw.replace(/[╭╮╯╰│┌┐└┘─]/g, ' ');
  const sessions = (body.match(/(\d+)\s+sessions?/i) || [])[1];
  const tokens = (body.match(/([\d,]{2,})\s+tokens?/i) || [])[1];
  if (!sessions && !tokens && !boxed) return { sessions: 'transcripts', tokens: '-', note: '' };
  if (!sessions && !tokens) return { sessions: '-', tokens: '-', note: '' };
  return { sessions: sessions || '-', tokens: tokens || '-', note: '' };
}
function isZeroReport(text) {
  return /0 transcript files, 0 responses/.test(String(text || ''));
}
function summarizeUsage(s) {
  const claudeEmpty = !s.claudeError && (!s.claudeText || isZeroReport(s.claudeText));
  const codexEmpty = !s.codex || !s.codex.files;
  if (claudeEmpty && codexEmpty) {
    const why = [];
    why.push(s.claudeInstalled ? 'no Claude Code transcripts' : 'Claude Code not installed');
    why.push(s.codexInstalled ? 'no Codex sessions' : 'Codex not installed');
    return `No Claude Code or Codex sessions in ${s.days} days (${why.join('; ')}).\nCursor: open Dashboard → Usage.`;
  }
  const codexSessions = s.codex && s.codex.total ? s.codex.total.sessions : 0;
  const codexTokens = s.codex && s.codex.total ? (s.codex.total.input || 0) + (s.codex.total.output || 0) : 0;
  const claudeNums = claudeEmpty ? null : ownNumbers(s.claudeText);
  const lines = [
    'tool          sessions  tokens',
    `Claude Code   ${claudeNums ? claudeNums.sessions : '-'}         ${claudeNums ? claudeNums.tokens : '-'}`,
    `Codex         ${codexSessions}         ${codexTokens}`,
    'Cursor        -         Dashboard',
    'Antigravity   -         /usage',
  ];
  if (s.claudeError) lines.push('', `Claude Code: ${String(s.claudeError).split(/\r?\n/).find(l => l.trim() && !/[╭╮╯╰│┌┐└┘─]/.test(l)) || 'report failed'}`);
  else if (claudeNums && claudeNums.note) lines.push('', claudeNums.note);
  if (!codexEmpty) lines.push('', `=== Codex, last ${s.days} day(s) ===`, renderCodex(s.codex));
  else if (!claudeEmpty || s.claudeError) lines.push('', 'No Codex session files in the period.');
  if (!claudeEmpty || !codexEmpty || s.claudeError) lines.push('', 'Cursor: open Dashboard → Usage. Antigravity: /usage.');
  return lines.join('\n').replace(/^\n/, '');
}
function fullText(parts) {
  return [parts.summary, parts.cache, parts.plugins].map(s => String(s || '').trimEnd()).filter(Boolean).join('\n\n');
}
function cacheText(rendered, days) {
  const n = Number(days) || 7;
  if (!rendered || !rendered.rows || !rendered.rows.length) return `No status-line snapshots in ${n} days.`;
  return rendered.lines.join('\n');
}
function spendWhenEmpty(text, opts = {}) {
  const raw = String(text || '').trimEnd();
  if (!isZeroReport(raw)) return raw;
  const hours = Number(opts.hours);
  const days = opts.days != null ? opts.days : (Number.isFinite(hours) && hours > 0 ? Math.max(1, Math.round(hours / 24)) : 1);
  return summarizeUsage({
    days,
    claudeText: raw,
    claudeError: '',
    codex: { files: 0 },
    claudeInstalled: !!opts.claudeInstalled,
    codexInstalled: !!opts.codexInstalled,
  });
}
function renderCodex(r) {
  if (!r.files) return 'No Codex session files in the period (~/.codex/sessions).';
  const out = ['day         sessions     input tokens    output tokens   cached input'];
  for (const [d, v] of r.byDay) out.push(`${d}  ${String(v.sessions).padStart(8)}  ${fmt(v.input).padStart(15)}  ${fmt(v.output).padStart(15)}  ${fmt(v.cached).padStart(13)}`);
  out.push(`total       ${String(r.total.sessions).padStart(8)}  ${fmt(r.total.input).padStart(15)}  ${fmt(r.total.output).padStart(15)}  ${fmt(r.total.cached).padStart(13)}`);
  out.push('Read best effort from Codex\'s session files (format not documented). Your plan view: /usage daily in Codex.');
  return out.join('\n');
}
// Which models Codex sessions really ran (turn_context records), for checking that workers did not inherit an expensive parent.
function codexModels(codexHome, days) {
  const since = Date.now() - days * 86400000; const out = {};
  for (const f of walk(path.join(codexHome, 'sessions'))) {
    let mtime; try { mtime = fs.statSync(f).mtimeMs; if (mtime < since) continue; } catch (_) { continue; }
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!line.includes('turn_context')) continue; let j; try { j = JSON.parse(line); } catch (_) { continue; }
      if (eventTime(j, mtime) < since) continue;
      const p = j.payload || j; const m = p.model || (p.turn_context && p.turn_context.model); const e = p.effort || p.reasoning_effort || (p.turn_context && p.turn_context.effort);
      if (m) { const k = e ? `${m} @ ${e}` : m; out[k] = (out[k] || 0) + 1; }
    }
  }
  return out;
}
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function importCursorCsv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`Cannot read ${file}: ${e.message}`); }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Cursor usage CSV has no data rows. The Dashboard export covers the current billing period only.');
  const headers = splitCsv(lines[0]).map(h => h.trim().toLowerCase());
  const col = (...names) => headers.findIndex(h => names.some(n => h === n || h.includes(n)));
  const inputAt = col('input tokens', 'input_tokens', 'input');
  const outputAt = col('output tokens', 'output_tokens', 'output');
  const cacheAt = col('cache read', 'cache_read', 'cached');
  const hasToken = headers.some(h => /token|input|output|cache/.test(h));
  if (!hasToken) throw new Error(`Unrecognized Cursor usage CSV layout. Headers: ${headers.join(', ') || '(none)'}. AskAI imports tokens, not dollars. The export covers the current billing period only.`);
  let input = 0; let output = 0; let cached = 0; let rows = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const num = i => { if (i < 0) return 0; const n = Number(String(cells[i] || '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
    input += num(inputAt); output += num(outputAt); cached += num(cacheAt); rows++;
  }
  return [
    `Cursor usage CSV: ${rows} row(s). Current billing period only.`,
    `tokens: input ${input}, output ${output}, cache ${cacheAt < 0 ? 'column absent' : cached}.`,
    'In-plan usage is exported with 0 USD. These totals are tokens, not dollars.',
  ].join('\n');
}
module.exports = { codex, codexModels, renderCodex, summarizeUsage, spendWhenEmpty, cacheText, fullText, isZeroReport, walk, eventTime, importCursorCsv };
