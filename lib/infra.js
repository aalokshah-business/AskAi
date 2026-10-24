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
// Cursor agent transcripts. Count a real tool call only. A prompt that lists the server is not a call.
function cursorCalls(ctx, days = 7) {
  const out = {};
  if (!ctx.cursorPaths) return out;
  const since = Date.now() - days * 86400000;
  for (const f of usage.walk(path.join(ctx.cursorPaths.home, 'projects'))) {
    let mtime; try { mtime = fs.statSync(f).mtimeMs; if (mtime < since) continue; } catch (_) { continue; }
    let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of t.split(/\r?\n/)) {
      if (!line.includes('"type":"tool_use"') || !line.includes('CallDynamicTool')) continue;
      const m = /"namespace"\s*:\s*"([^"]+)"/.exec(line);
      if (!m) continue;
      const k = m[1].toLowerCase();
      out[k] = (out[k] || 0) + 1;
    }
  }
  return out;
}
function callsFor(map, name) {
  const n = String(name || '').toLowerCase();
  if (!map || !n) return 0;
  let s = 0;
  for (const [k, v] of Object.entries(map)) if (k.toLowerCase().includes(n)) s += v;
  return s;
}
// working: a transcript shows a call. configured: the switch is on and no call was recorded.
function opLabel(tool, name, switchedOn, calls) {
  if (!switchedOn) return `${tool} off`;
  if (tool !== 'claude' && tool !== 'cursor') return `${tool} configured, no call log`;
  const n = callsFor(calls[tool], name);
  return n ? `${tool} working, ${n} call${n === 1 ? '' : 's'}/7d` : `${tool} configured, never called`;
}
function detectCaller(env = process.env) {
  if (!env) return null;
  if (env.ASKAI_HOST) {
    const h = env.ASKAI_HOST.toLowerCase();
    if (h.includes('agy') || h.includes('antigravity') || h.includes('gemini')) return 'Antigravity';
    if (h.includes('cursor')) return 'Cursor';
    if (h.includes('codex')) return 'Codex';
    if (h.includes('claude')) return 'Claude Code';
  }
  if (env.ANTIGRAVITY_AGENT || env.ANTIGRAVITY_APP_DATA_DIR || env.ANTIGRAVITY_PROJECT_ID || env.ANTIGRAVITY_CONVERSATION_ID || env.GEMINI_CLI || (env.PATH && /antigravity/i.test(env.PATH)) || (env.VSCODE_GIT_ASKPASS_NODE && /antigravity/i.test(env.VSCODE_GIT_ASKPASS_NODE))) {
    return 'Antigravity';
  }
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_SANDBOX || env.CODEX_CLI) {
    return 'Codex';
  }
  if (env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CONVERSATION_ID || env.CLAUDE_ENV_DIR || env.CLAUDE_CODE_SESSION_ID) {
    return 'Claude Code';
  }
  if (env.CURSOR_AGENT || env.CURSOR_VERSION || env.CURSOR_CHANNEL || env.TERM_PROGRAM === 'cursor' || (env.VSCODE_GIT_ASKPASS_NODE && /cursor/i.test(env.VSCODE_GIT_ASKPASS_NODE)) || (env.PATH && /cursor/i.test(env.PATH))) {
    return 'Cursor';
  }
  return null;
}
function collect(ctx, dir) {
  const r = { tools: {}, repo: null };
  const NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', cursor: 'Cursor' };
  r.caller = (ctx && ctx.opts && (ctx.opts.host || ctx.opts.tool))
    ? (NAMES[ctx.opts.host || ctx.opts.tool] || ctx.opts.host || ctx.opts.tool)
    : detectCaller((ctx && ctx.env) || process.env);
  let s = {}; try { s = cfg.readJson(ctx.paths.settings); } catch (_) { /* unreadable */ }
  const hooks = cfg.listHooks(s);
  const man = ctx.manifest || {};
  const servers = (() => { try { return mcp.list(ctx); } catch (_) { return []; } })();
  const calls = { claude: {}, cursor: {} };
  try { calls.claude = mcpCalls(ctx); } catch (_) { /* none */ }
  try { calls.cursor = cursorCalls(ctx); } catch (_) { /* none */ }
  const by = t => servers.filter(x => x.tool === t).map(x => `${x.name} (${opLabel(t, x.name, x.state === 'on', calls).replace(t + ' ', '')})`);
  const ver = b => { if (!b || (!path.isAbsolute(b) && (!ctx.which || !ctx.which(b)))) return null; const p = ctx.probe ? ctx.probe(b, ['--version'], { timeout: 5000 }) : null; return p && p.ok ? String(p.stdout).trim().split(/\r?\n/)[0].slice(0, 60) : 'installed'; };
  const prefs = models.load(ctx);
  const tiers = t => models.TIERS.map(k => { const p = models.pick(prefs, t, k); return `${k} ${p.model}/${p.effort}`; }).join(', ');
  r.tools.claude = { cli: ver((ctx.claudeBin && ctx.claudeBin()) || 'claude'), config: ctx.paths.home,
    settings: { model: s.model || null, effort: s.effortLevel || process.env.CLAUDE_CODE_EFFORT_LEVEL || null, autoCompactWindow: s.autoCompactWindow || null, subagentModel: (s.env || {}).CLAUDE_CODE_SUBAGENT_MODEL || null, denyRules: ((s.permissions || {}).deny || []).length, statusLine: s.statusLine ? 'set' : null },
    askaiBlock: (cfg.readText(ctx.paths.claudeMd) || '').includes(cfg.BEGIN.slice(0, 20)), rules: ls(ctx.paths.rules, /^askai-/), commands: ls(path.join(ctx.paths.home, 'commands'), /^askai/),
    hooks: hooks.map(h => `${h.event}${/askai\.js"? hook/.test(h.command) ? ' (askai reminder)' : /\brtk\b/.test(h.command) ? ' (rtk)' : ''}`), mcp: by('claude'),
    plugins: Object.entries(s.enabledPlugins || {}).filter(([, v]) => v !== false).map(([k]) => k), agents: ls(path.join(ctx.paths.home, 'agents'), /\.md$/), skills: ls(path.join(ctx.paths.home, 'skills')), tiers: tiers('claude') };
  r.tools.claude.mcpCallsLast7Days = calls.claude;
  try { const log = require('./audit').newestClaudeLog(ctx); if (log) r.tools.claude.subagentModels = require('./audit').parseClaude(log).subagents; } catch (_) { /* none */ }
  if (ctx.codexPaths) {
    const t = cfg.readText(ctx.codexPaths.config) || '';
    const cliPath = t.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const codexCli = ver('codex') || (cliPath && fs.existsSync(cliPath) ? ver(cliPath) : null);
    const codexPlugins = [...t.matchAll(/^\s*\[plugins\."?([^"\]]+)"?\]/gm)].map(m => m[1]);
    r.tools.codex = {
      cli: codexCli,
      config: ctx.codexPaths.home,
      keys: (t.match(/^(model_reasoning_effort|model_verbosity|personality|model)\s*=.*$/gm) || []),
      askaiBlock: /askai/i.test(cfg.readText(ctx.codexPaths.agentsMd) || ''),
      rules: ls(ctx.codexPaths.home, /^(AGENTS|RTK|askai-.*)\.md$/i),
      prompts: ls(path.join(ctx.codexPaths.home, 'prompts'), /^askai/),
      mcp: by('codex'),
      plugins: codexPlugins,
      agents: ls(path.join(ctx.codexPaths.home, 'agents'), /\.toml$/),
      skills: ls(path.join(ctx.codexPaths.home, 'skills'), /^[^.]/),
      tiers: tiers('codex'),
      modelsLast7Days: usage.codexModels(ctx.codexPaths.home, 7)
    };
  }
  if (ctx.agyPaths) {
    let a = {}; try { a = cfg.readJson(ctx.agyPaths.cliSettings); } catch (_) { /* none */ }
    const agySkills = ls(path.join(ctx.agyPaths.home, 'config', 'skills'))
      .concat(ls(path.join(ctx.agyPaths.home, 'antigravity-cli', 'skills')))
      .concat(ls(path.join(ctx.agyPaths.home, 'antigravity', 'builtin', 'skills')));
    r.tools.agy = {
      cli: ver('agy'),
      config: ctx.agyPaths.home,
      useG1Credits: a.useG1Credits,
      askaiBlock: /askai/i.test(cfg.readText(ctx.agyPaths.rulesMd) || ''),
      rules: ls(path.join(ctx.agyPaths.home, 'config', 'rules'), /^askai-/),
      commands: ls(path.join(ctx.agyPaths.home, 'config', 'commands'), /^askai/),
      mcp: by('agy'),
      agents: ls(path.join(ctx.agyPaths.home, 'config', 'agents')),
      skills: [...new Set(agySkills.filter(n => !n.startsWith('.')))],
      tiers: tiers('agy')
    };
  }
  if (ctx.cursorPaths) {
    const curHooks = (() => {
      try {
        const jh = cfg.readJson(ctx.cursorPaths.hooks);
        const list = [];
        for (const [ev, arr] of Object.entries((jh && jh.hooks) || {})) {
          for (const item of (Array.isArray(arr) ? arr : [])) {
            const cmd = item.command || '';
            list.push(`${ev}${/rtk/.test(cmd) ? ' (rtk)' : ''}`);
          }
        }
        return list;
      } catch (_) { return []; }
    })();
    const curSkills = ls(path.join(ctx.cursorPaths.home, 'skills'))
      .concat(ls(path.join(ctx.cursorPaths.home, 'skills-cursor')));
    const curBlock = (cfg.readText(path.join(ctx.cursorPaths.home, 'rules', 'askai-tokens.mdc')) || '').includes('askai:begin')
      || ls(path.join(ctx.cursorPaths.home, 'rules'), /^askai-/).length > 0;
    r.tools.cursor = {
      cli: ver('agent') || ver('cursor-agent'),
      desktop: ver('cursor'),
      config: ctx.cursorPaths.home,
      askaiBlock: curBlock,
      rules: ls(path.join(ctx.cursorPaths.home, 'rules'), /^askai-/),
      commands: ls(path.join(ctx.cursorPaths.home, 'commands'), /^askai/),
      hooks: curHooks,
      mcp: by('cursor'),
      agents: ls(path.join(ctx.cursorPaths.home, 'agents'), /\.md$/),
      skills: [...new Set(curSkills.filter(n => !n.startsWith('.')))],
      tiers: tiers('cursor'),
      mcpCallsLast7Days: calls.cursor
    };
  }
  r.manifestComponents = Object.keys((man && man.components) || {}).length;
  // Every plugin and third-party tool AskAI knows, and its state here: per tool for MCP servers, on PATH for CLIs.
  const plug = require('./plugins'); const ep = s.enabledPlugins || {};
  r.plugins = plug.P.filter(p => p.det.bin || p.det.mcp || p.det.plugin).map(p => {
    const d = p.det; let state;
    const rows = d.mcp ? servers.filter(x => x.name.toLowerCase().includes(d.mcp)) : [];
    const enabled = d.plugin && Object.keys(ep).some(k => k.startsWith(d.plugin) && ep[k] !== false);
    if (rows.length || enabled) {
      const seen = new Map();
      if (enabled) seen.set('claude', true);
      for (const x of rows) seen.set(x.tool, x.state === 'on');
      state = [...seen].map(([t, on]) => opLabel(t, d.mcp, on, calls)).join(', ');
    }
    else if (d.mcp && !d.bin) state = 'not configured';
    else if (d.plugin) state = enabled ? 'enabled (Claude Code)' : 'not installed';
    else if (d.bin) {
      if (!ctx.which || !ctx.which(d.bin)) state = 'not installed';
      else {
        const binPath = ctx.which(d.bin);
        const pr = ctx.probe ? ctx.probe(binPath, ['--version'], { timeout: 3000 }) : null;
        if (pr && !pr.ok && /trampoline/i.test(`${pr.stdout}\n${pr.stderr}`)) {
          state = 'broken uv stub (run askai install --only ' + p.id + ' --force)';
        } else {
          state = 'on PATH';
        }
      }
    }
    if (p.id === 'graphify' && state === 'on PATH' && dir) state = fs.existsSync(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md')) ? 'on PATH, graph built' : 'on PATH, graph not built';
    if (p.id === 'rtk' && state === 'on PATH') {
      let claudeRtk = false; let cursorRtk = false;
      try { claudeRtk = require('./components').rtkHooked(ctx); } catch (_) { /* settings unreadable */ }
      try { cursorRtk = require('./cursor').rtkHooked(ctx); } catch (_) { /* no Cursor hooks file */ }
      const hooks = [claudeRtk && 'Claude Code', cursorRtk && 'Cursor'].filter(Boolean);
      state = hooks.length ? `on PATH, hook on ${hooks.join(' and ')}` : 'on PATH, hook not registered';
    }
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
  const hasRules = Object.values(r.tools).some(t => t.rules && t.rules.length);
  const hasSettings = Object.values(r.tools).some(t => t.config);
  const hasBlock = Object.values(r.tools).some(t => t.askaiBlock);
  const hasIgnore = r.repo ? r.repo.files['.cursorignore'] != null : false;
  const hasPack = r.repo ? r.repo.files['AGENTS.md'] != null : false;
  const hasBaseTools = !!(ctx.which && ctx.which('rg'));
  const hasLsp = (s.enabledPlugins && Object.keys(s.enabledPlugins).some(k => k.includes('lsp'))) || false;
  const hasMarkItDown = !!(ctx.which && ctx.which('markitdown'));
  const hasStatusline = !!s.statusLine;
  const optPlugins = (r.plugins || []).filter(p => p.state && !p.state.startsWith('not ') && !p.state.startsWith('broken'));
  r.assets = {
    required: [
      { name: 'rules', ok: hasRules },
      { name: 'settings', ok: hasSettings },
      { name: 'terse block', ok: hasBlock },
      { name: 'ignore file', ok: hasIgnore },
      { name: 'project pack', ok: hasPack },
    ],
    recommended: [
      { name: 'base-tools', ok: hasBaseTools },
      { name: 'language intelligence', ok: hasLsp },
      { name: 'MarkItDown', ok: hasMarkItDown },
      { name: 'statusline', ok: hasStatusline },
    ],
    optional: optPlugins.map(p => p.id),
  };
  return r;
}
function render(r) {
  const NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', cursor: 'Cursor' };
  const out = [];
  const name = r.repo && r.repo.dir ? require('path').basename(r.repo.dir) : 'this folder';
  const caller = r.caller || detectCaller();
  out.push(caller ? `AskAI · ${name} · ${caller}` : `AskAI · ${name}`);
  const req = (r.assets && r.assets.required) || [];
  const reqOk = req.filter(i => i.ok).length;
  const reqMissing = req.filter(i => !i.ok).map(i => i.name);
  const reqStr = req.length
    ? (reqOk === req.length ? `${reqOk}/${req.length} installed · ${req.map(i => i.name).join(', ')}` : `${reqOk}/${req.length} installed (missing: ${reqMissing.join(', ')})`)
    : 'rules, settings, terse block, ignore file, project pack';
  out.push(`Required      ${reqStr}`);

  const rec = (r.assets && r.assets.recommended) || [];
  const recOk = rec.filter(i => i.ok).length;
  const recMissing = rec.filter(i => !i.ok).map(i => i.name);
  const recStr = rec.length
    ? (recOk === rec.length ? `${recOk}/${rec.length} installed · ${rec.map(i => i.name).join(', ')}` : `${recOk}/${rec.length} installed (missing: ${recMissing.join(', ')})`)
    : 'base-tools, language intelligence, MarkItDown, statusline';
  out.push(`Recommended   ${recStr}`);

  const opt = (r.assets && r.assets.optional) || [];
  const optStr = opt.length
    ? `${opt.length} installed · ${opt.join(', ')}`
    : '0 unless askai install --add (not in profile lean)';
  out.push(`Optional      ${optStr}`);
  out.push('Token levers  terse rule, smallest change, short output, ignore file, small router, cheap model, few MCP servers, handoff, rg');
  out.push('');
  const j = v => (Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v && typeof v === 'object' ? (Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${k}: ${x === null || x === undefined ? 'not set' : x}`).join(', ') : 'none') : v === null || v === undefined ? 'not set' : String(v));
  for (const [t, v] of Object.entries(r.tools)) {
    let hostLabel;
    if (v.cli) hostLabel = `CLI ${v.cli}`;
    else if (t === 'cursor') hostLabel = (v.desktop || v.config) ? 'Desktop IDE present; CLI tool agent not on PATH' : 'CLI not found';
    else if (t === 'codex') hostLabel = v.config ? 'Standalone codex CLI not on PATH; configuration folder found' : 'CLI not found';
    else if (t === 'agy') hostLabel = v.config ? 'Desktop IDE present; CLI tool agy not on PATH' : 'CLI not found';
    else hostLabel = 'CLI not found';
    out.push(`[${NAMES[t]}] ${hostLabel} · config ${v.config}`);
    for (const [k, x] of Object.entries(v)) if (!['cli', 'config', 'desktop'].includes(k)) out.push(`  ${k.padEnd(18)} ${j(x)}`);
    out.push('');
  }
  if (r.repo) { out.push(`[Repository] ${r.repo.dir}`); for (const [k, x] of Object.entries(r.repo.files)) out.push(`  ${k.padEnd(26)} ${x === null ? 'missing' : `${x} lines${['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(k) && x > 333 ? ' (over 333)' : ''}`}`); if (r.repo.files['AGENTS.md'] === null && r.repo.files['CLAUDE.md'] === null && r.repo.files['GEMINI.md'] === null) out.push(`  project setup              not initialized here; run askai init "${r.repo.dir}"`); else out.push(`  project analysis           ${r.repo.analysis.folderPurposes} folder purposes, ${r.repo.analysis.sourceScan} source scanned, ${r.repo.analysis.officialDocs} official docs, ${r.repo.analysis.features} features, data flow ${r.repo.analysis.dataFlow}, invariants ${r.repo.analysis.invariants}`); out.push(`  agents                     ${j(Object.fromEntries(Object.entries(r.repo.agents).map(([k, x]) => [k, x.length ? x.join(' ') : 'none'])))}`); out.push(`  skills                     ${j(r.repo.skills)}${r.repo.graph ? ' · knowledge graph present' : ''}`); }
  if (r.repo) { out.push(`  project MCP servers        ${Object.entries(r.repo.mcp).map(([k, v]) => `${k}: ${v.length ? v.join(' ') : 'none'}`).join(' · ')}`); out.push(`  project hooks              ${r.repo.hooks.length ? r.repo.hooks.join(', ') : 'none'}`); out.push(''); }
  out.push('Missing pieces: askai check (machine) and askai init <repo> (project). MCP switch: askai mcp. Token waste: askai audit. Evidence per tool: askai plugins.',
    'Project: --project NAME or -p NAME selects a registered project; askai set project NAME selects one for this terminal.',
    'working means a transcript call in the last 7 days. configured means the switch is on and no call was recorded. A configured server does not read each prompt. /askai-plugins (or askai plugins ready) says when the agent should call it and finishes one-time setup. Codex and Antigravity have no local call log.');
  return out.join('\n');
}
module.exports = { collect, render, mcpCalls, cursorCalls, opLabel, detectCaller };
