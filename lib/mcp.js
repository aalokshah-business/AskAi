'use strict';
// askai mcp [list | on NAME | off NAME] [--tool claude|codex|cursor|agy]: every MCP server across the four tools, and a switch.
// Antigravity has a documented "disabled" flag and Codex an "enabled" key; for Claude Code and Cursor AskAI "parks" the server:
// it moves the entry into ~/.claude/askai/mcp-parked.json (after a backup) and puts it back on "on". Switch between sessions:
// connecting or disconnecting a server changes the tool list, which is part of the cached prompt.
const fs = require('fs');
const path = require('path');
const cfg = require('./claude-config');

const parkFile = ctx => path.join(ctx.paths.askaiDir, 'mcp-parked.json');
const readJ = f => { try { return cfg.readJson(f); } catch (_) { return null; } };
function sources(ctx) {
  const s = [{ tool: 'claude', file: ctx.paths.userJson, kind: 'json' }];
  if (ctx.cursorPaths) s.push({ tool: 'cursor', file: ctx.cursorPaths.mcp, kind: 'json' });
  if (ctx.agyPaths) s.push({ tool: 'agy', file: ctx.agyPaths.mcp, kind: 'json', flag: true });
  if (ctx.codexPaths) s.push({ tool: 'codex', file: ctx.codexPaths.config, kind: 'toml' });
  return s;
}
// Codex tables: [mcp_servers.NAME] ... ; "enabled = false" means off.
function tomlServers(text) {
  const out = []; const lines = String(text || '').split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = /^\s*\[mcp_servers\.("?)([^\]"]+)\1\]\s*$/.exec(l);
    if (!m) return;
    let end = lines.findIndex((x, j) => j > i && /^\s*\[/.test(x)); if (end < 0) end = lines.length;
    const body = lines.slice(i + 1, end);
    out.push({ name: m[2], start: i, end, enabled: !body.some(x => /^\s*enabled\s*=\s*false\b/.test(x)) });
  });
  return out;
}
function list(ctx) {
  const rows = [];
  for (const s of sources(ctx)) {
    if (s.kind === 'json') {
      const j = readJ(s.file);
      for (const [name, def] of Object.entries((j && j.mcpServers) || {})) rows.push({ tool: s.tool, name, state: def && def.disabled === true ? 'off' : 'on', file: s.file });
    } else for (const t of tomlServers(cfg.readText(s.file))) rows.push({ tool: s.tool, name: t.name, state: t.enabled ? 'on' : 'off', file: s.file });
  }
  const parked = readJ(parkFile(ctx)) || {};
  for (const [tool, defs] of Object.entries(parked)) for (const name of Object.keys(defs || {})) rows.push({ tool, name, state: 'parked', file: parkFile(ctx) });
  return rows;
}
function write(ctx, file, text) { if (ctx.backup) ctx.backup(file); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function setState(ctx, tool, name, on, dry = false) {
  const s = sources(ctx).find(x => x.tool === tool);
  if (!s) throw new Error(`${tool} is not set up on this machine`);
  if (s.kind === 'toml') {
    const text = cfg.readText(s.file) || ''; const t = tomlServers(text).find(x => x.name === name);
    if (!t) throw new Error(`no MCP server "${name}" in ${s.file}`);
    if (t.enabled === on) return 'unchanged';
    const lines = text.split(/\r?\n/);
    if (on) { for (let i = t.end - 1; i > t.start; i--) if (/^\s*enabled\s*=\s*false\b/.test(lines[i])) lines.splice(i, 1); }
    else lines.splice(t.start + 1, 0, 'enabled = false');
    if (!dry) write(ctx, s.file, lines.join('\n'));
    return on ? 'enabled' : 'disabled';
  }
  const j = readJ(s.file) || {}; j.mcpServers = j.mcpServers || {};
  if (s.flag) {
    const def = j.mcpServers[name]; if (!def) throw new Error(`no MCP server "${name}" in ${s.file}`);
    if ((def.disabled !== true) === on) return 'unchanged';
    if (on) delete def.disabled; else def.disabled = true;
    if (!dry) write(ctx, s.file, JSON.stringify(j, null, 2) + '\n');
    return on ? 'enabled' : 'disabled';
  }
  const parked = readJ(parkFile(ctx)) || {}; parked[tool] = parked[tool] || {};
  if (on) {
    if (j.mcpServers[name]) return 'unchanged';
    const def = parked[tool][name]; if (!def) throw new Error(`"${name}" is not parked for ${tool}`);
    j.mcpServers[name] = def; delete parked[tool][name];
  } else {
    const def = j.mcpServers[name]; if (!def) { if (parked[tool][name]) return 'unchanged'; throw new Error(`no MCP server "${name}" in ${s.file}`); }
    parked[tool][name] = def; delete j.mcpServers[name];
  }
  if (!dry) { write(ctx, s.file, JSON.stringify(j, null, 2) + '\n'); write(ctx, parkFile(ctx), JSON.stringify(parked, null, 2) + '\n'); }
  return on ? 'restored' : 'parked';
}
function render(rows) {
  if (!rows.length) return 'No MCP servers configured in any of the four tools.';
  const NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', agy: 'Antigravity' };
  const out = ['tool         server                 state'];
  for (const r of rows) out.push(`${(NAMES[r.tool] || r.tool).padEnd(12)} ${r.name.padEnd(22)} ${r.state}`);
  out.push('', 'Switch between sessions, not during one: askai mcp off <name> [--tool T]   askai mcp on <name> [--tool T]',
    'Claude Code project servers (.mcp.json) and live connection status: /mcp inside the session. Calls each server got: askai infra.');
  return out.join('\n');
}
module.exports = { list, setState, render, tomlServers, parkFile };
