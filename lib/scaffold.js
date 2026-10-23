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
  try {
    const info = require('./project').detect(root);
    if (info.type === 'embedded') {
      const rel = path.join('docs', 'ai', 'PROJECT_PROFILE.md');
      const file = path.join(root, rel);
      const runs = require('./daily').namedRuns(root);
      const docs = fs.existsSync(path.join(root, 'doc')) || fs.existsSync(path.join(root, 'docs', 'zephyr')) ? '- Docs: local doc/ is the docs source.' : '- Docs: no official docs source found.';
      const extra = `\n## Firmware\n- Build, flash, and reboot are separate named runs. Ask before flash or reboot.\n- C/C++ navigation needs compile_commands.json at the repo root (configure with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON).\n${docs}\n${runs.length ? runs.join('\n') + '\n' : ''}`;
      if (!dry && fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes('## Firmware')) fs.appendFileSync(file, extra);
      print(dry ? '  would note      firmware runs in docs/ai/PROJECT_PROFILE.md' : '  noted           firmware runs in docs/ai/PROJECT_PROFILE.md');
    }
  } catch (_) { /* detect is best effort */ }
  print('\nNext: fill docs/ai/PROJECT_PROFILE.md with commands you have run yourself, and keep AGENTS.md short (an index, not a manual).');
  return 0;
}

module.exports = { run, FILES };
