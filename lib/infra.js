'use strict';
// askai infra [dir]: everything AskAI set up, per tool and for the repository: CLI versions, settings, AskAI blocks and files,
// rules, agents, skills, hooks, MCP servers (on, off, parked), plugins, and usage evidence from the last 7 days (MCP calls and the
// models subagents and Codex sessions really used). Installed is not configured is not used; this shows all three.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');
const mcp = require('./mcp');
const usage = require('./usage');
const models = require('./models');

const ls = (d, re = /./) => { try { return fs.readdirSync(d).filter(n => re.test(n)); } catch (_) { return []; } };
const lines = f => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).length; } catch (_) { return null; } };
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } };
function mcpCalls(ctx, days = 7) {
  const since = Date.now() - days * 86400000; const out = {};
  for (const f of usage.walk(path.join(ctx.paths.home, 'projects'))) {
    let mtime; try { mtime = fs.statSync(f).mtimeMs; if (mtime < since) continue; } catch (_) { continue; }
    let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of t.split(/\r?\n/)) {
      if (!line.includes('mcp__')) continue;
      let j; try { j = JSON.parse(line); } catch (_) { continue; }
      const ts = usage.eventTime(j, mtime);
      if (ts < since) continue;
      for (const m of line.matchAll(/"name"\s*:\s*"mcp__([A-Za-z0-9_-]+?)__/g)) out[m[1]] = (out[m[1]] || 0) + 1;
    }
  }
  return out;
}
function collect(ctx, dir) {
  const r = { tools: {}, repo: null };
  let s = {}; try { s = cfg.readJson(ctx.paths.settings); } catch (_) { /* unreadable */ }
  const hooks = cfg.listHooks(s);
  const man = ctx.manifest || {};
  const servers = (() => { try { return mcp.list(ctx); } catch (_) { return []; } })();
  const by = t => servers.filter(x => x.tool === t).map(x => `${x.name} (${x.state})`);
  const ver = b => { if (!b || (!path.isAbsolute(b) && (!ctx.which || !ctx.which(b)))) return null; const p = ctx.probe ? ctx.probe(b, ['--version'], { timeout: 5000 }) : null; return p && p.ok ? String(p.stdout).trim().split(/\r?\n/)[0].slice(0, 60) : 'installed'; };
  const prefs = models.load(ctx);
  const tiers = t => models.TIERS.map(k => { const p = models.pick(prefs, t, k); return `${k} ${p.model}/${p.effort}`; }).join(', ');
  r.tools.claude = { cli: ver((ctx.claudeBin && ctx.claudeBin()) || 'claude'), config: ctx.paths.home,
    settings: { model: s.model || null, effort: s.effortLevel || process.env.CLAUDE_CODE_EFFORT_LEVEL || null, autoCompactWindow: s.autoCompactWindow || null, subagentModel: (s.env || {}).CLAUDE_CODE_SUBAGENT_MODEL || null, denyRules: ((s.permissions || {}).deny || []).length, statusLine: s.statusLine ? 'set' : null },
    askaiBlock: (cfg.readText(ctx.paths.claudeMd) || '').includes(cfg.BEGIN.slice(0, 20)), rules: ls(ctx.paths.rules, /^askai-/), commands: ls(path.join(ctx.paths.home, 'commands'), /^askai/),
    hooks: hooks.map(h => `${h.event}${/askai\.js"? hook/.test(h.command) ? ' (askai reminder)' : /\brtk\b/.test(h.command) ? ' (rtk)' : ''}`), mcp: by('claude'),
    plugins: Object.entries(s.enabledPlugins || {}).filter(([, v]) => v !== false).map(([k]) => k), agents: ls(path.join(ctx.paths.home, 'agents'), /\.md$/), skills: ls(path.join(ctx.paths.home, 'skills')), tiers: tiers('claude') };
  try { const c = mcpCalls(ctx); r.tools.claude.mcpCallsLast7Days = c; } catch (_) { /* none */ }
  try { const log = require('./audit').newestClaudeLog(ctx); if (log) r.tools.claude.subagentModels = require('./audit').parseClaude(log).subagents; } catch (_) { /* none */ }
  if (ctx.codexPaths) { const t = cfg.readText(ctx.codexPaths.config) || ''; r.tools.codex = { cli: ver('codex'), config: ctx.codexPaths.home, keys: (t.match(/^(model_reasoning_effort|model_verbosity|personality|model)\s*=.*$/gm) || []), askaiBlock: /askai/i.test(cfg.readText(ctx.codexPaths.agentsMd) || ''), mcp: by('codex'), agents: ls(path.join(ctx.codexPaths.home, 'agents'), /\.toml$/), tiers: tiers('codex'), modelsLast7Days: usage.codexModels(ctx.codexPaths.home, 7) }; }
  if (ctx.agyPaths) { let a = {}; try { a = cfg.readJson(ctx.agyPaths.cliSettings); } catch (_) { /* none */ } r.tools.agy = { cli: ver('agy'), config: ctx.agyPaths.home, useG1Credits: a.useG1Credits, askaiBlock: /askai/i.test(cfg.readText(ctx.agyPaths.rulesMd) || ''), rules: ls(path.join(ctx.agyPaths.home, 'config', 'rules'), /^askai-/), mcp: by('agy'), agents: ls(path.join(ctx.agyPaths.home, 'config', 'agents')), tiers: tiers('agy') }; }
  if (ctx.cursorPaths) r.tools.cursor = { cli: ver('agent') || ver('cursor-agent'), config: ctx.cursorPaths.home, rules: ls(path.join(ctx.cursorPaths.home, 'rules'), /^askai-/), commands: ls(path.join(ctx.cursorPaths.home, 'commands'), /^askai/), mcp: by('cursor'), agents: ls(path.join(ctx.cursorPaths.home, 'agents'), /\.md$/), tiers: tiers('cursor') };
  r.manifestComponents = Object.keys((man && man.components) || {}).length;
  // Every plugin and third-party tool AskAI knows, and its state here: per tool for MCP servers, on PATH for CLIs.
  const plug = require('./plugins'); const ep = s.enabledPlugins || {};
  r.plugins = plug.P.filter(p => p.det.bin || p.det.mcp || p.det.plugin).map(p => {
    const d = p.det; let state;
    const rows = d.mcp ? servers.filter(x => x.name.toLowerCase().includes(d.mcp)) : [];
    const enabled = d.plugin && Object.keys(ep).some(k => k.startsWith(d.plugin) && ep[k] !== false);
    if (rows.length) state = [enabled ? 'claude plugin' : null, ...rows.map(x => `${x.tool} ${x.state}`)].filter(Boolean).join(', ');
    else if (d.mcp && !d.bin) state = 'not configured';
    else if (d.plugin) state = enabled ? 'enabled (Claude Code)' : 'not installed';
    else if (d.bin) state = ctx.which && ctx.which(d.bin) ? 'on PATH' : 'not installed';
    const how = p.how.component ? `askai install --only ${p.how.component}${p.how.flag ? ` or ${p.how.flag}` : ''}` : p.how.context7 || p.how.npm || p.how.graphify ? `askai plugins install ${p.id}` : 'askai plugins info ' + p.id;
    return { id: p.id, name: p.name, state, evidence: p.evidence, add: how };
  });
  if (dir) {
    const f = n => path.join(dir, n);
    r.repo = { dir, files: Object.fromEntries(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorignore', 'docs/ai/PROJECT_MAP.md', 'docs/ai/SOURCE_INDEX.md', 'docs/ai/ARCHITECTURE.md', 'docs/ai/FEATURES.md', 'docs/ai/REFERENCES.md', 'docs/ai/WORK_ORDER.md', 'docs/ai/MODELS.md', '.ai-work/HANDOFF.md'].map(n => [n, lines(f(n))])),
      agents: { claude: ls(f('.claude/agents')), codex: ls(f('.codex/agents')), cursor: ls(f('.cursor/agents')), agy: ls(f('.agents/agents')) }, skills: ls(f('.claude/skills')), graph: fs.existsSync(f('graphify-out/GRAPH_REPORT.md')) };
    const map = read(f('docs/ai/PROJECT_MAP.md'));
    const arch = read(f('docs/ai/ARCHITECTURE.md'));
    const features = read(f('docs/ai/FEATURES.md'));
    const sourceIndex = read(f('docs/ai/SOURCE_INDEX.md'));
    const references = read(f('docs/ai/REFERENCES.md'));
    const purposes = [...map.matchAll(/^\| `[^`]+\/` \| \d+ \| [^|]* \|\s*([^|]*?)\s*\|$/gm)];
    r.repo.analysis = { folderPurposes: `${purposes.filter(m => m[1].trim()).length}/${purposes.length}`,
      sourceScan: /Scanned (\d+\/\d+) eligible/.exec(sourceIndex)?.[1] || 'missing',
      officialDocs: (references.match(/\| checked \|/g) || []).length,
      features: (features.match(/^\| (?!Feature|---)[^|]+\|/gm) || []).length,
      dataFlow: /## Data flow\r?\n- (?!\s*$|No flow verified)/m.test(arch) ? 'evidenced' : 'needs review',
      invariants: /## Critical invariants[^\n]*\r?\n- (?!\s*$|No critical invariant)/m.test(arch) ? 'documented' : 'needs review' };
    const pj = n => { try { return cfg.readJson(f(n)); } catch (_) { return {}; } };
    r.repo.mcp = { 'claude (.mcp.json)': Object.keys(pj('.mcp.json').mcpServers || {}), 'cursor (.cursor/mcp.json)': Object.keys(pj('.cursor/mcp.json').mcpServers || {}) };
    r.repo.hooks = cfg.listHooks(pj('.claude/settings.json')).map(h => h.event).concat(cfg.listHooks(pj('.claude/settings.local.json')).map(h => `${h.event} (local)`));
  }
  try { const t = require('./todo'); r.todo = t.open(t.items(ctx, dir || null)).map(i => ({ area: i.area, id: i.id, text: i.text, how: i.how })); } catch (_) { r.todo = []; }
  return r;
}
function render(r) {
  const NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', cursor: 'Cursor' };
  const out = [];
  const j = v => (Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v && typeof v === 'object' ? (Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${k}: ${x === null || x === undefined ? 'not set' : x}`).join(', ') : 'none') : v === null || v === undefined ? 'not set' : String(v));
  for (const [t, v] of Object.entries(r.tools)) {
    out.push(`[${NAMES[t]}] ${v.cli ? `CLI ${v.cli}` : 'CLI not found'} · config ${v.config}`);
    for (const [k, x] of Object.entries(v)) if (!['cli', 'config'].includes(k)) out.push(`  ${k.padEnd(18)} ${j(x)}`);
  }
  if (r.repo) { out.push(`[Repository] ${r.repo.dir}`); for (const [k, x] of Object.entries(r.repo.files)) out.push(`  ${k.padEnd(26)} ${x === null ? 'missing' : `${x} lines${['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(k) && x > 333 ? ' (over 333)' : ''}`}`); if (r.repo.files['AGENTS.md'] === null && r.repo.files['CLAUDE.md'] === null && r.repo.files['GEMINI.md'] === null) out.push(`  project setup              not initialized here; run askai init "${r.repo.dir}"`); else out.push(`  project analysis           ${r.repo.analysis.folderPurposes} folder purposes, ${r.repo.analysis.sourceScan} source scanned, ${r.repo.analysis.officialDocs} official docs, ${r.repo.analysis.features} features, data flow ${r.repo.analysis.dataFlow}, invariants ${r.repo.analysis.invariants}`); out.push(`  agents                     ${j(Object.fromEntries(Object.entries(r.repo.agents).map(([k, x]) => [k, x.length ? x.join(' ') : 'none'])))}`); out.push(`  skills                     ${j(r.repo.skills)}${r.repo.graph ? ' · knowledge graph present' : ''}`); }
  if (r.repo) { out.push(`  project MCP servers        ${Object.entries(r.repo.mcp).map(([k, v]) => `${k}: ${v.length ? v.join(' ') : 'none'}`).join(' · ')}`); out.push(`  project hooks              ${r.repo.hooks.length ? r.repo.hooks.join(', ') : 'none'}`); }
  if (r.plugins) { out.push('[Plugins and third-party tools]'); for (const p of r.plugins) out.push(`  ${p.name.slice(0, 26).padEnd(27)} ${p.state.padEnd(24)} ${p.state === 'not installed' || p.state === 'not configured' ? `add: ${p.add}` : `use: askai plugins info ${p.id}`}`); }
  if (r.todo && r.todo.length) { out.push(`[To do: ${r.todo.length} remaining step(s)]`); for (const i of r.todo.slice(0, 8)) out.push(`  [ ] ${i.area}: ${i.text}`); if (r.todo.length > 8) out.push('  ...'); out.push('  all of them, with how: askai todo'); }
  out.push('', 'Missing pieces: askai check (machine) and askai init <repo> (project). MCP switch: askai mcp. Token waste: askai audit. Evidence per tool: askai plugins.',
    'Project: --project NAME or -p NAME selects a registered project; askai set project NAME selects one for this terminal.',
    'Reachable (it answers inside the tool) is checked there: /mcp in Claude Code, Codex and Antigravity; Settings, MCP in Cursor.');
  return out.join('\n');
}
module.exports = { collect, render, mcpCalls };
