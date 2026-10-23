'use strict';
// How to use each plugin AskAI knows: its terminal commands, its commands or tools inside the agent, how to check it works,
// where to see what it saves, and how to switch it off. Shown by `askai plugins info <id>`; `askai savings` runs the terminal
// reports; `askai infra` points at them. Keyed by the ids in lib/plugins.js.
const U = {
  serena: { terminal: [['serena project index', 'index the current project once (askai init runs it when Serena is installed)']],
    agent: [['activate_project', 'once per session, before the other Serena tools'], ['get_symbols_overview, find_symbol, find_referencing_symbols', 'read a symbol instead of a whole file']],
    check: '/mcp in Claude Code, Codex and Antigravity lists serena as connected; Cursor: Settings, MCP', savings: 'Serena reports none; compare askai savings 7 with an earlier week', off: 'askai uninstall --only serena,codex-serena,agy-serena,cursor-serena' },
  context7: { agent: [['"use context7" or "current docs for <library>"', 'the agent looks the library up and fetches only those docs']],
    check: '/mcp lists context7 (Cursor: Settings, MCP); askai infra shows it per tool', savings: 'none reported: it prevents wrong guesses about APIs rather than saving tokens per call', off: 'askai uninstall --only context7' },
  markitdown: { terminal: [['markitdown file.pdf -o file.md', 'convert once, then give the agent the .md'], ['askai convert <file or YouTube URL>', 'the same through AskAI, including YouTube transcripts']],
    check: 'markitdown --version', savings: 'compare the size of the .md with the original file', off: 'askai uninstall --only markitdown --tools' },
  ccusage: { terminal: [['ccusage daily', 'Claude Code usage per day'], ['ccusage monthly', 'per month'], ['ccusage session', 'per session'], ['ccusage blocks --live', 'the current usage window, live']],
    check: 'ccusage --version', savings: 'askai savings runs it for you', off: 'askai uninstall --only ccusage --tools' },
  repomix: { terminal: [['repomix --compress --include "src/**"', 'a compact snapshot of chosen folders (repomix-output.xml)'], ['repomix --style markdown', 'the snapshot as Markdown']],
    check: 'repomix --version', savings: 'for handovers between tools only: a snapshot is large, so give the agent one only when it needs the whole picture', off: 'askai uninstall --only repomix --tools' },
  graphify: { terminal: [['graphify query "<question>"', 'answer a question from the graph without reading files'], ['graphify path <A> <B>', 'how two parts of the code connect'], ['graphify explain <name>', 'one node and its neighbours']],
    agent: [['graphify update .', 'build the graph once from source; spends no tokens'], ['/graphify .', 'also read docs and images; spends tokens and needs the Graphify skill']],
    check: 'graphify-out/GRAPH_REPORT.md exists in the repository (askai todo checks it)', savings: 'askai savings shows whether the graph is built; compare askai savings 7', off: 'askai uninstall --only graphify; its own rules and hook stay until you remove them with graphify\'s commands' },
  caveman: { terminal: [['askai install --caveman lite|full|ultra|off', 'change the reply-length rule in all four tools']],
    agent: [['/caveman lite|full|ultra', 'reply length (Caveman plugin, in max)'], ['/caveman-stats', 'what the plugin estimates it saved']],
    check: 'CLAUDE.md, AGENTS.md and GEMINI.md contain the "Terse output (caveman" block', savings: 'median -8% cost in six studies; /caveman-stats with the plugin', off: 'askai install --caveman off; the plugin: askai uninstall --only caveman-plugin' },
  'base-tools': { terminal: [['rg -n "<pattern>" src', 'find lines instead of reading files'], ['jq ".key" file.json', 'one value from a large JSON file'], ['gh pr view, gh issue list', 'GitHub without an MCP server']],
    check: 'rg --version, jq --version, gh --version', savings: 'nothing to report: the agent reads less', off: 'askai uninstall --only base-tools --tools' },
  karpathy: { agent: [['(always on)', 'the build-lean rule: think first, smallest change, verify']], check: 'the "Build the smallest change" line in CLAUDE.md and AGENTS.md', savings: 'no independent measurement', off: 'the rule is part of the AskAI block; the full plugin is manual (askai plugins decisions)' },
  ponytail: { agent: [['(always on)', 'the build-lean rule in every tool']], check: 'the "Build the smallest change" line in CLAUDE.md and AGENTS.md', savings: '-10.3% cost (JetBrains)', off: 'part of the AskAI block' },
  lsp: { terminal: [['askai install --lsp ts,py', 'add languages: ts, py, kotlin, ruby, swift']], agent: [['(automatic)', 'Claude Code jumps to definitions and references instead of reading files']],
    check: '/plugin in Claude Code lists the LSP plugins', savings: '-13% cost (Marmelab)', off: 'askai uninstall --only code-intel' },
  rtk: { terminal: [['rtk gain', 'what RTK estimates it saved (its counter overstates: compare askai savings 7)'], ['rtk init -g --show', 'where its hooks are registered']], agent: [['(automatic)', 'shell output is shortened before the agent reads it']],
    check: 'rtk gain counts commands after a session', savings: 'askai savings runs rtk gain', off: 'askai uninstall --only rtk,cursor-rtk,codex-rtk,agy-rtk' },
  'context-mode': { agent: [['/context-mode:ctx-stats', 'what it kept out of the context this session'], ['ctx_execute, ctx_batch_execute', 'the agent runs long output through these']],
    check: '/plugin lists context-mode in Claude Code; Cursor: Settings, MCP', savings: '/context-mode:ctx-stats inside Claude Code', off: 'askai uninstall --only context-mode,cursor-context-mode' },
  headroom: { terminal: [['headroom perf', 'savings and performance summary'], ['headroom doctor', 'health check']],
    agent: [['headroom_compress', 'the agent compresses a large output'], ['headroom_retrieve', 'gets the original back when it needs it'], ['headroom_stats', 'savings in this session']],
    check: '/mcp lists headroom (Cursor: Settings, MCP); askai infra shows it per tool', savings: 'askai savings runs headroom perf; inside a session ask for headroom_stats', off: 'askai uninstall --only headroom',
    warn: 'Do not run headroom wrap or headroom proxy (they route your plan through a proxy and can switch Claude Code to API billing), or headroom learn (it edits CLAUDE.md and AGENTS.md).' },
  'claude-mem': { terminal: [['npx claude-mem repair', 'repair the worker or the hooks']], agent: [['(automatic)', 'memories from earlier sessions are added when a session starts'], ['its memory search tools', 'the agent searches past sessions']],
    check: '/plugin lists claude-mem; ~/.claude-mem/logs/worker-<date>.log is written', savings: 'none reported; it spends your plan to summarise sessions', off: 'askai uninstall --only claude-mem' },
  'codebase-memory': { terminal: [["codebase-memory-mcp cli list_projects '{}'", 'indexed projects and their sizes'], ["codebase-memory-mcp cli index_repository '{\"repo_path\": \"<dir>\"}'", 'index a repository (askai init does it)'], ['codebase-memory-mcp --ui=true --port=9749', 'the graph in your browser'], ['codebase-memory-mcp config list', 'its settings']],
    agent: [['search_graph and its trace and architecture tools', 'symbols, call paths and impact instead of reading files']],
    check: '/mcp lists codebase-memory-mcp; askai infra shows it per tool', savings: 'askai savings lists the indexed projects', off: 'askai uninstall --only codebase-memory' },
};
const NOT = 'Not installed by AskAI; askai plugins decisions shows why. If you try it yourself, askai infra will still list it when it is on your PATH or in an MCP config.';
const get = id => U[id] || null;
function render(id) {
  const u = U[id]; if (!u) return NOT;
  const out = []; const sec = (t, rows) => { if (rows && rows.length) { out.push(t); for (const [c, w] of rows) out.push(`  ${c}\n      ${w}`); } };
  sec('In a terminal:', u.terminal); sec('Inside the agent:', u.agent);
  out.push(`Check it works: ${u.check}`, `What it saves: ${u.savings}`, `Switch it off: ${u.off}`); if (u.warn) out.push(`Careful: ${u.warn}`);
  return out.join('\n');
}
module.exports = { U, get, render, NOT };
