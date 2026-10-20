'use strict';
// askai scaffold [dir]: the per-repository files every agent reads, written once and never overwritten.
//   AGENTS.md (Codex, Antigravity and Cursor read it; Claude Code through CLAUDE.md's @AGENTS.md import), CLAUDE.md,
//   docs/ai/PROJECT_PROFILE.md (verified commands, read on demand), docs/ai/HANDOFF_PROMPTS.md, .cursorignore, and .ai-work/.
// Cursor's rule files are a separate, optional step (`askai project`): install already writes them to ~/.cursor/rules.
const fs = require('fs');
const path = require('path');
const session = require('./session');

const T = path.join(__dirname, '..', 'templates');
const FILES = [
  ['AGENTS.md', 'AGENTS.md'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['PROJECT_PROFILE.md', path.join('docs', 'ai', 'PROJECT_PROFILE.md')],
  ['HANDOFF_PROMPTS.md', path.join('docs', 'ai', 'HANDOFF_PROMPTS.md')],
  ['cursorignore', '.cursorignore'],
];

function run(dir, o, print = console.log) {
  const root = path.resolve(dir || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { print(`askai scaffold: ${root} is not a directory`); return 1; }
  const dry = !!o.dry;
  print(`askai scaffold${dry ? ' (dry-run)' : ''}   ${root}`);
  for (const [tpl, rel] of FILES) {
    const out = path.join(root, rel);
    if (fs.existsSync(out)) {
      const text = fs.readFileSync(out, 'utf8');
      let tip = '';
      if (rel === 'CLAUDE.md' && !/@AGENTS\.md/.test(text)) tip = '  (tip: add "@AGENTS.md" as its first line so Claude Code shares the cross-tool rules)';
      print(`  keep (exists)   ${rel}${tip}`);
      continue;
    }
    if (dry) { print(`  would create    ${rel}`); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(T, tpl), out);
    print(`  created         ${rel}`);
  }
  for (const d of session.ensure(root, dry)) print(`  ${dry ? 'would ' : ''}${d}`);
  print('\nNext: fill docs/ai/PROJECT_PROFILE.md with commands you have run yourself, and keep AGENTS.md short (an index, not a manual).');
  return 0;
}

module.exports = { run, FILES };
