'use strict';
// askai plugins [list | info ID | install ID]: every token tool researched, with the evidence, what runs on its own after setup
// versus what you run, and whether it is installed, configured and used here. Installs only what has a verified command; the rest
// map to an AskAI component or print the vendor's own steps.
const fs = require('fs');
const path = require('path');
const mcp = require('./mcp');

const P = [
  ['serena', 'Serena', 'MCP code navigation', 'measured: none independent. For C/C++ it needs compile_commands.json at the repo root. Serena downloads and manages clangd. Relative paths are rewritten into .serena/compile_commands.json. It reads the database at startup; files created after startup are not indexed until opened or the server restarts.', 'The agent calls its symbol tools when the MCP server is connected', 'Nothing; index a large repo once: serena project index', { component: 'serena' }, { bin: 'serena', mcp: 'serena' }],
  ['context7', 'Context7', 'MCP library docs', 'measured: none; fetches current docs instead of guessing', 'The agent calls it for library documentation', 'Ask for "current docs of <library>"', { component: 'context7', flag: '--context7' }, { mcp: 'context7' }],
  ['markitdown', 'MarkItDown', 'document converter (local CLI)', 'mechanism: text instead of binary documents', 'Nothing runs on its own', 'askai convert <file|url>', { component: 'markitdown' }, { bin: 'markitdown' }],
  ['ccusage', 'ccusage', 'usage reports', 'reports only', 'Nothing', 'ccusage daily, ccusage blocks --live, askai savings', { component: 'ccusage' }, { bin: 'ccusage' }],
  ['repomix', 'Repomix', 'repository snapshot', 'measured: none; snapshots are large, use only for handovers between tools', 'Nothing', 'repomix --compress --include "src/**" (narrow it)', { component: 'repomix', flag: '--repomix', npm: 'repomix' }, { bin: 'repomix' }],
  ['graphify', 'Graphify', 'knowledge graph of the code (skill + CLI)', 'claims 71.5x fewer tokens per query; one independent test found ~0% when the agent ignored it; graphify update . spends no tokens; /graphify . spends tokens', 'After graphify install: a rule and a hook point the agent at graphify-out/GRAPH_REPORT.md. AskAI turns the Cursor rule off for ordinary turns.', 'graphify update . once per project; graphify query "<question>"', { component: 'graphify', flag: '--graphify' }, { bin: 'graphify' }],
  ['caveman', 'Caveman', 'terse replies', 'median -8% cost, six studies', 'AskAI writes the terse block in every tool', 'Nothing (/caveman lite|full|ultra with the plugin)', { component: 'caveman', optional: 'caveman-plugin' }, { askai: 'caveman' }],
  ['base-tools', 'ripgrep, jq, gh', 'command-line search and inspection', 'mechanism: targeted search instead of whole-file reads; gh instead of a GitHub MCP server', 'Agents call them through the shell', 'Nothing', { component: 'base-tools', flag: '--base-tools' }, { bin: 'rg' }],
  ['karpathy', 'Karpathy guidelines', 'behaviour rules (think first, simplicity, surgical changes, verify)', 'no independent measurement; overlaps Ponytail', 'AskAI writes the build-lean rule with the same intent', 'Nothing', { manual: 'claude plugin marketplace add forrestchang/andrej-karpathy-skills && claude plugin install andrej-karpathy-skills@karpathy-skills (only if you want the full skill as well)' }, { plugin: 'andrej-karpathy-skills' }],
  ['codebase-memory', 'codebase-memory-mcp', 'code knowledge-graph MCP server (index once, query symbols and call paths)', 'vendor claims 99% fewer tokens; no independent measurement; overlaps Serena and Graphify', 'askai init indexes each repository with it; the agent queries the graph', '17 more MCP tool definitions per session; pick one code-navigation tool', { component: 'codebase-memory', flag: '--codebase-memory' }, { mcp: 'codebase-memory', bin: 'codebase-memory-mcp' }],
  ['sigmap', 'SigMap', 'ranks relevant files before reading', 'no package or source could be verified (October 2026)', '-', 'Nothing installed', { manual: 'not installed: no verifiable package; Serena, LSP and askai map cover file targeting' }, {}],
  ['litellm', 'LiteLLM', 'API gateway, routing and spend tracking', 'not for subscriptions: it needs API keys and bills per token', 'For your own API applications only', 'Moves you to API billing', { manual: 'not installed: subscription plans cannot be routed through it' }, { bin: 'litellm' }],
  ['openrouter', 'OpenRouter', 'many models behind one API', 'not for subscriptions: API keys and per-token billing', 'For your own API applications only', 'Moves you to API billing; code goes to a third party', { manual: 'not installed: subscription plans cannot use it' }, {}],
  ['ponytail', 'Ponytail', 'smallest-change rule', '-10.3% cost (JetBrains)', 'AskAI writes the build-lean rule in every tool', 'Nothing', { rule: true }, { askai: 'rules' }],
  ['lsp', 'Claude Code LSP plugins', 'code intelligence', '-13% cost (Marmelab)', 'Claude navigates by symbol', 'Nothing', { component: 'code-intel', flag: '--lsp ts,py' }, { askai: 'code-intel' }],
  ['rtk', 'RTK', 'shell output filter', 'median +7% cost, six studies', 'Hook rewrites shell commands', 'rtk gain (its own counter overstates savings)', { component: 'rtk', flag: '--rtk' }, { bin: 'rtk' }],
  ['context-mode', 'Context Mode', 'output sandbox (MCP)', '+33% to +72% cost (one study)', 'Agent uses its tools when told to', 'Nothing', { component: 'context-mode', flag: '--context-mode' }, { mcp: 'context-mode', plugin: 'context-mode' }],
  ['headroom', 'Headroom', 'compression proxy / MCP', 'median +32% cost, four studies; proxy mode can switch Claude Code to API billing', 'Proxy mode: every request goes through it', 'The agent calls headroom_compress on large outputs; headroom_stats shows savings; check /status stays on your plan', { component: 'headroom', flag: '--headroom', note: 'MCP mode only. Proxy mode stays manual (headroom wrap claude, or headroom proxy + ANTHROPIC_BASE_URL): it can move Claude Code to API billing' }, { mcp: 'headroom', bin: 'headroom' }],
  ['claude-mem', 'claude-mem', 'session memory (plugin, hooks)', 'none independent', 'Hooks store and inject memories', 'Not recommended alongside the handoff file; one memory tool at most', { component: 'claude-mem', flag: '--claude-mem', manual: 'see the claude-mem README (Claude Code plugin marketplace)' }, { plugin: 'claude-mem' }],
  ['supermemory', 'Supermemory', 'memory MCP / API', 'none independent; hosted service', 'The agent calls its memory tools', 'Off until privacy and value are proven', { manual: 'see supermemory.ai docs (MCP server URL)' }, { mcp: 'supermemory' }],
  ['aider', 'Aider', 'separate coding agent with repo map', 'not a plugin; separate sessions', 'Nothing inside the four tools', 'aider; /add, /ask, /architect, /clear (never on the same files as another agent)', { manual: 'python -m pip install aider-install && aider-install' }, { bin: 'aider' }],
  ['graftcode', 'Graftcode rules', 'project rules for Graftcode apps', 'none; avoids generating REST boilerplate in Graftcode projects', 'A CLAUDE.md router plus per-language rules read on demand', 'Only in projects that use Graftcode', { manual: 'git clone --depth 1 https://github.com/grft-dev/graftcode-demos /tmp/g && copy rules/Claude/.claude/rules into the project (merge, do not replace CLAUDE.md)' }, { file: '.claude/rules' }],
  ['superclaude', 'SuperClaude', 'framework (--uc mode)', 'claims 30-50%; loads thousands of tokens of instructions', '-', 'Not installed', { manual: 'not recommended' }, {}],
  ['mcp-compressor', 'mcp2cli / MCP compressors', 'MCP schema trimming', 'none independent', 'Wraps MCP servers', 'Only with many MCP servers; askai mcp off is simpler', { manual: 'see the project README' }, {}],
  ['lean-ctx', 'lean-ctx / LeanCTX', 'context cache', '+10.3% cost (THOL)', '-', 'Not recommended', { manual: 'not recommended' }, { bin: 'lean-ctx' }],
  ['tokenade', 'Tokenade, snip, tokf', 'output compressors', 'none independent', '-', 'Not recommended', { manual: 'not recommended' }, {}],
  ['codegraph', 'CodeGraph, Graft', 'code indexes', 'CodeGraph -7.6% (THOL); others none', 'Agent queries the index', 'Optional for very large repos', { manual: 'see each README' }, {}],
  ['llmlingua', 'LLMLingua', 'prompt compression library', 'research; not wired into the four CLIs', '-', 'For your own API apps, not subscriptions', { manual: 'pip install llmlingua' }, {}],
  ['routers', '9Router, claude-code-router', 'API routers and gateways', 'API billing; a subscription does not transfer', 'Every request goes through them', 'Not for subscription use', { manual: 'not recommended on a subscription' }, {}],
  ['monitors', 'ccstatusline, claude-hud, Token Monitor, tokenlens', 'status lines, dashboards, budget guards', 'reports only', 'Show usage', 'One status line is enough (AskAI installs its own)', { manual: 'optional' }, {}],
].map(([id, name, kind, evidence, auto, daily, how, det]) => ({ id, name, kind, evidence, auto, daily, how, det }));

const which = (ctx, b) => (ctx.which ? ctx.which(b) : null);
function state(ctx, p, servers, enabledPlugins) {
  const d = p.det; const installed = d.bin ? !!which(ctx, d.bin) : d.mcp ? servers.some(s => s.name.toLowerCase().includes(d.mcp)) : d.plugin ? Object.keys(enabledPlugins).some(k => k.startsWith(d.plugin)) : null;
  const configured = d.mcp ? servers.filter(s => s.name.toLowerCase().includes(d.mcp)).map(s => `${s.tool}:${s.state}`).join(' ') || 'no' : null;
  return { installed, configured };
}
function judge(p, installed) {
  const ev = p.evidence || '';
  const costs = /\+\d+(\.\d+)?%|not recommended|not for subscription/i.test(ev);
  const helps = /-\d+(\.\d+)?%/.test(ev) && !costs;
  let verdict = 'unknown';
  if (costs) verdict = 'costs more';
  else if (helps) verdict = 'helps';
  else if (/mechanism|reports only|measured: none|no independent/i.test(ev)) verdict = 'neutral';
  let rec = 'leave off';
  if (verdict === 'helps') rec = installed ? 'keep' : 'add';
  else if (verdict === 'costs more') rec = installed ? 'remove' : 'leave off';
  else if (installed && verdict === 'neutral') rec = 'keep';
  if (p.id === 'rtk' || p.id === 'headroom' || p.id === 'context-mode') rec = installed ? 'remove' : 'leave off';
  if (p.id === 'headroom' && installed) rec = 'remove';
  return { verdict, rec };
}
function list(ctx, print = console.log) {
  let servers = []; try { servers = mcp.list(ctx); } catch (_) { /* none */ }
  let ep = {}; try { ep = require('./claude-config').readJson(ctx.paths.settings).enabledPlugins || {}; } catch (_) { /* none */ }
  print('id  hosts  state  verdict  recommendation');
  for (const p of P) {
    const s = state(ctx, p, servers, ep);
    const hosts = [p.det.mcp && 'mcp', p.det.bin && 'cli', p.det.plugin && 'plugin', p.det.askai && 'askai'].filter(Boolean).join(',') || '-';
    const st = s.installed === null ? '-' : s.installed ? 'installed' : 'off';
    const j = judge(p, s.installed === true);
    print(`${p.id}  ${hosts}  ${st}  ${j.verdict}  ${j.rec}`);
  }
  return 0;
}
function info(id, print = console.log) {
  const p = P.find(x => x.id === id); if (!p) { print(`unknown plugin "${id}": ${P.map(x => x.id).join(', ')}`); return 1; }
  const how = p.how.component ? `askai install --only ${p.how.component}${p.how.flag ? ` (or ${p.how.flag})` : ''}${p.how.optional ? `; plugin: askai install --only ${p.how.optional}` : ''}` : p.how.rule ? 'already written by askai install (rules)' : p.how.context7 ? 'askai plugins install context7' : p.how.npm ? `askai plugins install ${p.id} (npm i -g ${p.how.npm})` : p.how.graphify ? 'askai plugins install graphify (uv tool install graphifyy, then graphify install per tool)' : p.how.manual;
  print([`${p.name}: ${p.kind}`, `  Evidence:    ${p.evidence}`, `  After setup: ${p.auto}`, `  While working: ${p.daily}`, `  Install:     ${how}`].join('\n'));
  return 0;
}
// Verified installs only. Each step is shown first; --dry-run shows without running.
function install(ctx, id, o = {}, print = console.log) {
  const steps = [];
  if (id === 'context7') {
    const def = { command: 'npx', args: ['-y', '@upstash/context7-mcp'] };
    if (which(ctx, 'claude')) steps.push(['claude', ['mcp', 'add', '--scope', 'user', 'context7', '--', 'npx', '-y', '@upstash/context7-mcp']]);
    if (which(ctx, 'codex')) steps.push(['codex', ['mcp', 'add', 'context7', '--', 'npx', '-y', '@upstash/context7-mcp']]);
    for (const f of [ctx.cursorPaths && ctx.cursorPaths.mcp, ctx.agyPaths && ctx.agyPaths.mcp].filter(Boolean)) {
      print(`  ${o.dry ? 'would add' : 'add'} context7 to ${f}`);
      if (!o.dry) { let j = {}; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* new */ } j.mcpServers = j.mcpServers || {}; if (!j.mcpServers.context7) { if (ctx.backup) ctx.backup(f); j.mcpServers.context7 = def; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); } }
    }
  } else if (id === 'repomix') steps.push(['npm', ['install', '-g', 'repomix']]);
  else if (id === 'graphify') {
    if (!which(ctx, 'graphify')) steps.push(which(ctx, 'uv') ? ['uv', ['tool', 'install', 'graphifyy']] : ['pipx', ['install', 'graphifyy']]);
    for (const [t, pl] of [['claude', 'claude'], ['codex', 'codex'], ['cursor', 'cursor'], ['agy', 'antigravity']]) if (t === 'claude' || (ctx.hostSel && ctx.hostSel[t])) steps.push(['graphify', ['install', '--platform', pl]]);
  } else { const p = P.find(x => x.id === id); print(p ? `No automatic install for ${p.name}. ${p.how.component ? `Use: askai install --only ${p.how.component}` : p.how.manual}` : `unknown plugin "${id}"`); return p ? 0 : 1; }
  for (const [cmd, args] of steps) {
    print(`  ${o.dry ? 'would run' : 'run'}: ${cmd} ${args.join(' ')}`);
    if (!o.dry) { const r = require('child_process').spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }); if (r.status !== 0) { print(`  failed: ${cmd} exited ${r.status}`); return 1; } }
  }
  print(o.dry ? 'Dry run: nothing changed.' : `Done. Check it is used: askai infra (calls per MCP server), and remove it if it does not pay off.`);
  return 0;
}
// Where each tool stands in AskAI: installed by default, in the max profile, one flag away, or not installed (with the reason).
function decision(p) {
  const prof = require('./profiles'); const c = p.how && p.how.component;
  const inProfiles = c ? prof.names().filter(n => prof.get(n).components.includes(c)) : [];
  const note = p.how && p.how.note ? `; ${p.how.note}` : '';
  if (p.id === 'caveman') return { decision: 'default (rules)', why: `${p.evidence}; the Caveman plugin itself is in max (--caveman-plugin)` };
  if (p.id === 'ponytail' || p.id === 'karpathy') return { decision: 'default (rules)', why: `${p.evidence}; AskAI writes the build-lean rule into every tool` };
  if (inProfiles.includes('coding')) return { decision: 'default', why: p.evidence + note };
  if (p.id === 'lsp') return { decision: 'max, or --lsp ts,py', why: p.evidence };
  if (inProfiles.length) return { decision: `${inProfiles.join(', ')}; or ${p.how.flag || '--' + c}`, why: p.evidence + note };
  if (c) return { decision: `one flag: ${p.how.flag || '--' + c}`, why: `not in max: ${p.daily}` };
  if (p.how && (p.how.context7 || p.how.npm || p.how.graphify)) return { decision: `askai plugins install ${p.id}`, why: p.evidence };
  const m = p.how && p.how.manual; if (m && /^not installed: /.test(m)) return { decision: 'not installed', why: m.replace(/^not installed: /, '') };
  return { decision: 'not installed', why: `${p.evidence}${m && !/^(not recommended|optional|see )/.test(m) ? `; to try it yourself: ${m}` : ''}` };
}
function decisions() {
  const rows = P.map(p => ({ id: p.id, name: p.name, ...decision(p) }));
  const w = Math.max(...rows.map(r => r.name.length)), d = Math.max(...rows.map(r => r.decision.length));
  return ['Every tool AskAI evaluated, and where it stands (reasons from the research; askai plugins info <id> for details)', '',
    ...rows.map(r => `  ${r.name.padEnd(w)}  ${r.decision.padEnd(d)}  ${r.why}`)].join('\n');
}
module.exports = { decision, decisions, P, list, info, install, judge };
