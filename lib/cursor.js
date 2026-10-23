'use strict';
// Cursor support. askai wires Cursor the same way it wires Claude Code: it installs existing tools and registers what they ship,
// and registers no hook of its own.
//
//   user level     RTK's Cursor hook (~/.cursor/hooks.json, written by `rtk init -g --agent cursor`), MCP entries for
//                  Context Mode and Serena in ~/.cursor/mcp.json (merged, never replacing an entry that is already there),
//                  and the token rules in ~/.cursor/rules (Cursor's machine-local user rules; they apply in every project)
//   project level  `askai project`: the same rule files under <project>/.cursor/rules, for checking into a repo.
//                  Skip that on a machine that already has the user rules, or the always-applied file is loaded twice.
//
// Not available on Cursor: the status line, the CLAUDE.md block, ccusage, and any measurement of Cursor usage.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./claude-config');
const rules = require('./rules');

const CURSOR_IDS = ['cursor-rtk', 'cursor-context-mode', 'cursor-serena', 'cursor-rules'];
// Targets: auto | claude | cursor | both (Claude Code + Cursor) | codex | agy | all, or a comma list such as claude,codex.
const TARGETS = ['auto', 'claude', 'cursor', 'both', 'codex', 'agy', 'all'];
const HOSTS = ['claude', 'cursor', 'codex', 'agy'];
function targetIncludes(target, host) {
  if (!target || target === 'auto' || target === 'all') return true;
  if (target === 'both') return host === 'claude' || host === 'cursor';
  return String(target).split(',').map(x => x.trim()).includes(host);
}
function targetValid(t) {
  const parts = String(t).split(',').map(x => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(x => TARGETS.includes(x)) && (parts.length === 1 || parts.every(x => HOSTS.includes(x)));
}

const defaultCursorHome = () => path.join(os.homedir(), '.cursor');
function cursorPaths(home) {
  return { home, mcp: path.join(home, 'mcp.json'), hooks: path.join(home, 'hooks.json') };
}

// Which hosts a command works on. `auto` is Claude Code always (askai's original job) plus every other host that is present: its
// config directory exists or its CLI is on PATH. A sandboxed run (--claude-home) never looks at the real ~/.cursor, ~/.codex or
// ~/.gemini: those hosts are used only when --cursor-home / --codex-home / --agy-home names a directory, and asking for one
// without its directory is an error.
function hosts(ctx) {
  const target = ctx.opts.target || 'auto';
  const parts = String(target).split(',').map(x => x.trim()).filter(Boolean);
  const named = new Set(parts.length > 1 ? parts : parts[0] === 'both' ? ['claude', 'cursor'] : parts[0] === 'all' ? HOSTS : parts[0] === 'auto' ? [] : parts);
  const auto = parts.length === 1 && parts[0] === 'auto';
  const need = { cursor: ['cursorPaths', '--cursor-home'], codex: ['codexPaths', '--codex-home'], agy: ['agyPaths', '--agy-home'] };
  for (const [h, [key, flag]] of Object.entries(need)) {
    if (named.has(h) && !ctx[key]) throw new Error(`--target ${target} together with --claude-home needs ${flag} DIR (a sandboxed run never touches the real config)`);
  }
  const p = ctx.cursorPaths;
  const cli = bin => !!(ctx.which && ctx.which(bin));
  const claudeCli = !!(ctx.claudeBin && ctx.claudeBin()) || cli('claude');
  const cursorCli = cli('cursor') || cli('agent') || cli('cursor-agent');
  return {
    target,
    claude: named.has('claude') || (auto && claudeCli),
    cursor: named.has('cursor') || !!ctx.opts.cursorHome || (auto && !!p && cursorCli),
    codex: named.has('codex') || !!ctx.opts.codexHome || (auto && !!ctx.codexPaths && cli('codex')),
    agy: named.has('agy') || !!ctx.opts.agyHome || (auto && !!ctx.agyPaths && cli('agy')),
  };
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- ~/.cursor/mcp.json ------------------------------------------------------------------------------------------
function mcpServers(ctx) {
  if (!ctx.cursorPaths) return {};
  const j = cfg.readJson(ctx.cursorPaths.mcp);
  return isObj(j.mcpServers) ? j.mcpServers : {};
}
function serversOf(j, file) {
  if (j.mcpServers === undefined) j.mcpServers = {};
  if (!isObj(j.mcpServers)) throw new Error(`${file}: "mcpServers" is not an object; fix it, askai will not overwrite it`);
  return j.mcpServers;
}
// Add-if-absent: an entry with this name that already exists is left exactly as it is. -> 'added' | 'present'
function addMcp(ctx, name, entry) {
  let res = 'present';
  ctx.editJson(ctx.cursorPaths.mcp, j => {
    const s = serversOf(j, ctx.cursorPaths.mcp);
    if (!s[name]) { s[name] = entry; res = 'added'; }
  });
  return res;
}
function removeMcp(ctx, name) {
  let removed = false;
  ctx.editJson(ctx.cursorPaths.mcp, j => {
    if (!isObj(j.mcpServers) || !j.mcpServers[name]) return;
    delete j.mcpServers[name];
    removed = true;
  });
  return removed;
}

// ---- ~/.cursor/hooks.json ({ version, hooks: { <event>: [ { command, matcher } ] } }) -----------------------------------
// Read tolerantly: entries are flat in Cursor's format, but a nested { hooks: [ { command } ] } entry is understood too.
const commandsOf = e => (isObj(e) ? [e.command, ...(Array.isArray(e.hooks) ? e.hooks.map(h => h && h.command) : [])].filter(c => typeof c === 'string') : []);
function hookCommands(json) {
  const out = [];
  const h = isObj(json.hooks) ? json.hooks : {};
  for (const [event, arr] of Object.entries(h)) {
    if (Array.isArray(arr)) for (const e of arr) for (const command of commandsOf(e)) out.push({ event, command });
  }
  return out;
}
const RTK = /\brtk\b/i;
function rtkHooked(ctx) {
  return !!ctx.cursorPaths && hookCommands(cfg.readJson(ctx.cursorPaths.hooks)).some(h => RTK.test(h.command));
}
// Removes every hook entry that runs rtk; returns how many entries went. Empty event arrays are dropped.
function removeRtkHooks(json) {
  if (!isObj(json.hooks)) return 0;
  let n = 0;
  for (const [event, arr] of Object.entries(json.hooks)) {
    if (!Array.isArray(arr)) continue;
    const keep = arr.filter(e => !commandsOf(e).some(c => RTK.test(c)));
    n += arr.length - keep.length;
    if (keep.length) json.hooks[event] = keep; else delete json.hooks[event];
  }
  return n;
}

// ---- rule files: ~/.cursor/rules (every project on this machine) and <dir>/.cursor/rules (one repo) --------------------
const rulesDir = dir => path.join(dir, '.cursor', 'rules');
const userRulesDir = home => path.join(home, 'rules');
const isMarked = text => typeof text === 'string' && text.includes(rules.MDC_MARKER);

// The files `askai project` writes for a profile. present: ids of the tools Cursor can use (see components.presence('cursor')).
// caveman: 'off' | 'lite' | 'full' | 'ultra'.
function projectFiles(profile, present, caveman) {
  const lead = cfg.buildRules(present, 'cursor');
  const body = caveman === 'off' ? lead : `${lead}\n\n${cfg.terseSection(caveman)}`;
  const files = [{ name: rules.MDC_NAMES.tokens, text: rules.renderCursorTokens(body) }];
  for (const kind of profile.rules) files.push({ name: rules.MDC_NAMES[kind], text: rules.renderCursor(kind, present) });
  return files;
}

const readIf = p => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } };

// Writes `files` into `rd` and removes marked askai files that are no longer wanted. A file without the marker was not
// written by askai: it is left alone unless force. -> { written, unchanged, skipped, removed } (file names). In dry-run
// nothing is written.
function writeRulesAt(ctx, rd, files, force) {
  const out = { written: [], unchanged: [], skipped: [], removed: [] };
  const wanted = new Set(files.map(f => f.name));
  for (const f of files) {
    const p = path.join(rd, f.name), cur = readIf(p);
    if (cur === f.text) { out.unchanged.push(f.name); continue; }
    if (cur !== null && !isMarked(cur) && !force) { out.skipped.push(f.name); continue; }
    if (ctx.dry) ctx.log.plan(`write ${p}`); else cfg.writeAtomic(p, f.text);
    out.written.push(f.name);
  }
  for (const name of stale(rd, wanted)) {
    const p = path.join(rd, name);
    if (ctx.dry) ctx.log.plan(`remove ${p}`); else fs.unlinkSync(p);
    out.removed.push(name);
  }
  return out;
}
function writeProject(ctx, dir, files, force) {
  return writeRulesAt(ctx, rulesDir(dir), files, force);
}
// Marked askai-*.mdc files in the rules dir whose names are not in `keep`.
function stale(rd, keep) {
  let names = [];
  try { names = fs.readdirSync(rd); } catch (_) { return []; }
  return names.filter(n => /^askai-.*\.mdc$/.test(n) && !keep.has(n) && isMarked(readIf(path.join(rd, n))));
}
function removeRulesAt(ctx, rd) {
  const gone = [];
  for (const name of stale(rd, new Set())) {
    const p = path.join(rd, name);
    if (ctx.dry) ctx.log.plan(`remove ${p}`); else fs.unlinkSync(p);
    gone.push(name);
  }
  return gone;
}
function removeProject(ctx, dir) {
  return removeRulesAt(ctx, rulesDir(dir));
}

// graphify install writes an always-on rule that tells the agent to query the graph before every Read or Grep.
// That rule is loaded on every turn. Connection questions still use graphify query when the task matches.
function scopeGraphifyRule(file, dry) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  if (!/alwaysApply:\s*true\b/.test(text)) return false;
  if (!dry) fs.writeFileSync(file, text.replace(/alwaysApply:\s*true\b/, 'alwaysApply: false'));
  return true;
}

// Cursor's slash menu reads a short description. Claude Code's disable-model-invocation key is not part of that format.
function cursorCommandText(raw) {
  const desc = ((String(raw).match(/^description:\s*(.+)$/m) || [])[1] || 'AskAI command').trim();
  const body = String(raw).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/, '');
  return `---\ndescription: ${desc}\n---\n\n${body}`;
}

module.exports = {
  CURSOR_IDS, TARGETS, HOSTS, targetValid, targetIncludes, defaultCursorHome, cursorPaths, hosts, mcpServers, addMcp, removeMcp,
  cursorCommandText, scopeGraphifyRule,
  hookCommands, rtkHooked, removeRtkHooks, rulesDir, userRulesDir, projectFiles, writeRulesAt, writeProject, removeRulesAt, removeProject,
};
