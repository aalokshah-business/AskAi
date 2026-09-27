'use strict';
// Path-scoped rule files: ~/.claude/rules/ for Claude Code, .cursor/rules/*.mdc per project for Cursor. Claude Code loads a rule file that has a `paths:` list only when it reads a
// file matching one of the globs, so a coding rule costs nothing in a session that only touches documents and the other
// way round. (Rules without `paths:` load every session, so every askai rule has one.)
//
// Each rule is a few short lines: a rule file is input tokens every time it loads, and the always-loaded CLAUDE.md block
// already carries the general rules. Lines that mention a tool are written only when that tool is present.
const crypto = require('crypto');

const NL = String.fromCharCode(10);

const KINDS = {
  coding: {
    globs: ['**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,kts,swift,cs,rb,php,c,cc,cpp,h,hpp,scala,dart}'],
    lines: present => [
      '- Run the narrowest command first: one test file or test, one package build. Read only the failing lines of the output.',
      '- Do not re-Read a file you just edited; Edit fails loudly if it did not apply.',
      present.includes('serena') && '- Call activate_project once per session (skip if already active this session) before other Serena calls.',
      present.includes('serena') && '- Before Reading a whole source file, try get_symbols_overview, then find_symbol for just the symbol body you need, then find_referencing_symbols for call sites — cheaper than Read or a repo-wide Grep.',
      present.includes('context-mode') && '- Build, test and log output that is long: run it through ctx_execute or ctx_batch_execute and read the summary.',
    ],
  },
  docs: {
    globs: ['**/*.{md,mdx,rst,adoc,txt,pdf,docx,pptx,xlsx}'],
    lines: present => [
      present.includes('markitdown') && '- PDF, Word, PowerPoint and Excel files: convert once with `markitdown <file> -o <file>.md`, then Read the .md with offset/limit instead of the binary file.',
      '- Long documents: read one section at a time and keep notes in a file instead of re-reading.',
      '- Editing prose: Edit the changed passage; do not rewrite the whole file.',
      present.includes('context-mode') && '- Very large text (logs, exports, scraped pages): index it with ctx_execute and query it instead of reading it whole.',
    ],
  },
};

const kinds = () => Object.keys(KINDS);
const fileName = kind => `askai-${kind}.md`;
const known = kind => Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;

// Heading and lines of one rule, shared by the Claude and Cursor renderings. present: ids of the tools found on the machine.
function body(kind, present) {
  const k = known(kind);
  if (!k) return null;
  return [`# ${kind === 'coding' ? 'Code files' : 'Documents'} (askai)`, ...k.lines(present || []).filter(Boolean)];
}

// The full text of the rule file for `kind` in ~/.claude/rules, or null for an unknown kind.
function render(kind, present) {
  const b = body(kind, present);
  if (!b) return null;
  return ['---', 'paths:', ...KINDS[kind].globs.map(g => `  - "${g}"`), '---', ...b, ''].join(NL);
}

// ---- Cursor: .cursor/rules/*.mdc in a project (written by `askai project`) ------------------------------------------------
// Cursor's rule frontmatter takes `globs` as a comma-separated string and has no brace expansion that is documented, so the
// braces of the Claude globs are expanded. `alwaysApply: false` plus `globs` is Cursor's "apply to specific files" type.
// The marker line is how askai recognises a file it wrote: only marked files are overwritten or removed.
const MDC_MARKER = '<!-- askai:managed (written by `askai project`; askai uninstall or `askai project --remove` deletes this file, edits are overwritten) -->';
const MDC_NAMES = { tokens: 'askai-tokens.mdc', coding: 'askai-coding.mdc', docs: 'askai-docs.mdc' };

function expandBraces(glob) {
  const m = /^(.*)\{([^{}]*)\}(.*)$/.exec(glob);
  return m ? m[2].split(',').flatMap(x => expandBraces(m[1] + x + m[3])) : [glob];
}

function mdc(fields, lines) {
  const fm = ['---', `description: ${fields.description}`];
  if (fields.globs) fm.push(`globs: ${fields.globs.join(',')}`);
  fm.push(`alwaysApply: ${fields.alwaysApply ? 'true' : 'false'}`, '---');
  return [...fm, '', MDC_MARKER, '', ...lines, ''].join(NL);
}
// bodyText: the general token rules (and terse directive) for the always-applied file.
function renderCursorTokens(bodyText) {
  return mdc({ description: 'Token-saving working rules (askai)', alwaysApply: true }, bodyText.split(NL));
}
function renderCursor(kind, present) {
  const b = body(kind, present);
  if (!b) return null;
  return mdc({ description: kind === 'coding' ? 'Token-saving rules for code files (askai)' : 'Token-saving rules for documents (askai)', globs: KINDS[kind].globs.flatMap(expandBraces), alwaysApply: false }, b);
}

const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

module.exports = { KINDS, kinds, fileName, render, sha, MDC_MARKER, MDC_NAMES, expandBraces, renderCursor, renderCursorTokens };
