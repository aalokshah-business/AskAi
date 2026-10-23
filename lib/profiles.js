'use strict';
// Install profiles: which components a kind of work gets. A profile is a starting set; --only replaces it, --skip removes
// from it, and the opt-in flags (--markitdown, --ccusage, --caveman-plugin) add to it.
//
// Why profiles instead of installing everything: every MCP server and plugin adds tool definitions and hooks that are
// paid for in each session, whether or not the work needs them. A documentation session gains nothing from a code
// navigation server, and a coding session gains nothing from a document converter.

// 'rules' is in every profile so that installing a narrower profile removes the rule files of a wider one that askai wrote.
// The retired handoff component remains available to remove files from older installations.
// RTK and Context Mode are opt-in (--rtk, --context-mode): paired third-party benchmarks measured RTK at a median
// +7% task cost (JetBrains: +7.6% at low effort, p=0.004) and Context Mode at +33% to +72% (Stet.sh). Catalogue of every
// result: https://cc.bruniaux.com/token-savings/ . The install plan and README say how to add them back.
// 'lean' (idle drains off, output caps, deny-read rules) is in every profile; --skip lean leaves it out.
const BASE = ['token-kit', 'claude', 'baseline', 'caveman', 'statusline', 'rules', 'lean'];

const PROFILES = {
  minimal: {
    summary: 'cheap model defaults, token and terse rules, status line; no MCP servers or plugins',
    components: BASE,
    rules: [],
  },
  coding: {
    summary: 'minimal + Serena (symbol-level navigation) + code rules',
    components: [...BASE, 'serena', 'ccusage'],
    rules: ['coding'],
  },
  docs: {
    summary: 'minimal + markitdown (PDF/Office to Markdown before reading) + document rules; no code navigation',
    components: [...BASE, 'markitdown', 'ccusage'],
    rules: ['docs'],
  },
  full: {
    summary: 'coding + markitdown + ccusage (third-party usage report), both rule sets',
    components: [...BASE, 'serena', 'markitdown', 'ccusage'],
    rules: ['coding', 'docs'],
  },
};

// max: everything AskAI can install, for people who choose all the optimisers over the evidence-based default. Independent
// tests found RTK, Context Mode and Headroom can raise cost; measure with askai audit and askai usage after a week.
PROFILES.max = {
  summary: 'everything: full + RTK, Context Mode, Headroom (MCP mode), Graphify, Context7, Repomix, Caveman plugin, LSP plugins (ts, py), base tools',
  components: [...PROFILES.full.components, 'rtk', 'context-mode', 'caveman-plugin', 'headroom', 'graphify', 'context7', 'repomix', 'code-intel', 'base-tools'],
  rules: ['coding', 'docs'],
};
PROFILES.lean = {
  summary: 'rules, terse mode, status line, baseline, tier defaults, base tools; no MCP servers',
  components: ['token-kit', 'claude', 'baseline', 'caveman', 'statusline', 'rules', 'lean', 'base-tools'],
  rules: [],
};
PROFILES.code = {
  summary: 'same set as coding: Serena, code rules, ccusage',
  components: [...PROFILES.coding.components],
  rules: ['coding'],
};
PROFILES.experimental = {
  summary: 'same set as max; not recommended',
  components: [...PROFILES.max.components],
  rules: ['coding', 'docs'],
};

const DEFAULT = 'lean';
const names = () => Object.keys(PROFILES);

// Unknown names throw, with the valid ones listed.
function get(name) {
  const n = name || DEFAULT;
  if (!Object.prototype.hasOwnProperty.call(PROFILES, n)) throw new Error(`unknown profile "${n}" (known: ${names().join(', ')})`);
  return { name: n, ...PROFILES[n] };
}

module.exports = { PROFILES, DEFAULT, names, get };
