'use strict';
// Install profiles: which components a kind of work gets. A profile is a starting set; --only replaces it, --skip removes
// from it, and the opt-in flags (--markitdown, --ccusage, --caveman-plugin) add to it.
//
// Why profiles instead of installing everything: every MCP server and plugin adds tool definitions and hooks that are
// paid for in each session, whether or not the work needs them. A documentation session gains nothing from a code
// navigation server, and a coding session gains nothing from a document converter.

// 'rules' is in every profile so that installing a narrower profile removes the rule files of a wider one that askai wrote.
const BASE = ['claude', 'baseline', 'rtk', 'caveman', 'statusline', 'rules'];

const PROFILES = {
  minimal: {
    summary: 'shell-output compression, terse replies, settings baseline, status line; no MCP servers or plugins',
    components: BASE,
    rules: [],
  },
  coding: {
    summary: 'minimal + Context Mode (large output kept out of context) + Serena (symbol-level navigation) + code rules',
    components: [...BASE, 'context-mode', 'serena'],
    rules: ['coding'],
  },
  docs: {
    summary: 'minimal + Context Mode + markitdown (PDF/Office to Markdown before reading) + document rules; no code navigation',
    components: [...BASE, 'context-mode', 'markitdown'],
    rules: ['docs'],
  },
  full: {
    summary: 'coding + markitdown + ccusage (third-party usage report), both rule sets',
    components: [...BASE, 'context-mode', 'serena', 'markitdown', 'ccusage'],
    rules: ['coding', 'docs'],
  },
};

const DEFAULT = 'coding';
const names = () => Object.keys(PROFILES);

// Unknown names throw, with the valid ones listed.
function get(name) {
  const n = name || DEFAULT;
  if (!Object.prototype.hasOwnProperty.call(PROFILES, n)) throw new Error(`unknown profile "${n}" (known: ${names().join(', ')})`);
  return { name: n, ...PROFILES[n] };
}

module.exports = { PROFILES, DEFAULT, names, get };
