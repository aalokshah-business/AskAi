'use strict';
// askai ask: the guide's etiquette and research as an offline knowledge base. Each entry: the rule, why (with its source), how
// in each tool, and the askai command that automates it, if any. Topics live in knowledge/*.yaml. Search is plain keyword scoring: no model, no network.
const path = require('path');
const knowledge = require('./knowledge');
const KB = knowledge.loadAll(path.join(__dirname, '..', 'knowledge'));

const GROUP_OF = Object.fromEntries([
  ['Session', ['clear', 'compact', 'break', 'resume', 'reuse', 'long-chat', 'project-files', 'peak', 'limit']],
  ['Prompts', ['one-prompt', 'edit-regenerate', 'files', 'plan', 'verify', 'questions', 'stop-early', 'paste', 'reads', 'smallest', 'terse']],
  ['Models', ['model-claude', 'model-codex', 'model-agy', 'model-cursor', 'effort', 'advisor', 'speed-modes', 'subagents']],
  ['Cost', ['billing', 'rtk', 'context-mode', 'headroom', 'proxies', 'mcp', 'documents', 'instruction-files', 'lsp']],
].flatMap(([name, ids]) => ids.map(id => [id, name])));
function topics() {
  const g = new Map();
  for (const e of KB) { const name = GROUP_OF[e.id] || 'Also'; if (!g.has(name)) g.set(name, []); g.get(name).push(e.id); }
  const lines = [];
  for (const [name, ids] of g) {
    lines.push(`${name}:`);
    for (let i = 0; i < ids.length; i += 4) lines.push('  ' + ids.slice(i, i + 4).join('  '));
  }
  return lines.join('\n');
}
const words = s => String(s || '').toLowerCase().split(/[^a-z0-9%@.]+/).filter(w => w.length > 1);
function search(query, limit = 3) {
  const q = words(query);
  if (!q.length) return [];
  const scored = KB.map(e => {
    const hay = `${e.title} ${e.rule} ${e.why}`.toLowerCase();
    let s = 0;
    for (const w of q) {
      if (e.tags.some(t => t === w)) s += 5; else if (e.tags.some(t => t.includes(w) || w.includes(t))) s += 3;
      if (e.id === w) s += 4;
      if (hay.includes(w)) s += 1;
    }
    return { e, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => x.e);
}
const HOSTS = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', cursor: 'Cursor' };
function render(e) {
  const lines = [`${e.title}`, `  Rule: ${e.rule}`, `  Why:  ${e.why}`];
  for (const [k, v] of Object.entries(e.how || {})) lines.push(`  ${HOSTS[k].padEnd(12)} ${v}`);
  if (e.auto) lines.push(`  askai:       ${e.auto}`);
  return lines.join('\n');
}
module.exports = { KB, search, render, topics };
