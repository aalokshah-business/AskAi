'use strict';
// Cursor support. askai wires Cursor the same way it wires Claude Code: it installs existing tools and registers what they ship,
// and registers no hook of its own.
//
//   user level     RTK's Cursor hook (~/.cursor/hooks.json, written by `rtk init -g --agent cursor`), and MCP entries for
//                  Context Mode and Serena in ~/.cursor/mcp.json (merged, never replacing an entry that is already there)
//   project level  `askai project`: .cursor/rules/askai-*.mdc files (an always-applied token-rules file plus glob-scoped
//                  code and document rules). Cursor has no file-based user rules, so these live in each project.
//
// Not available on Cursor: the status line, the CLAUDE.md block, ccusage, and any measurement of Cursor usage.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./claude-config');
const rules = require('./rules');

const CURSOR_IDS = ['cursor-rtk', 'cursor-context-mode', 'cursor-serena'];
const TARGETS = ['auto', 'claude', 'cursor', 'both'];

const defaultCursorHome = () => path.join(os.homedir(), '.cursor');
function cursorPaths(home) {
  return { home, mcp: path.join(home, 'mcp.json'), hooks: path.join(home, 'hooks.json') };
}

// Which hosts a command works on. `auto` is Claude Code always (askai's original job) plus Cursor when it is present: its config
// directory exists or the `cursor` command is on PATH. A sandboxed run (--claude-home) never looks at the real ~/.cursor:
// Cursor is used only when --cursor-home names a directory, and asking for it without one is an error.
function hosts(ctx) {
  const target = ctx.opts.target || 'auto';
  const p = ctx.cursorPaths;
  if ((target === 'cursor' || target === 'both') && !p) {
    throw new Error(`--target ${target} together with --claude-home needs --cursor-home DIR (a sandboxed run never touches the real ~/.cursor)`);
  }
  const explicitDir = !!ctx.opts.cursorHome;
  const cursorPresent = !!p && (explicitDir || fs.existsSync(p.home) || !!ctx.which('cursor'));
  return {
    target,
    claude: target !== 'cursor',
    cursor: target === 'cursor' || target === 'both' || (target === 'auto' && cursorPresent),
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

// ---- project rules: <dir>/.cursor/rules/askai-*.mdc ---------------------------------------------------------------------
const rulesDir = dir => path.join(dir, '.cursor', 'rules');
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

// Writes `files` and removes marked askai files that are no longer wanted. A file without the marker was not written by askai:
// it is left alone unless force. -> { written, unchanged, skipped, removed } (file names). In dry-run nothing is written.
function writeProject(ctx, dir, files, force) {
  const out = { written: [], unchanged: [], skipped: [], removed: [] };
  const rd = rulesDir(dir);
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
// Marked askai-*.mdc files in the rules dir whose names are not in `keep`.
function stale(rd, keep) {
  let names = [];
  try { names = fs.readdirSync(rd); } catch (_) { return []; }
  return names.filter(n => /^askai-.*\.mdc$/.test(n) && !keep.has(n) && isMarked(readIf(path.join(rd, n))));
}
function removeProject(ctx, dir) {
  const rd = rulesDir(dir), gone = [];
  for (const name of stale(rd, new Set())) {
    const p = path.join(rd, name);
    if (ctx.dry) ctx.log.plan(`remove ${p}`); else fs.unlinkSync(p);
    gone.push(name);
  }
  return gone;
}

module.exports = {
  CURSOR_IDS, TARGETS, defaultCursorHome, cursorPaths, hosts, mcpServers, addMcp, removeMcp,
  hookCommands, rtkHooked, removeRtkHooks, rulesDir, projectFiles, writeProject, removeProject,
};
