#!/usr/bin/env node
// askai / caveman / subagent performance + TOKEN SAVINGS report, built from Claude Code transcripts (~/.claude/projects/**/*.jsonl)
// plus askai's own files (metrics.jsonl, sessions/<sid>.arm.txt) and the settings that trim tokens.
// Usage: node askai-report.js [--hours 6] [--json]      (cumulative view: --hours 168 = 7 days, --hours 720 = 30 days)
// Transcripts carry no "without askai" baseline, so every saving is labelled by how it was obtained:
//   MEASURED = A/B control vs treatment sessions (historic; the arms were assigned by the retired askai hooks);  COMPUTED = exact arithmetic on known config;
//   OBSERVED = on/off comparison of different turns (confounded, not proof);  none = not measurable from transcripts.
const fs = require('fs'), path = require('path'), os = require('os');
const { MAX_STRING_LENGTH } = require('buffer').constants;

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hours = parseFloat(opt('hours', '6'));
const asJson = args.includes('--json');
const since = Date.now() - hours * 3600e3;
const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
const sfmt = n => (n < 0 ? '-' : '') + fmt(Math.abs(n));
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const cost = u => u.inp + 1.25 * u.cc + 0.1 * u.cr + 5 * u.out;   // relative units (input token = 1), not dollars
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };

const KINDS = [
  ['caveman', /Caveman mode \(|Caveman mode is now off/g],
  ['summary', /Feature checkpoint summary --|Tracked feature summaries exist|This project has tracked feature summaries/g],
  ['scope-full', /Token-efficient scoping reminder \(applies|Scoping \(new, distinct/g],
  ['scope-short', /Scoping reminder: apply/g],
  ['checkpoint', /Checkpoint triggered|Checkpoint due|Prompt tag '#/g],
  ['pending-clear', /Pending clear still owed|Reminder: a checkpoint from an earlier/g],
  ['volume', /Volume safety note|Tool-output volume (?:just )?crossed/g],
  ['precompact', /Context is about to be compacted/g],
];
function segments(text) {
  const marks = [];
  for (const [kind, re] of KINDS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) marks.push({ kind, at: m.index, hit: m[0] }); }
  marks.sort((a, b) => a.at - b.at);
  return marks.map((m, i) => ({ kind: m.kind, chars: (i + 1 < marks.length ? marks[i + 1].at : text.length) - m.at, off: /is now off/.test(m.hit), text: text.slice(m.at, m.at + 40) }));
}

const files = [];
if (fs.existsSync(projectsRoot)) (function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.jsonl') && fs.statSync(p).mtimeMs > since) files.push(p);
  }
})(projectsRoot);

const msgs = new Map();            // message id -> usage/text record (one per API response)
const toolNames = {};              // tool_use id -> tool name
const seenToolUse = new Set();
const toolOut = [];                // {name, chars, ts}
const mainEvents = {};             // sid -> ordered events for turn analysis
const sessInfo = {};               // sid -> {cwd, first, last}
const hookSegs = [];               // {sid, ts, kind, chars}
const clearCalls = [];
const agents = {};                 // agent file -> {sid, prompt}
const skillCalls = {}, agentTypes = {}, compactions = [];

for (const f of files) {
  const sub = f.split(path.sep).includes('subagents');
  const sid = sub ? path.basename(path.dirname(path.dirname(f))) : path.basename(f, '.jsonl');
  const agentKey = sub ? path.basename(f, '.jsonl') : null;
  const ev = mainEvents[sid] = mainEvents[sid] || [];
  const info = sessInfo[sid] = sessInfo[sid] || { cwd: null, first: Infinity, last: 0 };
  let cave = 'none';
  if (fs.statSync(f).size >= MAX_STRING_LENGTH) continue;    // too big for one JS string (ERR_STRING_TOO_LONG); skip rather than crash the whole report
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(j.timestamp || '');
    if (!sub && j.cwd && !info.cwd) info.cwd = j.cwd;
    if (ts) { info.first = Math.min(info.first, ts); info.last = Math.max(info.last, ts); }

    if (j.type === 'assistant' && j.message) {
      const m = j.message, u = m.usage || {};
      const id = m.id || j.uuid;
      let r = msgs.get(id);
      if (!r) { r = { id, sid, sub, agentKey, ts, out: 0, inp: 0, cr: 0, cc: 0, textChars: 0, cave, tools: [] }; msgs.set(id, r); }
      r.out = Math.max(r.out, u.output_tokens || 0);
      r.inp = Math.max(r.inp, u.input_tokens || 0);
      r.cr = Math.max(r.cr, u.cache_read_input_tokens || 0);
      r.cc = Math.max(r.cc, u.cache_creation_input_tokens || 0);
      for (const c of m.content || []) {
        if (c.type === 'text') { r.textChars += (c.text || '').length; if (!sub) ev.push({ t: 'text', id, ts, chars: (c.text || '').length }); }
        if (c.type === 'tool_use') {
          r.tools.push(c.name); toolNames[c.id] = c.name;
          if (!seenToolUse.has(c.id)) {
            seenToolUse.add(c.id);
            if (ts >= since) {
              const inp = c.input || {};
              if (c.name === 'Skill') { const k = inp.skill || inp.name || '?'; skillCalls[k] = (skillCalls[k] || 0) + 1; }
              if (c.name === 'Agent' || c.name === 'Task') { const k = inp.subagent_type || 'general-purpose'; agentTypes[k] = (agentTypes[k] || 0) + 1; }
            }
          }
          if (!sub && c.name === 'AskUserQuestion') ev.push({ t: 'ask', ts, q: JSON.stringify(c.input || {}) });
          if (!sub && /clear_session/.test(c.name)) clearCalls.push({ sid, ts });
        }
      }
    } else if (j.type === 'user' && j.message) {
      const c = j.message.content;
      if (Array.isArray(c) && c.some(x => x.type === 'tool_result')) {
        for (const x of c) {
          if (x.type !== 'tool_result') continue;
          const s = typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map(y => y.text || '').join('') : '';
          const nm = toolNames[x.tool_use_id] || '?';
          toolOut.push({ name: nm, chars: s.length, ts });
          if (!sub && nm !== 'AskUserQuestion') ev.push({ t: 'tool', ts, chars: s.length });
          if (!sub && nm === 'AskUserQuestion') ev.push({ t: 'answer', ts, s });
        }
      } else if (!j.isMeta) {
        const text = typeof c === 'string' ? c : (c || []).map(x => x.text || '').join('');
        if (sub) { if (agentKey && !agents[agentKey]) agents[agentKey] = { sid, prompt: text.replace(/\s+/g, ' ').slice(0, 70) }; }
        else if (text) ev.push({ t: 'prompt', ts, text });
      }
    } else if (!sub && j.type === 'system' && j.subtype === 'compact_boundary' && j.compactMetadata) {
      const cm = j.compactMetadata;
      if (ts && !compactions.some(c => c.sid === sid && c.ts === ts)) compactions.push({ sid, ts, trigger: cm.trigger, pre: cm.preTokens || 0, post: cm.postTokens || 0 });
    } else if (!sub && j.attachment && j.attachment.type === 'hook_additional_context') {
      const text = [].concat(j.attachment.content || []).join('\n\n');
      const kinds = [];
      for (const s of segments(text)) {
        hookSegs.push({ sid, ts, kind: s.kind, chars: s.chars });
        kinds.push(s.kind);
        if (s.kind === 'caveman') cave = s.off ? 'none' : ((s.text.match(/\((lite|full|ultra)/) || [])[1] || 'full');
      }
      ev.push({ t: 'hook', ts, kinds });
    }
  }
}

// ---------- window + totals ----------
const inWin = r => r.ts >= since;
const all = [...msgs.values()].filter(inWin);
const sum = list => list.reduce((a, r) => ({ out: a.out + r.out, inp: a.inp + r.inp, cr: a.cr + r.cr, cc: a.cc + r.cc, n: a.n + 1 }), { out: 0, inp: 0, cr: 0, cc: 0, n: 0 });
const main = all.filter(r => !r.sub), subs = all.filter(r => r.sub);
const T = sum(all), M = sum(main), S = sum(subs);

// main-session responses per session (all times, sorted): used for the carry cost of anything that sits in context
const mainBySid = {};
for (const r of msgs.values()) if (!r.sub) (mainBySid[r.sid] = mainBySid[r.sid] || []).push(r);
for (const k in mainBySid) mainBySid[k].sort((a, b) => a.ts - b.ts);
const later = (sid, ts) => { const a = mainBySid[sid] || []; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].ts >= ts) hi = m; else lo = m + 1; } return a.length - lo; };
const carry = (sid, ts) => 1.25 + 0.1 * later(sid, ts);   // cache write once + a re-read per later response

// ---------- per session ----------
const bySid = {};
for (const r of all) { const s = bySid[r.sid] = bySid[r.sid] || { main: [], sub: [] }; (r.sub ? s.sub : s.main).push(r); }
const promptsIn = sid => (mainEvents[sid] || []).filter(e => e.t === 'prompt' && e.ts >= since).length;
const sessions = Object.entries(bySid).map(([sid, s]) => {
  const m = sum(s.main), b = sum(s.sub);
  const peak = Math.max(0, ...s.main.map(r => r.inp + r.cr + r.cc));
  return { sid: sid.slice(0, 8), prompts: promptsIn(sid), mainResp: m.n, mainOut: m.out, mainCr: m.cr, subResp: b.n, subCr: b.cr, subOut: b.out, peakCtx: peak, cost: cost(m) + cost(b) };
}).filter(s => s.mainResp + s.subResp > 0).sort((a, b) => b.cost - a.cost);

// ---------- subagents ----------
const agentRows = {};
for (const r of subs) { const a = agentRows[r.agentKey] = agentRows[r.agentKey] || { key: r.agentKey, turns: 0, cr: 0, out: 0, prompt: (agents[r.agentKey] || {}).prompt || '' }; a.turns++; a.cr += r.cr; a.out += r.out; }
const agentList = Object.values(agentRows).sort((a, b) => b.cr - a.cr);
const longAgents = agentList.filter(a => a.turns > 100);

// ---------- hook (askai) overhead: injected tokens x carry ----------
const kindStats = {};
let hookTok = 0, hookUnits = 0;
for (const h of hookSegs) {
  if (h.ts < since) continue;
  const k = kindStats[h.kind] = kindStats[h.kind] || { n: 0, chars: 0, tokens: 0, units: 0 };
  const tok = h.chars / 4, u = tok * carry(h.sid, h.ts);
  k.n++; k.chars += h.chars; k.tokens += tok; k.units += u; hookTok += tok; hookUnits += u;
}

// ---------- scoping compliance, answer-length budget, tool volume per turn ----------
const turns = [];
for (const [sid, ev] of Object.entries(mainEvents)) {
  let t = null;
  const close = () => { if (t && t.ts >= since) turns.push(t); };
  for (const e of ev) {
    if (e.t === 'prompt') { close(); t = { sid, ts: e.ts, scope: false, asked: false, summary: false, budget: null, toolChars: 0, toolCarry: 0, texts: new Map(), order: [] }; }
    else if (!t) continue;
    else if (e.t === 'hook') { if (e.kinds.some(k => k.startsWith('scope'))) t.scope = true; if (e.kinds.includes('summary')) t.summary = true; }
    else if (e.t === 'ask' && /area|scope|answer length/i.test(e.q)) t.asked = true;
    else if (e.t === 'answer') { const b = e.s.match(/length[^"]*"="([\d,]+)\s*char/i); if (b) t.budget = parseInt(b[1].replace(/,/g, ''), 10); }
    else if (e.t === 'tool') { t.toolChars += e.chars; t.toolCarry += e.chars / 4 * carry(sid, e.ts); }
    else if (e.t === 'text' && e.chars) { t.texts.set(e.id, (t.texts.get(e.id) || 0) + e.chars); t.order = t.order.filter(x => x !== e.id).concat(e.id); }
  }
  close();
}
const finalChars = t => t.texts.get(t.order[t.order.length - 1]);
const eligible = turns.filter(t => t.scope), asked = eligible.filter(t => t.asked);
const budgeted = turns.filter(t => t.budget && t.order.length).map(t => ({ budget: t.budget, chars: finalChars(t) }));
const withinBudget = budgeted.filter(b => b.chars <= b.budget * 1.1);

// ---------- caveman: observational comparison by mode active at response time ----------
const cmp = { on: { textResp: [], out: [], final: [] }, off: { textResp: [], out: [], final: [] } };
for (const r of main) {
  const g = r.cave === 'none' ? cmp.off : cmp.on;
  g.out.push(r.out);
  if (r.textChars > 0) g.textResp.push(r.textChars);
}
for (const t of turns) {
  if (!t.order.length) continue;
  const rec = msgs.get(t.order[t.order.length - 1]);
  (rec && rec.cave !== 'none' ? cmp.on : cmp.off).final.push(finalChars(t));
}

// ---------- A/B arms (opt-in) ----------
function findAskaiDir(cwd) {
  for (let d = cwd; d && d !== path.dirname(d); d = path.dirname(d)) { const p = path.join(d, '.claude', 'askai'); if (fs.existsSync(p)) return p; }
  return null;
}
const askaiDirs = new Set(), arms = {};
for (const [sid, i] of Object.entries(sessInfo)) {
  if (!i.cwd) continue;
  const d = findAskaiDir(i.cwd); if (!d) continue;
  askaiDirs.add(d);
  const af = path.join(d, 'sessions', sid + '.arm.txt');
  if (fs.existsSync(af)) arms[sid] = fs.readFileSync(af, 'utf8').trim();
}
const armStats = {};
for (const [sid, arm] of Object.entries(arms)) {
  const s = bySid[sid]; if (!s) continue;
  const a = armStats[arm] = armStats[arm] || { sessions: 0, prompts: 0, out: 0, cr: 0, resp: 0, cost: 0 };
  const m = sum(s.main), b = sum(s.sub);
  a.sessions++; a.prompts += promptsIn(sid); a.out += m.out + b.out; a.cr += m.cr + b.cr; a.resp += m.n + b.n; a.cost += cost(m) + cost(b);
}
let abMeasured = null;
{
  const c = armStats.control, t = armStats.treatment;
  if (c && t && c.prompts && t.prompts) {
    const cp = c.cost / c.prompts, tp = t.cost / t.prompts;
    abMeasured = { per_prompt_control: cp, per_prompt_treatment: tp, saved_per_prompt: cp - tp, saved_total: (cp - tp) * t.prompts, saved_share: (cp - tp) / cp,
      sessions_control: c.sessions, sessions_treatment: t.sessions, trustworthy: Math.min(c.sessions, t.sessions) >= 8 };
  }
}

// ---------- checkpoints / clears ----------
const metrics = [];
for (const d of askaiDirs) {
  const mf = path.join(d, 'metrics.jsonl');
  if (!fs.existsSync(mf)) continue;
  for (const l of fs.readFileSync(mf, 'utf8').split('\n')) { try { const j = JSON.parse(l); if (Date.parse(j.ts) >= since) metrics.push(j); } catch { } }
}

// ---------- tool output volume ----------
const outBy = {};
for (const o of toolOut) if (o.ts >= since) { const x = outBy[o.name] = outBy[o.name] || { n: 0, chars: 0, max: 0 }; x.n++; x.chars += o.chars; x.max = Math.max(x.max, o.chars); }
const outList = Object.entries(outBy).sort((a, b) => b[1].chars - a[1].chars);

// ======================= TOKEN SAVINGS LEDGER =======================
const ledger = { saved: [], cost: [], avoided: [] };
const addSaved = (label, tokens, units, bucket, note, grp) => ledger.saved.push({ label, tokens, units, bucket, note, grp });
const ctxOf = r => r.inp + r.cr + r.cc;

// A1 caveman: visible reply text, caveman-on responses vs caveman-off responses (observational)
{
  const on = main.filter(r => r.cave !== 'none' && r.textChars > 0), off = cmp.off.textResp;
  const d = mean(off) - mean(on.map(r => r.textChars));
  if (on.length >= 20 && off.length >= 20 && d > 0) {
    addSaved('caveman terse replies', on.length * d / 4, on.reduce((a, r) => a + d / 4 * (6.25 + 0.1 * later(r.sid, r.ts)), 0), 'observed',
      `${on.length} on-responses average ${Math.round(mean(on.map(r => r.textChars)))} text chars vs ${Math.round(mean(off))} off (${Math.round(d)} fewer); different tasks, so correlation only`, 'reply');
  } else addSaved('caveman terse replies', 0, 0, 'none', `caveman-on ${on.length} responses avg ${on.length ? Math.round(mean(on.map(r => r.textChars))) : 'n/a'} text chars vs off ${off.length} avg ${off.length ? Math.round(mean(off)) : 'n/a'}; ${on.length < 20 || off.length < 20 ? 'too few responses in a group' : 'no reduction observed'}, 0 credited`, 'reply');
}
// A2 answer-length budget: final replies of budgeted turns vs final replies of turns with no budget (observational)
{
  const bt = turns.filter(t => t.budget && t.order.length), ub = turns.filter(t => !t.budget && t.order.length);
  const d = mean(ub.map(finalChars)) - mean(bt.map(finalChars));
  if (bt.length >= 5 && ub.length >= 5 && d > 0) {
    addSaved('answer-length budget', bt.length * d / 4, bt.reduce((a, t) => a + d / 4 * (6.25 + 0.1 * later(t.sid, (msgs.get(t.order[t.order.length - 1]) || t).ts)), 0), 'observed',
      `budgeted final replies average ${Math.round(mean(bt.map(finalChars)))} chars vs ${Math.round(mean(ub.map(finalChars)))} without a budget (n=${bt.length}/${ub.length}); overlaps caveman, counted once in NET`, 'reply');
  } else addSaved('answer-length budget', 0, 0, 'none', `budgeted final replies ${bt.length ? Math.round(mean(bt.map(finalChars))) : 'n/a'} chars vs ${ub.length ? Math.round(mean(ub.map(finalChars))) : 'n/a'} unbudgeted (n=${bt.length}/${ub.length}); no reduction or too few turns`, 'reply');
}
// A3/A4 tool volume per turn: scoped vs not, feature-summary vs not (observational)
function cmpTurns(label, withT, withoutT, what) {
  if (withT.length < 5 || withoutT.length < 5) return addSaved(label, 0, 0, 'none', `too few turns (${withT.length} with / ${withoutT.length} without) to compare`);
  const a = mean(withT.map(t => t.toolChars)) / 4, b = mean(withoutT.map(t => t.toolChars)) / 4;
  // task mix differs between the groups (heavy-tailed tool output), so this is shown but never credited; only the A/B can attribute it
  addSaved(label, 0, 0, 'none', `${what}: ${fmt(a)} tool-output tokens/turn with vs ${fmt(b)} without (n=${withT.length}/${withoutT.length}); comparison only, 0 credited (task mix differs -- the A/B is the test)`);
}
cmpTurns('scoping question (area limit)', asked, eligible.filter(t => !t.asked), 'asked turns');
cmpTurns('feature-summary injection', turns.filter(t => t.summary), turns.filter(t => !t.summary), 'summary turns');

// A5 skill name-only overrides: descriptions dropped from the skill listing that rides in every main-session context (computed)
function findSkillMd(name) {
  const bare = name.replace(/^[^:]*:/, '');
  const cands = [path.join(os.homedir(), '.claude', 'skills', bare, 'SKILL.md')];
  const base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'local-agent-mode-sessions', 'skills-plugin');
  try { for (const a of fs.readdirSync(base)) for (const b of fs.readdirSync(path.join(base, a))) cands.push(path.join(base, a, b, 'skills', bare, 'SKILL.md')); } catch { }
  return cands.find(p => fs.existsSync(p));
}
function descChars(file) {
  const t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const fm = (t.match(/^---\n([\s\S]*?)\n---/) || [])[1]; if (!fm) return 0;
  const m = ('\n' + fm).match(/\ndescription:[ \t]*([\s\S]*?)(?=\n[A-Za-z_-]+:|$)/); if (!m) return 0;
  return m[1].replace(/^[>|][+-]?\s*/, '').replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim().length;
}
const userSettings = readJson(path.join(os.homedir(), '.claude', 'settings.json')) || {};
const projSettings = [];
for (const i of Object.values(sessInfo)) if (i.cwd) for (const n of ['settings.json', 'settings.local.json']) { const s = readJson(path.join(i.cwd, '.claude', n)); if (s && !projSettings.includes(s)) projSettings.push(s); }
{
  const so = userSettings.skillOverrides || {};
  const names = Array.isArray(so) ? so : Object.entries(so).filter(([, v]) => v === 'name-only').map(([k]) => k);
  const found = names.map(n => ({ n, f: findSkillMd(n) })).filter(x => x.f).map(x => ({ n: x.n, ch: descChars(x.f) }));
  const descTok = found.reduce((a, x) => a + x.ch, 0) / 4;
  let tok = 0, units = 0;
  for (const [sid, s] of Object.entries(bySid)) if (s.main.length) { tok += descTok; units += descTok * ((sessInfo[sid].first >= since ? 1.25 : 0) + 0.1 * s.main.length); }
  if (names.length) addSaved(`skill name-only overrides (${found.length}/${names.length} measurable)`, tok, units, 'computed',
    `${fmt(descTok)} description tokens dropped from the skill list per session x ${Object.values(bySid).filter(s => s.main.length).length} sessions; ${names.length - found.length} skills are built-in (no file to measure) so this is a floor`);
  else addSaved('skill name-only overrides', 0, 0, 'none', 'none configured');
}
// A6 clear_session cycles: context dropped x re-reads avoided (observational; assumes the old context would have been kept)
{
  let tok = 0, units = 0, tracked = 0;
  const cc = clearCalls.filter(c => c.ts >= since);
  for (const c of cc) {
    const arr = mainBySid[c.sid] || [], pre = [...arr].reverse().find(r => r.ts <= c.ts), post = arr.filter(r => r.ts > c.ts);
    if (pre && post.length) { const drop = ctxOf(pre) - ctxOf(post[0]); if (drop > 0) { tracked++; tok += drop; units += 0.1 * drop * post.length; } }
  }
  addSaved('checkpoint + clear_session cycle', tok, units, tracked ? 'observed' : 'none', `${cc.length} clear call(s), ${metrics.length} metrics row(s); ${tracked} traceable into a continuation in the same session${tracked ? '' : ' (0 credited)'}`);
}
// A7 compaction (autoCompactWindow): shown for reference, never credited (compaction happens regardless of askai)
{
  const cs = compactions.filter(c => c.ts >= since);
  let tok = 0;
  for (const c of cs) if (c.pre > c.post) tok += c.pre - c.post;
  const auto = cs.filter(c => c.trigger === 'auto').length;
  addSaved(`context compaction${userSettings.autoCompactWindow ? ' (autoCompactWindow ' + fmt(userSettings.autoCompactWindow) + ')' : ''}`, 0, 0, 'none',
    `${cs.length} compaction(s) in window (${auto} auto, ${cs.length - auto} manual); ${cs.length ? 'typically at ' + fmt(median(cs.map(c => c.pre))) + ' context tokens, ' : ''}freed ${fmt(tok)} context tokens in total. Not credited: Claude Code compacts regardless of askai, and the gain from the window setting vs its default is not separable`);
}
// info rows (no number credited)
const capCfg = [userSettings, ...projSettings].map(s => s.bashOutputMaxChars).filter(Boolean);
const capChars = capCfg.length ? Math.min(...capCfg) : null;
const nearCap = capChars ? toolOut.filter(o => o.ts >= since && (o.name === 'Bash' || /Task|Bash/.test(o.name)) && o.chars >= capChars * 0.93).length : 0;
const infoRows = [];
if (capChars) infoRows.push(`tool-output cap (${fmt(capChars)} chars): ${nearCap} Bash/Task results at the cap; the cut-off amount is not recorded in transcripts, so 0 credited`);
const nAgentsMain = Object.values(agentTypes).reduce((a, b) => a + b, 0);
infoRows.push(`Explore/subagent delegation: ${nAgentsMain} agent launches (${Object.entries(agentTypes).map(([k, v]) => k + ' x' + v).join(', ') || 'none'}); keeps their tool output out of the main context but has no baseline, 0 credited`);
const skillList = Object.entries(skillCalls).sort((a, b) => b[1] - a[1]);
infoRows.push(`skills invoked: ${skillList.length ? skillList.map(([k, v]) => k + ' x' + v).join(', ') : 'none'} (a name-only skill still loads fully when invoked)`);

// B cost: hook text carried in context + the marginal API call of each AskUserQuestion round-trip
for (const [k, v] of Object.entries(kindStats).sort((a, b) => b[1].units - a[1].units)) ledger.cost.push({ label: 'hook: ' + k + ' x' + v.n, tokens: v.tokens, units: v.units });
const askResp = main.filter(r => r.tools.includes('AskUserQuestion'));
const askUnits = askResp.reduce((a, r) => a + cost(r), 0);
ledger.cost.push({ label: 'AskUserQuestion calls x' + askResp.length + ' (extra API call each)', tokens: askResp.reduce((a, r) => a + r.out, 0), units: askUnits });
const costUnits = hookUnits + askUnits;

// C overhead already avoided by send-once / short-pointer design (vs re-injecting the full text every prompt); not part of NET
function avoidedOnce(kind) {
  let tok = 0, units = 0; const per = {};
  for (const h of hookSegs) if (h.kind === kind && h.ts >= since) (per[h.sid] = per[h.sid] || []).push(h);
  for (const [sid, hs] of Object.entries(per)) {
    const first = Math.min(...hs.map(h => h.ts));
    const ps = (mainEvents[sid] || []).filter(e => e.t === 'prompt' && e.ts > first && e.ts >= since);
    const extra = Math.max(0, ps.length - (hs.length - 1)); if (!extra) continue;
    const avg = mean(hs.map(h => h.chars / 4));
    tok += extra * avg; units += extra * avg * mean(ps.map(p => carry(sid, p.ts)));
  }
  return { tok, units };
}
{
  const fullChars = mean(hookSegs.filter(h => h.kind === 'scope-full').map(h => h.chars));
  let tok = 0, units = 0;
  for (const h of hookSegs) if (h.kind === 'scope-short' && h.ts >= since && fullChars > h.chars) { const d = (fullChars - h.chars) / 4; tok += d; units += d * carry(h.sid, h.ts); }
  ledger.avoided.push({ label: 'scoping: short pointer instead of full block', tokens: tok, units });
  for (const k of ['caveman', 'summary']) { const a = avoidedOnce(k); ledger.avoided.push({ label: k + ': once per session, not every prompt', tokens: a.tok, units: a.units }); }
}

// NET
const savedBy = b => ledger.saved.filter(r => r.bucket === b);
const compTok = savedBy('computed').reduce((a, r) => a + r.tokens, 0), compU = savedBy('computed').reduce((a, r) => a + r.units, 0);
const obs = savedBy('observed'), obsReply = obs.filter(r => r.grp === 'reply'), obsOther = obs.filter(r => r.grp !== 'reply');
const obsU = Math.max(0, ...obsReply.map(r => r.units)) + obsOther.reduce((a, r) => a + r.units, 0);
const obsTok = Math.max(0, ...obsReply.map(r => r.tokens)) + obsOther.reduce((a, r) => a + r.tokens, 0);
const net = { computed_units: compU - costUnits, all_units: compU + obsU - costUnits, share_computed: (compU - costUnits) / (cost(T) || 1), share_all: (compU + obsU - costUnits) / (cost(T) || 1) };

// ---------- output ----------
const R = {
  window_hours: hours, responses: T.n, main_sessions: sessions.filter(s => s.mainResp).length,
  totals: { out: T.out, cache_read: T.cr, cache_create: T.cc, uncached_in: T.inp, cost_units: cost(T) },
  main: M, sub: S, sub_share_of_cost: cost(S) / (cost(T) || 1),
  ledger: { saved: ledger.saved, cost: ledger.cost, avoided_by_design: ledger.avoided, info: infoRows,
    totals: { computed_saved_tokens: compTok, computed_saved_units: compU, observed_saved_tokens: obsTok, observed_saved_units: obsU, askai_cost_units: costUnits, askai_hook_tokens: hookTok, net }, ab_measured: abMeasured },
  askai: { hook_injections: kindStats, scoping: { eligible: eligible.length, asked: asked.length }, budget: { measured: budgeted.length, within: withinBudget.length },
    checkpoint_metrics: metrics.length, clear_calls: clearCalls.filter(c => c.ts >= since).length },
  caveman: { on: { responses: cmp.on.out.length, mean_text_chars: mean(cmp.on.textResp), mean_out_tokens: mean(cmp.on.out), mean_final_chars: mean(cmp.on.final) },
    off: { responses: cmp.off.out.length, mean_text_chars: mean(cmp.off.textResp), mean_out_tokens: mean(cmp.off.out), mean_final_chars: mean(cmp.off.final) } },
  ab: armStats,
};
if (asJson) { console.log(JSON.stringify(R, null, 2)); process.exit(0); }

const L = [];
const row = (...c) => L.push(c.join(''));
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
L.push(`askai / caveman / subagent report -- last ${hours}h  (${files.length} transcript files, ${T.n} responses, ${R.main_sessions} main sessions)`);
L.push('Relative cost units = input + 1.25*cache_create + 0.1*cache_read + 5*output (input token = 1); estimates, not billing.', '');

L.push('TOKEN SAVINGS LEDGER  (what askai, its plugins and the settings saved vs what they cost)');
L.push('  tokens = raw tokens kept out of output/context; units = cost-weighted (write 1.25, re-read 0.1 per later response, output 5).');
L.push('  Evidence: MEASURED = A/B arms | COMPUTED = exact config arithmetic | OBSERVED = on/off comparison, confounded (not proof) | none = unmeasurable.', '');
const lrow = (label, tok, u, ev) => row('    ', pad(label, 50), lpad(fmt(tok), 8), lpad(fmt(u), 9), '  ', ev);
L.push('  A. SAVED' + ' '.repeat(45) + lpad('tokens', 8) + lpad('units', 9) + '  evidence');
for (const r of ledger.saved) { lrow(r.label, r.tokens, r.units, r.bucket.toUpperCase()); L.push('        ' + r.note); }
for (const s of infoRows) L.push('    - ' + s);
L.push('');
L.push('  B. COST OF ASKAI' + ' '.repeat(37) + lpad('tokens', 8) + lpad('units', 9));
for (const r of ledger.cost) lrow(r.label, r.tokens, r.units, '');
L.push('        AskUserQuestion counts every ask in main sessions (scoping, checkpoint confirms, any other). Excludes agent work the hooks trigger (file writes, get_usage, metrics lines), so cost is a floor.');
L.push('');
L.push('  C. OVERHEAD ALREADY AVOIDED BY DESIGN (not part of NET; B would have been this much larger)');
for (const r of ledger.avoided) lrow(r.label, r.tokens, r.units, '');
L.push('');
L.push(`  NET  computed only:               ${sfmt(compU)} saved - ${fmt(costUnits)} cost = ${sfmt(compU - costUnits)} units (${(100 * net.share_computed).toFixed(2)}% of total spend)`);
L.push(`  NET  incl. observed estimates:    ${sfmt(compU + obsU)} saved - ${fmt(costUnits)} cost = ${sfmt(compU + obsU - costUnits)} units (${(100 * net.share_all).toFixed(2)}% of total spend; reply-length rows counted once)`);
if (abMeasured) L.push(`  MEASURED A/B (caveman + scoping): control ${fmt(abMeasured.per_prompt_control)} vs treatment ${fmt(abMeasured.per_prompt_treatment)} units/prompt -> ${sfmt(abMeasured.saved_per_prompt)}/prompt (${(100 * abMeasured.saved_share).toFixed(1)}%), ${sfmt(abMeasured.saved_total)} units over ${armStats.treatment.prompts} treatment prompts; ${abMeasured.sessions_control}/${abMeasured.sessions_treatment} sessions${abMeasured.trustworthy ? '' : ' -- too few sessions to trust (need >=8 per arm)'}.`);
else L.push('  MEASURED A/B: none yet -- no proven savings. The A/B arms were assigned by the retired askai hooks, so no new arm data is being recorded.');
L.push('');

L.push('1. WHERE TOKENS WENT');
L.push(pad('', 14) + lpad('responses', 10) + lpad('output', 10) + lpad('cache_read', 12) + lpad('cache_create', 13) + lpad('cost units', 12) + lpad('share', 8));
for (const [n, s] of [['main', M], ['subagents', S], ['total', T]]) row(pad(n, 14), lpad(s.n, 10), lpad(fmt(s.out), 10), lpad(fmt(s.cr), 12), lpad(fmt(s.cc), 13), lpad(fmt(cost(s)), 12), lpad(pct(cost(s), cost(T)), 8));
L.push('');
L.push('Top sessions by cost (main + their subagents):');
L.push(pad('  session', 11) + lpad('prompts', 8) + lpad('main resp', 10) + lpad('main out', 10) + lpad('sub resp', 9) + lpad('sub cr', 9) + lpad('peak ctx', 10) + lpad('cost', 9));
for (const s of sessions.slice(0, 6)) row('  ' + pad(s.sid, 9), lpad(s.prompts, 8), lpad(s.mainResp, 10), lpad(fmt(s.mainOut), 10), lpad(s.subResp, 9), lpad(fmt(s.subCr), 9), lpad(fmt(s.peakCtx), 10), lpad(fmt(s.cost), 9));
L.push('');
L.push(`Subagents: ${agentList.length} agents, ${S.n} turns; ${longAgents.length} ran >100 turns. Heaviest:`);
for (const a of agentList.slice(0, 5)) L.push(`  ${a.key.slice(0, 14)}  ${lpad(a.turns, 4)} turns  cache_read ${lpad(fmt(a.cr), 7)}  out ${lpad(fmt(a.out), 6)}  "${a.prompt}"`);
L.push('');

L.push('2. ASKAI OVERHEAD (hook text injected into context)');
L.push(pad('  kind', 16) + lpad('times', 7) + lpad('chars', 9) + lpad('~tokens', 9) + lpad('cost units*', 13));
for (const [k, v] of Object.entries(kindStats).sort((a, b) => b[1].units - a[1].units)) row('  ' + pad(k, 14), lpad(v.n, 7), lpad(fmt(v.chars), 9), lpad(fmt(v.tokens), 9), lpad(fmt(v.units), 13));
L.push(`  * units = tokens x (1.25 cache write + 0.1 x later responses in that session); ignores compaction/clears, so a slight overestimate.`);
L.push(`  Total ~${fmt(hookTok)} tokens = ${fmt(hookUnits)} units = ${pct(hookUnits, cost(T))} of total cost units (${pct(hookUnits, cost(M))} of main-session cost).`);
const multiFull = Object.entries(hookSegs.filter(h => h.ts >= since && h.kind === 'scope-full').reduce((a, h) => (a[h.sid] = (a[h.sid] || 0) + 1, a), {})).filter(([, n]) => n > 2);
if (multiFull.length) L.push(`  Full scoping block re-sent >2x in ${multiFull.length} session(s) (${multiFull.map(([k, n]) => k.slice(0, 8) + ' x' + n).join(', ')}): sessions started on an older hook version (full block every prompt) or post-compaction.`);
L.push('');

L.push('3. ASKAI BEHAVIOUR');
L.push(`  Prompts that received the scoping reminder: ${eligible.length}; AskUserQuestion scoping asked: ${asked.length} (${pct(asked.length, eligible.length)}; follow-ups are meant to skip, so <100% is expected).`);
L.push(`  Answer-length budget set on ${budgeted.length} turns; final reply within budget (+10%): ${withinBudget.length} (${pct(withinBudget.length, budgeted.length)}).` + (budgeted.length ? ` Median reply/budget = ${(median(budgeted.map(b => b.chars / b.budget))).toFixed(2)}.` : ''));
const nk = k => (kindStats[k] || { n: 0 }).n;
L.push(`  Triggers fired: ${nk('checkpoint')} checkpoint reminders (v2: volume-note and pending-clear retired).  Completed cycle: ${metrics.length} metrics lines, ${R.askai.clear_calls} clear_session calls.` + (metrics.length ? ` Context at checkpoint: ${metrics.map(m => (m.tokens_used != null ? Math.round(m.tokens_used/1000) + 'K' : (m.percent_used ?? '?') + '%')).join(', ')}.` : ''));
L.push('');

L.push('4. CAVEMAN (observational: responses grouped by whether caveman mode was active when produced)');
L.push(pad('', 16) + lpad('responses', 10) + lpad('text chars/resp', 17) + lpad('out tokens/resp', 17) + lpad('final reply chars', 19));
for (const [n, g] of [['caveman on', cmp.on], ['caveman off', cmp.off]]) row(pad('  ' + n, 16), lpad(g.out.length, 10), lpad(Math.round(mean(g.textResp)), 17), lpad(Math.round(mean(g.out)), 17), lpad(Math.round(mean(g.final)), 19));
if (cmp.on.out.length > 20 && cmp.off.out.length > 20 && mean(cmp.off.final) && mean(cmp.on.final)) L.push(`  Final replies with caveman on are ${(100 * (1 - mean(cmp.on.final) / mean(cmp.off.final))).toFixed(0)}% shorter than off (different tasks/sessions -> correlation only; needs the A/B for proof).`);
else L.push('  Too few responses in one group to compare; widen --hours.');
L.push('');

L.push('5. A/B ARMS (historic: assigned by the retired askai hooks; control sessions skipped caveman + scoping reminder)');
if (Object.keys(armStats).length < 2) L.push('  No two-arm data in this window. The retired hooks assigned the arms, so none are being recorded now.');
else {
  L.push(pad('  arm', 12) + lpad('sessions', 9) + lpad('prompts', 8) + lpad('out/prompt', 11) + lpad('cost/prompt', 12) + lpad('resp/prompt', 12));
  for (const [arm, a] of Object.entries(armStats)) row('  ' + pad(arm, 10), lpad(a.sessions, 9), lpad(a.prompts, 8), lpad(fmt(a.out / (a.prompts || 1)), 11), lpad(fmt(a.cost / (a.prompts || 1)), 12), lpad((a.resp / (a.prompts || 1)).toFixed(1), 12));
}
L.push('');

L.push('6. TOOL OUTPUT VOLUME (chars returned into context)');
for (const [n, v] of outList.slice(0, 6)) L.push(`  ${pad(n, 22)} ${lpad(v.n, 5)} calls  ${lpad(fmt(v.chars), 8)} chars  largest ${fmt(v.max)}`);
L.push('');

L.push('VERDICT');
L.push(`  - Tokens saved (units): computed ${sfmt(compU)}${compU ? '' : ' (nothing computable beyond config)'}, observed-but-unproven ${sfmt(obsU)}; askai cost ${fmt(costUnits)}; NET ${sfmt(compU - costUnits)} computed / ${sfmt(compU + obsU - costUnits)} incl. observed = ${(100 * net.share_all).toFixed(2)}% of ${fmt(cost(T))} total spend.`);
L.push(net.all_units < 0 ? '  - On this evidence askai + caveman cost more than they saved; the savings that exist are too small to see against total spend.' : '  - Savings exceed cost only if the observed (confounded) rows are real; the A/B is the only proof.');
L.push(`  - Subagents = ${pct(cost(S), cost(T))} of cost units; ${longAgents.length} of ${agentList.length} agents ran >100 turns (${pct(longAgents.reduce((a, x) => a + x.cr * 0.1 + x.out * 5, 0), cost(S))} of subagent cost). Biggest lever.`);
L.push(`  - Scoping asked on ${asked.length}/${eligible.length} eligible prompts; answer budgets respected ${pct(withinBudget.length, budgeted.length)}.`);
L.push(abMeasured ? `  - A/B data present: measured saving ${sfmt(abMeasured.saved_per_prompt)} units/prompt (${(100 * abMeasured.saved_share).toFixed(1)}%)${abMeasured.trustworthy ? '' : ', too few sessions to trust yet'}.` : '  - No proven savings: there is no A/B data in this window (the retired hooks assigned the arms). Use `askai status` for what the tools themselves measure.');
console.log(L.join('\n'));
