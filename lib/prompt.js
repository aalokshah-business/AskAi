'use strict';
// askai prompt: turns a rough or dictated ask into a structured prompt, offline (no model call). Also the output-safe template
// (make a noisy command safe for the thread) and the handoff prompt for a fresh session.
const fs = require('fs');
const path = require('path');
const models = require('./models');

const FILLERS = /\b(um+|uh+|erm+|hmm+|you know|i mean|basically|actually|literally|kind of|sort of|okay so|so yeah|right\?)\s*,?/gi;
function clean(text) {
  const lead = t => t.trim().replace(/(^|[.?!]\s+)(so|ok|okay|well|right|and)\s*,?\s+/gi, '$1');
  return lead(lead(String(text || '').replace(FILLERS, ' '))).replace(/[\s,;]+$/, '').replace(/\b(\w+)(\s+\1\b)+/gi, '$1').replace(/\s+([,.?!])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const FILE_RE = /(?:^|[\s(`'"])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:tsx?|jsx?|mjs|cjs|py|kt|kts|swift|java|go|rs|c|cc|cpp|h|hpp|cs|rb|php|css|scss|html|vue|svelte|md|json|ya?ml|toml|gradle|xml|sql|sh|ps1))\b/g;
function files(text) { const out = new Set(); for (const m of String(text || '').matchAll(FILE_RE)) out.add(m[1].replace(/^\.\//, '')); return [...out]; }
const MODES = {
  blunt: 'BLUNT: no hedging, no caveats, no disclaimers; just the answer.',
  brutal: 'BRUTAL: tell me exactly what is wrong; no compliment sandwich.',
  assume: 'ASSUME: make as few assumptions as possible and state each one you make.',
  counter: 'COUNTER: give the strongest counterargument to my plan before agreeing with it.',
  contrast: 'CONTRAST: compare the options side by side as if the other option had every advantage.',
};
const KINDS = {
  bug: 'Approach: reproduce with the narrowest command, find the root cause with evidence, make the minimal fix, then run or add a regression test.',
  feature: 'Approach: confirm the acceptance criteria and the files in scope, build it in small verified steps, add nothing that was not asked.',
  design: 'Approach: give two or three options with trade-offs and a recommendation; write no code until I choose.',
  risky: 'Approach: plan first; list every destructive or irreversible step and wait for my approval; keep a rollback (branch or backup).',
  commit: 'Approach: match the recent git log subject style. Stage only the files in this change. Do not commit unless I asked.',
  firmware: 'Approach: reproduce on the unit test or the target. Check timing and ISR safety. No blocking calls in an ISR. Ask before flash or reboot.',
};
const ENV_AGENT = { claude: 'subagent', codex: 'custom agent', cursor: 'subagent', agy: 'subagent' };

function task(o) {
  const ask = clean(o.ask);
  if (!ask) throw new Error('give the request: askai prompt "what you want done"');
  const tier = o.tier || models.guessTier(ask);
  const fl = [...new Set([...(o.files ? String(o.files).split(',').map(s => s.trim()).filter(Boolean) : []), ...files(ask)])];
  const agent = models.TIER_INFO[tier].agent;
  const L = [`TASK (${tier} tier${tier === 'build' ? '' : `; delegate to the \`${agent}\` ${ENV_AGENT[o.tool] || 'subagent'} if this session is on another tier`})`,
    `Goal: ${ask}`,
    `Read first: AGENTS.md pointers, then ${fl.length ? `only ${fl.map(f => '@' + f).join(' ')}` : 'only the files the goal needs (search before reading; line ranges)'}${o.resume ? '; .ai-work/HANDOFF.md first' : ''}.`,
    `Done when: ${o.done || 'the narrowest relevant test or check passes and nothing unrelated changed'}.`,
    'Constraints: smallest change that solves it; keep error handling, tests and security; no new dependencies or refactors unless asked.',
    o.output === 'diff' ? 'Output: only the diff of what you changed, then one line per check you ran; no explanation unless something failed.' : o.output === 'full' ? 'Output: explain your reasoning and the change in full.' : 'Output: changed files, the check you ran and its result, blockers, next step. Under 15 lines; quote only failing lines; show code changes as a diff, never whole files.'];
  if (o.kind && KINDS[o.kind]) L.splice(4, 0, KINDS[o.kind]);
  for (const m of [].concat(o.mode || []).flatMap(x => String(x).split(','))) if (MODES[m.trim()]) L.push(MODES[m.trim()]);
  return { tier, files: fl, text: L.join('\n') };
}
// Your screenshot: "Before running this command, make the output safe for a Codex thread."
function outputSafe(command) {
  if (!command) throw new Error('give the command: askai prompt --output-safe "npm test"');
  return [`Before running this command, make its output safe for this thread.`, `Command: ${command}`, 'Return:',
    '1. A narrower command if possible (one test file, one package, one target).',
    '2. How to limit noisy output (quiet flags, --silent, -q, tail -n 40, grep for the failure).',
    '3. Which exact error lines or files matter.', '4. The short summary you should see instead of the full log.'].join('\n');
}
// A fresh session after /clear or a break: the handoff and work order, nothing else.
function resume(repo) {
  const read = f => { try { return fs.readFileSync(path.join(repo, f), 'utf8'); } catch (_) { return null; } };
  const ho = read(path.join('.ai-work', 'HANDOFF.md'));
  const wo = read(path.join('docs', 'ai', 'WORK_ORDER.md'));
  return ['Continue this project from its files, not from chat history.',
    `1. Read AGENTS.md, then ${ho ? '.ai-work/HANDOFF.md' : 'docs/ai/PROJECT_MAP.md'}${wo ? ' and docs/ai/WORK_ORDER.md' : ''}, then only the files they list.`,
    '2. Check them against `git status --short` and `git log -1 --oneline`.',
    '3. Summarise the state in 6 lines, confirm the next step in one sentence, and wait for my go-ahead.'].join('\n');
}
module.exports = { clean, files, task, outputSafe, resume, MODES, KINDS };
