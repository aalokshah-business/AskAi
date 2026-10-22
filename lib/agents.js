'use strict';
// OpenAI Codex and Google Antigravity support, plus two cross-host components: the hook-free session handoff (a skill or
// slash command per host) and the opt-in lean Claude Code settings. Same rules as the rest of askai: existing tools only, their own
// installers, add-if-absent edits, a backup before every write, and a manifest record so uninstall removes only what askai added.
//
//   Codex        ~/.codex (CODEX_HOME): AGENTS.md managed block, config.toml keys, RTK's own `rtk init -g --codex`,
//                Serena through `codex mcp add`, the handoff skill in ~/.agents/skills
//   Antigravity  ~/.gemini: GEMINI.md managed block, RTK's own `rtk init -g --agent antigravity`, Serena in
//                config/mcp_config.json, the handoff skill in antigravity-cli/skills and config/skills
//
// Context Mode also supports both hosts, through its own installer (`npx skills add mksglu/context-mode` or its CLI). askai names
// that step instead of guessing its flags. Sources for every path and key: see docs/ASKAI_GUIDE.md, "Research round 2".
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./claude-config');
const toml = require('./toml-lite');
const rulesLib = require('./rules');
const profiles = require('./profiles');

const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- paths -------------------------------------------------------------------------------------------------------
const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const defaultAgyHome = () => path.join(os.homedir(), '.gemini');
function codexPaths(home, sandbox) {
  return {
    home,
    config: path.join(home, 'config.toml'),
    hooks: path.join(home, 'hooks.json'),
    agentsMd: path.join(home, 'AGENTS.md'),
    rtkMd: path.join(home, 'RTK.md'),
    // Codex reads user skills from $HOME/.agents/skills. A sandboxed run keeps them inside the sandbox home.
    skills: sandbox ? path.join(home, 'agents-skills') : path.join(os.homedir(), '.agents', 'skills'),
  };
}
function agyPaths(home) {
  return {
    home,
    rulesMd: path.join(home, 'GEMINI.md'),
    mcp: path.join(home, 'config', 'mcp_config.json'),
    cliSettings: path.join(home, 'antigravity-cli', 'settings.json'),
    cliSkills: path.join(home, 'antigravity-cli', 'skills'),
    appSkills: path.join(home, 'config', 'skills'),
    rtkPlugin: path.join(home, 'config', 'plugins', 'rtk'),
  };
}
// Present on this machine: the CLI is on PATH or its config directory exists.
const codexPresent = ctx => !!ctx.codexPaths && (!!ctx.opts.codexHome || fs.existsSync(ctx.codexPaths.home) || !!ctx.which('codex'));
const agyPresent = ctx => !!ctx.agyPaths && (!!ctx.opts.agyHome || fs.existsSync(path.join(ctx.agyPaths.home, 'antigravity-cli')) || fs.existsSync(path.join(ctx.agyPaths.home, 'config')) || !!ctx.which('agy'));

// ---- small file helpers -------------------------------------------------------------------------------------------
// Read-modify-write of a text file: nothing written when unchanged; dry-run only logs; backup first.
function editText(ctx, file, fn) {
  const before = cfg.readText(file) || '';
  const after = fn(before);
  if (after === before) return false;
  if (ctx.dry) { ctx.log.plan(`update ${file}`); return true; }
  ctx.backup(file);
  cfg.writeAtomic(file, after);
  return true;
}
const rec = (ctx, id) => ctx.manifest.components[id] || {};
function record(ctx, id, data) {
  ctx.manifest.components[id] = { ...(ctx.manifest.components[id] || {}), ...data, updated: new Date().toISOString() };
}
const firstLine = s => String(s || '').trim().split(/\r?\n/)[0];
const other = detail => ({ state: 'other', detail });

// ---- the handoff text (shared by every host) ------------------------------------------------------------------------
const HANDOFF_PROMPT = [
  'Stop after the current verified step; do not start anything new.',
  'Overwrite `.ai-work/HANDOFF.md` in the repository root (create the folder if needed; it is gitignored) in under 40 lines:',
  'goal and acceptance criteria; what is verified and what is not; branch, last commit and uncommitted files; exact test results;',
  'decisions with their reasons; ordered next steps, smallest first; and the 3-5 files with line ranges to read first next session.',
  'No code and no secrets. Then reply with one line: "Handoff written to .ai-work/HANDOFF.md". Resume later in any tool with:',
  '"Read AGENTS.md and .ai-work/HANDOFF.md, check them against git status, then continue from Next steps 1."',
].join(' ');
const SKILL_MD = [
  '---',
  'name: askai-handoff',
  'description: Writes a short session handoff to .ai-work/HANDOFF.md before a break, /clear or a switch to another coding agent. Use only when the user asks for a handoff.',
  '---',
  '',
  '# askai handoff',
  '',
  HANDOFF_PROMPT,
  '',
].join('\n');
const CURSOR_COMMAND = `${HANDOFF_PROMPT}\n`;

// ---- managed rule block for AGENTS.md / GEMINI.md ------------------------------------------------------------------
// The same token rules and terse directive as Claude Code's CLAUDE.md block, minus the lines that name Claude Code's own tools.
function ruleBlock(existing, level, present) {
  const parts = [cfg.buildRules(present, 'cursor')];
  if (level !== 'off' && !cfg.hasTerseOutside(existing || '')) parts.push(cfg.terseSection(level));
  return parts.join('\n\n');
}

// ---- factory: the components need a few helpers that live in components.js ------------------------------------------
// h = { ensureRtk, ensureSerenaTool, serenaExe }
function make(h) {
  const cavemanLevel = ctx => ctx.opts.caveman || (ctx.manifest.components.caveman || {}).level || 'full';

  // Which of Context Mode / Serena are wired for a host, so the rule lines name only tools the agent can call.
  function presentFor(ctx, host) {
    const has = [];
    if (host === 'codex' && ctx.codexPaths) {
      const t = cfg.readText(ctx.codexPaths.config) || '';
      if (toml.hasTable(t, 'mcp_servers.serena') && h.serenaExe(ctx)) has.push('serena');
      if (toml.hasTable(t, 'mcp_servers.context-mode') || toml.hasTable(t, 'mcp_servers.context_mode')) has.push('context-mode');
    }
    if (host === 'agy' && ctx.agyPaths) {
      let servers = {};
      try { const j = cfg.readJson(ctx.agyPaths.mcp); servers = isObj(j.mcpServers) ? j.mcpServers : {}; } catch (_) { /* unreadable: none */ }
      if (servers.serena && h.serenaExe(ctx)) has.push('serena');
      if (servers['context-mode']) has.push('context-mode');
    }
    return has;
  }

  function blockComponent(id, host, title, fileOf, label) {
    const comp = {
      id, host, mirrors: 'caveman', title, evidence: 'unmeasured',
      plan: `${label}: managed block with the token rules and the terse directive (level as --caveman); backup first`,
      detect(ctx) {
        const file = fileOf(ctx);
        if (!file) return other(`no ${host === 'codex' ? 'Codex' : 'Antigravity'} config directory (sandboxed run without --${host === 'codex' ? 'codex' : 'agy'}-home)`);
        const text = cfg.readText(file) || '';
        return text.includes(cfg.BEGIN.slice(0, 20)) ? { state: 'ok', detail: `managed block in ${file}` } : { state: 'missing', detail: `no managed block in ${file}` };
      },
      install(ctx) {
        const file = fileOf(ctx);
        if (!file) throw new Error(`the ${host} config directory is unknown (sandboxed run needs --${host === 'codex' ? 'codex' : 'agy'}-home DIR)`);
        const level = cavemanLevel(ctx);
        const created = cfg.readText(file) == null || !!rec(ctx, id).created;
        const changed = editText(ctx, file, t => cfg.upsertBlock(t, ruleBlock(t, level, presentFor(ctx, host))).text);
        ctx.log.info(changed ? `${label}: managed block written (caveman: ${level})` : `${label}: managed block already up to date`);
        if (!ctx.dry) record(ctx, id, { level, created });
      },
      update(ctx) { if (fileOf(ctx) && rec(ctx, id).level) comp.install(ctx); },
      uninstall(ctx) {
        const file = fileOf(ctx);
        if (!file || cfg.readText(file) == null) return;
        editText(ctx, file, t => cfg.removeBlock(t).text);
        // askai created the file and nothing of yours is left in it: remove it instead of leaving an empty file.
        if (!ctx.dry && rec(ctx, id).created && !(cfg.readText(file) || '').trim()) fs.rmSync(file, { force: true });
      },
    };
    return comp;
  }

  // ---- Codex ----------------------------------------------------------------------------------------------------
  const codexRules = blockComponent('codex-rules', 'codex', 'Codex token rules + terse style (~/.codex/AGENTS.md block)', ctx => ctx.codexPaths && ctx.codexPaths.agentsMd, 'AGENTS.md');

  // Add-if-absent keys, all from the Codex sample config (developers.openai.com/codex/config-sample).
  const CODEX_KEYS = [
    { key: 'model_reasoning_effort', value: 'medium', table: null, why: 'thinking tokens are output tokens' },
    { key: 'model_verbosity', value: 'low', table: null, why: 'shorter replies' },
    { key: 'personality', value: 'none', table: null, why: 'omits the Personality section from the instructions' },
    { key: 'default_subagent_reasoning_effort', value: 'medium', table: 'agents', why: 'spawned agents do not inherit high effort' },
  ];
  const codexKeysWanted = ctx => [
    ...(ctx.opts.codexModel ? [{ key: 'model', value: ctx.opts.codexModel, table: null, why: 'a cheaper default model' }] : []),
    ...CODEX_KEYS,
    // No automatic recaps while the terminal is unfocused (each one is a model request); /recap still works.
    { key: 'auto_recap', value: false, table: 'tui', why: 'no background recap requests' },
  ];
  const codexBaseline = {
    id: 'codex-baseline', host: 'codex', mirrors: 'baseline', title: 'Codex config baseline (~/.codex/config.toml)', evidence: 'none',
    plan: 'config.toml: add (never override) model_reasoning_effort="medium", model_verbosity="low", personality="none", [agents] default_subagent_reasoning_effort="medium", [tui] auto_recap=false; --codex-model NAME also sets model; backup first',
    detect(ctx) {
      if (!ctx.codexPaths) return other('no Codex config directory (sandboxed run without --codex-home)');
      const t = cfg.readText(ctx.codexPaths.config) || '';
      const missing = codexKeysWanted(ctx).filter(k => toml.get(t, k.key, k.table) === undefined);
      return missing.length ? { state: 'partial', detail: `${missing.length} key(s) not set: ${missing.map(k => k.key).join(', ')}` } : { state: 'ok', detail: 'all baseline keys present' };
    },
    install(ctx) {
      if (!ctx.codexPaths) throw new Error('the Codex config directory is unknown (sandboxed run needs --codex-home DIR)');
      const added = [];
      editText(ctx, ctx.codexPaths.config, t => {
        let cur = t;
        for (const k of codexKeysWanted(ctx)) {
          const newTable = !!k.table && !toml.hasTable(cur, k.table);
          const r = toml.setIfAbsent(cur, k.key, k.value, k.table);
          if (r.changed) { added.push({ key: k.key, value: k.value, table: k.table, newTable }); cur = r.text; }
        }
        return cur;
      });
      ctx.log.info(`codex baseline: ${added.length} key(s) added${added.length ? ` (${added.map(a => a.key).join(', ')})` : ''}`);
      if (!ctx.dry && added.length) record(ctx, 'codex-baseline', { keys: [...(rec(ctx, 'codex-baseline').keys || []), ...added] });
    },
    update(ctx) { if (ctx.codexPaths) codexBaseline.install(ctx); },
    uninstall(ctx) {
      if (!ctx.codexPaths) return;
      const keys = rec(ctx, 'codex-baseline').keys || [];
      let n = 0;
      editText(ctx, ctx.codexPaths.config, t => {
        let cur = t;
        for (const k of keys) { const r = toml.removeIfEqual(cur, k.key, k.value, k.table); if (r.changed) { n++; cur = r.text; } }
        for (const k of keys) if (k.newTable) cur = toml.removeTableIfEmpty(cur, k.table).text;
        return cur;
      });
      ctx.log.info(`codex baseline: ${n} key(s) removed (only those still holding the value askai set)`);
      if (!ctx.dry) record(ctx, 'codex-baseline', { keys: [] });
    },
  };

  const codexRtkHooked = ctx => {
    const p = ctx.codexPaths;
    return [p.config, p.hooks, p.agentsMd].some(f => /\brtk\b/i.test(cfg.readText(f) || '')) || fs.existsSync(p.rtkMd);
  };
  const codexEnv = ctx => (ctx.opts.codexHome ? { env: { ...ctx.env, CODEX_HOME: ctx.codexPaths.home } } : {});
  const codexRtk = {
    id: 'codex-rtk', host: 'codex', mirrors: 'rtk', title: 'RTK for Codex (shell output compression hook)', evidence: 'reported',
    plan: "install rtk if missing; `rtk init -g --codex` (RTK's own PreToolUse hook + awareness note for Codex); backup first",
    detect(ctx) {
      if (!ctx.codexPaths) return other('no Codex config directory (sandboxed run without --codex-home)');
      if (!ctx.which('rtk')) return { state: 'missing', detail: 'rtk not on PATH' };
      return codexRtkHooked(ctx) ? { state: 'ok', detail: `RTK wired for Codex in ${ctx.codexPaths.home}` } : { state: 'partial', detail: 'rtk installed, not wired for Codex' };
    },
    install(ctx) {
      if (!ctx.codexPaths) throw new Error('the Codex config directory is unknown (sandboxed run needs --codex-home DIR)');
      h.ensureRtk(ctx);
      if (codexRtkHooked(ctx)) return;
      for (const f of [ctx.codexPaths.config, ctx.codexPaths.hooks, ctx.codexPaths.agentsMd]) ctx.backup(f);
      const r = ctx.act('rtk init -g --codex', 'rtk', ['init', '-g', '--codex'], { timeout: 120000, ...codexEnv(ctx) });
      if (!ctx.dry && !r.ok) throw new Error(`rtk init --codex failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      if (!ctx.dry) record(ctx, 'codex-rtk', { hook: true });
    },
    update(ctx) { if (ctx.codexPaths && rec(ctx, 'codex-rtk').hook && !ctx.dry && ctx.which('rtk') && !codexRtkHooked(ctx)) codexRtk.install(ctx); },
    uninstall(ctx) {
      if (!ctx.codexPaths || !ctx.which('rtk') || !codexRtkHooked(ctx)) return;
      if (!ctx.opts.force && !rec(ctx, 'codex-rtk').hook) { ctx.log.info('codex-rtk: not wired by askai, left in place (use --force to remove)'); return; }
      for (const f of [ctx.codexPaths.config, ctx.codexPaths.hooks, ctx.codexPaths.agentsMd]) ctx.backup(f);
      ctx.act('rtk init -g --codex --uninstall', 'rtk', ['init', '-g', '--codex', '--uninstall'], { timeout: 120000, ...codexEnv(ctx) });
    },
  };

  const CODEX_SERENA_ARGS = ['start-mcp-server', '--context', 'codex', '--project-from-cwd', '--open-web-dashboard', 'False'];
  const codexSerenaOn = ctx => toml.hasTable(cfg.readText(ctx.codexPaths.config) || '', 'mcp_servers.serena');
  const codexSerena = {
    id: 'codex-serena', host: 'codex', mirrors: 'serena', title: 'Serena for Codex (MCP server, --context codex)', evidence: 'unmeasured',
    plan: 'install Serena with uv if missing; `codex mcp add serena -- serena start-mcp-server --context codex --project-from-cwd` (dashboard off)',
    detect(ctx) {
      if (!ctx.codexPaths) return other('no Codex config directory (sandboxed run without --codex-home)');
      if (!h.serenaExe(ctx)) return { state: 'missing', detail: 'serena not installed' };
      return codexSerenaOn(ctx) ? { state: 'ok', detail: '[mcp_servers.serena] in config.toml' } : { state: 'partial', detail: 'serena installed, not registered with Codex' };
    },
    install(ctx) {
      if (!ctx.codexPaths) throw new Error('the Codex config directory is unknown (sandboxed run needs --codex-home DIR)');
      h.ensureSerenaTool(ctx);
      if (codexSerenaOn(ctx)) return;
      if (!ctx.which('codex')) {
        // No codex CLI on PATH (the IDE extension, or Codex not installed yet): write the same [mcp_servers.serena] table directly.
        const exe = h.serenaExe(ctx) || 'serena';
        editText(ctx, ctx.codexPaths.config, t => toml.setIfAbsent(toml.setIfAbsent(t, 'command', exe, 'mcp_servers.serena').text, 'args', CODEX_SERENA_ARGS, 'mcp_servers.serena').text);
        if (!ctx.dry) record(ctx, 'codex-serena', { mcp: true, toml: true, command: exe });
        return;
      }
      ctx.backup(ctx.codexPaths.config);
      const exe = h.serenaExe(ctx) || 'serena';
      const r = ctx.act('codex mcp add serena', 'codex', ['mcp', 'add', 'serena', '--', exe, ...CODEX_SERENA_ARGS], { timeout: 60000, ...codexEnv(ctx) });
      if (!ctx.dry && !r.ok) throw new Error(`codex mcp add serena failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      if (!ctx.dry) record(ctx, 'codex-serena', { mcp: true });
    },
    update() { /* the serena binary is upgraded by the serena component */ },
    uninstall(ctx) {
      if (!ctx.codexPaths || !codexSerenaOn(ctx)) return;
      if (!ctx.opts.force && !rec(ctx, 'codex-serena').mcp) { ctx.log.info('codex-serena: not registered by askai, left in place (use --force to remove)'); return; }
      const r0 = rec(ctx, 'codex-serena');
      if (r0.toml) {
        editText(ctx, ctx.codexPaths.config, t => { let cur = toml.removeIfEqual(t, 'args', CODEX_SERENA_ARGS, 'mcp_servers.serena').text; cur = toml.removeIfEqual(cur, 'command', r0.command, 'mcp_servers.serena').text; return toml.removeTableIfEmpty(cur, 'mcp_servers.serena').text; });
        if (!ctx.dry) record(ctx, 'codex-serena', { mcp: false, toml: false });
        return;
      }
      if (!ctx.which('codex')) { ctx.log.warn('codex CLI not found; remove [mcp_servers.serena] from config.toml by hand'); return; }
      ctx.backup(ctx.codexPaths.config);
      ctx.act('codex mcp remove serena', 'codex', ['mcp', 'remove', 'serena'], { timeout: 60000, ...codexEnv(ctx) });
    },
  };

  // ---- Antigravity ------------------------------------------------------------------------------------------------
  // useG1Credits: paid credits are spent automatically once a plan quota runs out when true (Antigravity CLI reference).
  const agyBaseline = {
    id: 'agy-baseline', host: 'agy', mirrors: 'baseline', title: 'Antigravity settings baseline (paid credits off)', evidence: 'none',
    plan: 'antigravity-cli/settings.json: add (never override) useG1Credits=false',
    detect(ctx) {
      if (!ctx.agyPaths) return other('no Antigravity config directory (sandboxed run without --agy-home)');
      let j = {}; try { j = cfg.readJson(ctx.agyPaths.cliSettings); } catch (e) { return { state: 'partial', detail: e.message }; }
      return 'useG1Credits' in j ? { state: j.useG1Credits === true ? 'partial' : 'ok', detail: `useG1Credits ${j.useG1Credits}` } : { state: 'partial', detail: 'useG1Credits not set' };
    },
    install(ctx) {
      if (!ctx.agyPaths) throw new Error('the Antigravity config directory is unknown (sandboxed run needs --agy-home DIR)');
      let added = false;
      ctx.editJson(ctx.agyPaths.cliSettings, j => { if (!('useG1Credits' in j)) { j.useG1Credits = false; added = true; } });
      if (!ctx.dry && added) record(ctx, 'agy-baseline', { keys: [{ key: 'useG1Credits', value: false }] });
    },
    update(ctx) { if (ctx.agyPaths) agyBaseline.install(ctx); },
    uninstall(ctx) {
      if (!ctx.agyPaths) return;
      for (const k of rec(ctx, 'agy-baseline').keys || []) ctx.editJson(ctx.agyPaths.cliSettings, j => { cfg.removeKey(j, k.key, k.value); });
      if (!ctx.dry) record(ctx, 'agy-baseline', { keys: [] });
    },
  };

  const agyRules = blockComponent('agy-rules', 'agy', 'Antigravity token rules + terse style (~/.gemini/GEMINI.md block)', ctx => ctx.agyPaths && ctx.agyPaths.rulesMd, 'GEMINI.md');

  const agyRtkOn = ctx => fs.existsSync(ctx.agyPaths.rtkPlugin);
  const agyRtk = {
    id: 'agy-rtk', host: 'agy', mirrors: 'rtk', title: 'RTK for Antigravity (plugin hook)', evidence: 'reported',
    plan: "install rtk if missing; `rtk init --agent antigravity --auto-patch` (RTK's own plugin in ~/.gemini/config/plugins/rtk)",
    detect(ctx) {
      if (!ctx.agyPaths) return other('no Antigravity config directory (sandboxed run without --agy-home)');
      if (!ctx.which('rtk')) return { state: 'missing', detail: 'rtk not on PATH' };
      return agyRtkOn(ctx) ? { state: 'ok', detail: `RTK plugin in ${ctx.agyPaths.rtkPlugin}` } : { state: 'partial', detail: 'rtk installed, no Antigravity plugin' };
    },
    install(ctx) {
      if (!ctx.agyPaths) throw new Error('the Antigravity config directory is unknown (sandboxed run needs --agy-home DIR)');
      h.ensureRtk(ctx);
      if (agyRtkOn(ctx)) return;
      if (ctx.opts.agyHome) ctx.log.warn('rtk init writes to the real ~/.gemini; --agy-home only changes where askai looks');
      const r = ctx.act('rtk init --agent antigravity --auto-patch', 'rtk', ['init', '--agent', 'antigravity', '--auto-patch'], { timeout: 120000 });
      if (!ctx.dry && !r.ok) throw new Error(`rtk init --agent antigravity failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
      if (!ctx.dry) record(ctx, 'agy-rtk', { hook: true });
    },
    update(ctx) { if (ctx.agyPaths && rec(ctx, 'agy-rtk').hook && !ctx.dry && ctx.which('rtk') && !agyRtkOn(ctx)) agyRtk.install(ctx); },
    uninstall(ctx) {
      if (!ctx.agyPaths || !ctx.which('rtk') || !agyRtkOn(ctx)) return;
      if (!ctx.opts.force && !rec(ctx, 'agy-rtk').hook) { ctx.log.info('agy-rtk: not wired by askai, left in place (use --force to remove)'); return; }
      ctx.act('rtk init -g --agent antigravity --uninstall', 'rtk', ['init', '-g', '--agent', 'antigravity', '--uninstall'], { timeout: 120000 });
    },
  };

  const AGY_SERENA_ARGS = ['start-mcp-server', '--context', 'ide', '--project-from-cwd', '--open-web-dashboard', 'False'];
  const agyServers = ctx => { try { const j = cfg.readJson(ctx.agyPaths.mcp); return isObj(j.mcpServers) ? j.mcpServers : {}; } catch (_) { return {}; } };
  const agySerena = {
    id: 'agy-serena', host: 'agy', mirrors: 'serena', title: 'Serena for Antigravity (MCP server)', evidence: 'unmeasured',
    plan: 'install Serena with uv if missing; add a "serena" entry to ~/.gemini/config/mcp_config.json (kept if one exists); backup first',
    detect(ctx) {
      if (!ctx.agyPaths) return other('no Antigravity config directory (sandboxed run without --agy-home)');
      if (!h.serenaExe(ctx)) return { state: 'missing', detail: 'serena not installed' };
      return agyServers(ctx).serena ? { state: 'ok', detail: `serena in ${ctx.agyPaths.mcp}` } : { state: 'partial', detail: 'serena installed, not in mcp_config.json' };
    },
    install(ctx) {
      if (!ctx.agyPaths) throw new Error('the Antigravity config directory is unknown (sandboxed run needs --agy-home DIR)');
      h.ensureSerenaTool(ctx);
      let added = false;
      ctx.editJson(ctx.agyPaths.mcp, j => {
        if (j.mcpServers === undefined) j.mcpServers = {};
        if (!isObj(j.mcpServers)) throw new Error(`${ctx.agyPaths.mcp}: "mcpServers" is not an object; askai will not overwrite it`);
        if (!j.mcpServers.serena) { j.mcpServers.serena = { command: h.serenaExe(ctx) || 'serena', args: AGY_SERENA_ARGS }; added = true; }
      });
      if (!ctx.dry && added) record(ctx, 'agy-serena', { mcp: true });
    },
    update() { /* the serena binary is upgraded by the serena component */ },
    uninstall(ctx) {
      if (!ctx.agyPaths || !agyServers(ctx).serena) return;
      if (!ctx.opts.force && !rec(ctx, 'agy-serena').mcp) { ctx.log.info('agy-serena: entry not added by askai, left in place (use --force to remove)'); return; }
      ctx.editJson(ctx.agyPaths.mcp, j => { if (isObj(j.mcpServers)) delete j.mcpServers.serena; });
    },
  };

  // ---- retired handoff launchers: cleanup for older installations ------------------------------------------------
  const handoff = {
    id: 'handoff', host: 'any', title: 'Retired handoff launcher cleanup', evidence: 'none',
    plan: 'remove only old AskAI-owned handoff launchers; use askai-cli for terminal commands',
    detect() { return { state: 'other', detail: 'retired; askai-cli is the only launcher' }; },
    install() { /* retired: installCommands removes recorded legacy launchers */ },
    update() { /* retired */ },
    uninstall(ctx) {
      const kept = [];
      for (const f of rec(ctx, 'handoff').files || []) {
        const cur = cfg.readText(f.path);
        if (cur == null) continue;
        if (sha(cur) !== f.sha && !ctx.opts.force) { ctx.log.warn(`${f.path} was edited after askai wrote it, left in place`); kept.push(f); continue; }
        if (ctx.dry) { ctx.log.plan(`remove ${f.path}`); kept.push(f); continue; }
        ctx.backup(f.path);
        fs.rmSync(f.path, { force: true });
        const dir = path.dirname(f.path);
        try { if (path.basename(dir) === 'askai-handoff' && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch (_) { /* keep */ }
      }
      if (!ctx.dry) record(ctx, 'handoff', { files: kept });
    },
  };

  // ---- lean: three Claude Code settings that trade a convenience for tokens (opt-in) ----------------------------------
  const LEAN = [
    { key: 'promptSuggestionEnabled', value: false, why: 'no extra request after each reply for the grey prompt prediction' },
    { key: 'awaySummaryEnabled', value: false, why: 'no recap request when you come back to a session' },
    { key: 'crossSessionInbound', value: 'hold', why: 'a message from another session does not wake this one with its whole context' },
    { key: 'CLAUDE_CODE_GOAL_CHECKIN_MINUTES', value: '0', env: true, why: 'no idle goal check-ins that re-send the full context' },
    { key: 'bashOutputMaxChars', value: 15000, why: 'Bash output read back into context is capped at 15k characters instead of 30k' },
  ];
  // Reads that only burn tokens (and .env, which should never enter a chat). Merged from the first kit's settings.
  const LEAN_DENY = ['Read(./node_modules/**)', 'Read(./dist/**)', 'Read(./build/**)', 'Read(./out/**)', 'Read(./.next/**)',
    'Read(./coverage/**)', 'Read(./target/**)', 'Read(./vendor/**)', 'Read(**/*.min.js)', 'Read(**/*.map)', 'Read(**/package-lock.json)',
    'Read(**/yarn.lock)', 'Read(**/pnpm-lock.yaml)', 'Read(**/.env)', 'Read(**/.env.*)'];
  const denyOf = s => (s.permissions && Array.isArray(s.permissions.deny) ? s.permissions.deny : []);
  // --lean-git adds the one key that changes a feature people use (Claude's commit and PR help).
  const leanKeys = ctx => (ctx.opts.leanGit ? [...LEAN, { key: 'includeGitInstructions', value: false, why: 'no commit/PR instructions or git status snapshot in every turn' }] : LEAN);
  const lean = {
    id: 'lean', host: 'claude', title: 'Lean Claude Code settings (idle drains off, Bash output cap, deny-read rules)', evidence: 'none',
    plan: 'settings.json: add (never override) promptSuggestionEnabled=false, awaySummaryEnabled=false, crossSessionInbound=hold, CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0, bashOutputMaxChars=15000, deny Read() of node_modules/build/lockfiles/.env; --lean-git also includeGitInstructions=false',
    detect(ctx) {
      const s = ctx.settings();
      const has = k => (k.env ? !!(s.env && k.key in s.env) : k.key in s);
      const LEAN_NOW = leanKeys(ctx);
      const missing = LEAN_NOW.filter(k => !has(k)).length + LEAN_DENY.filter(d => !denyOf(s).includes(d)).length;
      const total = LEAN_NOW.length + LEAN_DENY.length;
      return missing === total ? { state: 'missing', detail: 'none of the lean keys or deny rules set' }
        : missing ? { state: 'partial', detail: `${missing} of ${total} lean keys / deny rules not set` } : { state: 'ok', detail: 'lean keys and deny rules present' };
    },
    install(ctx) {
      const added = [];
      const denied = [];
      ctx.editSettings(s => {
        for (const k of leanKeys(ctx)) {
          if (k.env) {
            if (s.env !== undefined && (typeof s.env !== 'object' || Array.isArray(s.env))) throw new Error('settings.json "env" is not an object; askai will not overwrite it');
            s.env = s.env || {};
            if (!(k.key in s.env)) { s.env[k.key] = k.value; added.push({ key: `env.${k.key}`, value: k.value }); }
          } else if (!(k.key in s)) { s[k.key] = k.value; added.push({ key: k.key, value: k.value }); }
        }
        if (s.permissions !== undefined && (typeof s.permissions !== 'object' || Array.isArray(s.permissions))) throw new Error('settings.json "permissions" is not an object; askai will not overwrite it');
        s.permissions = s.permissions || {};
        if (s.permissions.deny !== undefined && !Array.isArray(s.permissions.deny)) throw new Error('settings.json "permissions.deny" is not a list; askai will not overwrite it');
        s.permissions.deny = s.permissions.deny || [];
        for (const d of LEAN_DENY) if (!s.permissions.deny.includes(d)) { s.permissions.deny.push(d); denied.push(d); }
        if (!s.permissions.deny.length) delete s.permissions.deny;
        if (!Object.keys(s.permissions).length) delete s.permissions;
      });
      ctx.log.info(`lean: ${added.length} key(s) and ${denied.length} deny rule(s) added`);
      if (!ctx.dry && (added.length || denied.length)) record(ctx, 'lean', { keys: [...(rec(ctx, 'lean').keys || []), ...added], deny: [...(rec(ctx, 'lean').deny || []), ...denied] });
    },
    update() { /* nothing to upgrade */ },
    uninstall(ctx) {
      const keys = rec(ctx, 'lean').keys || [];
      let n = 0;
      const deny = rec(ctx, 'lean').deny || [];
      ctx.editSettings(s => {
        for (const k of keys) if (cfg.removeKey(s, k.key, k.value)) n++;
        if (s.permissions && Array.isArray(s.permissions.deny)) {
          s.permissions.deny = s.permissions.deny.filter(d => !deny.includes(d));
          if (!s.permissions.deny.length) delete s.permissions.deny;
          if (!Object.keys(s.permissions).length) delete s.permissions;
        }
      });
      ctx.log.info(`lean: ${n} key(s) and ${deny.length} deny rule(s) removed`);
      if (!ctx.dry) record(ctx, 'lean', { keys: [], deny: [] });
    },
  };

  // ---- Antigravity path-scoped rules: AskAI's code and document rules as glob-triggered modular global rules ----------
  // ~/.gemini/config/rules/*.md need YAML frontmatter; `trigger: glob` loads a rule only when the agent touches a matching file
  // (antigravity.google/docs/rules). Files carry askai's marker; a file without it is never overwritten or removed.
  const agyRuleDir = ctx => path.join(ctx.agyPaths.home, 'config', 'rules');
  const agyRuleFile = (ctx, kind) => path.join(agyRuleDir(ctx), `askai-${kind}.md`);
  const agyKinds = ctx => { try { return profiles.get(ctx.opts.profile || ctx.manifest.profile).rules; } catch (_) { return profiles.get().rules; } };
  function agyRuleText(ctx, kind) {
    const k = rulesLib.KINDS[kind];
    const present = [...presentFor(ctx, 'agy'), ...(h.uvToolExe(ctx, 'markitdown') ? ['markitdown'] : [])];
    const globs = k.globs.flatMap(rulesLib.expandBraces).join(', ');
    return ['---', 'trigger: glob', `globs: "${globs}"`, `description: "Token-saving rules for ${kind === 'coding' ? 'code files' : 'documents'} (askai)"`, '---', '',
      rulesLib.MDC_MARKER, '', `# ${kind === 'coding' ? 'Code files' : 'Documents'} (askai)`, ...k.lines(present).filter(Boolean), ''].join('\n');
  }
  const agyPathRules = {
    id: 'agy-path-rules', host: 'agy', mirrors: 'rules', title: 'Antigravity path-scoped rules (~/.gemini/config/rules, glob-triggered)', evidence: 'unmeasured',
    plan: 'writes ~/.gemini/config/rules/askai-<kind>.md with `trigger: glob` frontmatter, so a rule loads only when a matching file is touched',
    detect(ctx) {
      if (!ctx.agyPaths) return other('no Antigravity config directory (sandboxed run without --agy-home)');
      const kinds = agyKinds(ctx);
      if (!kinds.length) return { state: 'ok', detail: 'the profile has no path rules' };
      const bad = kinds.filter(kd => (cfg.readText(agyRuleFile(ctx, kd)) || '') !== agyRuleText(ctx, kd));
      return bad.length ? { state: 'partial', detail: `${bad.length} rule file(s) missing or outdated` } : { state: 'ok', detail: `${kinds.join(' + ')} rules in ${agyRuleDir(ctx)}` };
    },
    install(ctx) {
      if (!ctx.agyPaths) throw new Error('the Antigravity config directory is unknown (sandboxed run needs --agy-home DIR)');
      const wanted = agyKinds(ctx);
      for (const kind of Object.keys(rulesLib.KINDS)) {
        const f = agyRuleFile(ctx, kind);
        const cur = cfg.readText(f);
        const ours = cur != null && cur.includes(rulesLib.MDC_MARKER);
        if (!wanted.includes(kind)) {
          if (ours) { if (ctx.dry) ctx.log.plan(`remove ${f}`); else { ctx.backup(f); fs.rmSync(f, { force: true }); } }
          continue;
        }
        const text = agyRuleText(ctx, kind);
        if (cur === text) continue;
        if (cur != null && !ours && !ctx.opts.force) { ctx.log.warn(`${f} exists and was not written by askai; left in place (use --force)`); continue; }
        if (ctx.dry) { ctx.log.plan(`write ${f}`); continue; }
        ctx.backup(f);
        cfg.writeAtomic(f, text);
      }
      if (!ctx.dry) record(ctx, 'agy-path-rules', { kinds: wanted });
    },
    update(ctx) { if (ctx.agyPaths && rec(ctx, 'agy-path-rules').kinds) agyPathRules.install(ctx); },
    uninstall(ctx) {
      if (!ctx.agyPaths) return;
      for (const kind of Object.keys(rulesLib.KINDS)) {
        const f = agyRuleFile(ctx, kind);
        const cur = cfg.readText(f);
        if (cur == null || !cur.includes(rulesLib.MDC_MARKER)) continue;
        if (ctx.dry) { ctx.log.plan(`remove ${f}`); continue; }
        ctx.backup(f);
        fs.rmSync(f, { force: true });
      }
      if (!ctx.dry) record(ctx, 'agy-path-rules', { kinds: [] });
    },
  };

  // ---- Code intelligence: Claude Code's official LSP plugins (code.claude.com/docs/en/plugins/code-intelligence) ----------
  // A "go to definition" call replaces a grep plus several candidate file reads; one third-party benchmark measured LSP
  // navigation at -13% cost (Marmelab, via cc.bruniaux.com/token-savings). Opt-in: --lsp ts,py,kotlin,ruby,swift.
  const LSP = {
    ts: { plugin: 'typescript-lsp', bin: 'typescript-language-server', npm: ['typescript-language-server', 'typescript'] },
    py: { plugin: 'pyright-lsp', bin: 'pyright-langserver', npm: ['pyright'] },
    kotlin: { plugin: 'kotlin-lsp', bin: 'kotlin-lsp' },
    ruby: { plugin: 'ruby-lsp', bin: 'ruby-lsp' },
    swift: { plugin: 'swift-lsp', bin: 'sourcekit-lsp' },
  };
  const LSP_ALIAS = { typescript: 'ts', javascript: 'ts', js: 'ts', python: 'py', kt: 'kotlin', rb: 'ruby' };
  const lspLangs = ctx => {
    const raw = typeof ctx.opts.lsp === 'string' ? ctx.opts.lsp : '';
    const langs = raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).map(x => LSP_ALIAS[x] || x);
    for (const l of langs) if (!LSP[l]) throw new Error(`--lsp: unknown language "${l}" (known: ${Object.keys(LSP).join(', ')})`);
    return [...new Set(langs)];
  };
  const OFFICIAL = 'claude-plugins-official';
  const codeIntel = {
    id: 'code-intel', host: 'claude', title: "Code intelligence (Claude Code's official LSP plugins)", evidence: 'none', optIn: true, optInFlag: 'lsp',
    plan: 'for each --lsp language: install its language server (npm for ts and py) and `claude plugin install <lang>-lsp@claude-plugins-official`',
    detect(ctx) {
      const plugins = [...new Set([...(rec(ctx, 'code-intel').plugins || []), ...lspLangs(ctx).map(l => LSP[l].plugin)])];
      if (!plugins.length) return { state: 'missing', detail: 'no language chosen (--lsp ts,py)' };
      const off = plugins.filter(pl => h.pluginState(ctx, pl) !== 'enabled');
      return off.length ? { state: 'partial', detail: `not enabled: ${off.join(', ')}` } : { state: 'ok', detail: `enabled: ${plugins.join(', ')}` };
    },
    install(ctx) {
      const langs = lspLangs(ctx);
      if (!langs.length) throw new Error('name the languages, for example --lsp ts,py');
      const done = [...(rec(ctx, 'code-intel').plugins || [])];
      for (const l of langs) {
        const spec = LSP[l];
        if (!ctx.which(spec.bin)) {
          if (spec.npm && ctx.which('npm')) {
            const r = ctx.act(`npm install -g ${spec.npm.join(' ')}`, 'npm', ['install', '-g', ...spec.npm], { timeout: 600000 });
            if (!ctx.dry && !r.ok) throw new Error(`npm install -g ${spec.npm.join(' ')} failed: ${firstLine(r.stderr || r.stdout || r.error)}`);
          } else ctx.log.warn(`${spec.bin} not found: install the ${l} language server yourself (see the ${spec.plugin} README), the plugin needs it`);
        }
        h.addPlugin(ctx, 'anthropics/claude-plugins-official', OFFICIAL, spec.plugin);
        if (!done.includes(spec.plugin)) done.push(spec.plugin);
      }
      if (!ctx.dry) record(ctx, 'code-intel', { plugins: done, installedByAskai: true });
    },
    update() { /* plugins update with `claude plugin update`; language servers with npm */ },
    uninstall(ctx) {
      const claudeBin = ctx.claudeBin();
      for (const pl of rec(ctx, 'code-intel').plugins || []) {
        if (claudeBin) ctx.act(`uninstall plugin ${pl}@${OFFICIAL}`, claudeBin, ['plugin', 'uninstall', `${pl}@${OFFICIAL}`], { timeout: 120000 });
      }
      if (!ctx.dry) record(ctx, 'code-intel', { plugins: [], installedByAskai: false });
    },
  };

  // ---- token-kit: take over a previous run of the standalone script -----------------------------------------------
  // standalone/token-setup.mjs applies the same settings with its own marked blocks and handoff files. Running both would
  // load the token rules twice, so when its state file exists AskAI runs its --uninstall first (it removes only what it
  // added, with backups) and then installs the same settings under AskAI's manifest.
  const tokenKitHome = ctx => {
    if (!ctx.opts.claudeHome) return os.homedir();
    const ch = path.resolve(ctx.opts.claudeHome);
    return path.basename(ch) === '.claude' ? path.dirname(ch) : null; // sandbox layouts other than <home>/.claude: not applicable
  };
  const tokenKitState = ctx => { const h = tokenKitHome(ctx); const f = h && path.join(h, '.token-kit', 'state.json'); return f && fs.existsSync(f) ? f : null; };
  const tokenKit = {
    id: 'token-kit', host: 'any', title: 'Take over a previous run of the standalone token-setup script', evidence: 'none',
    plan: 'only if ~/.token-kit/state.json exists: run standalone/token-setup.mjs --uninstall (removes its keys, rule blocks and handoff files, with backups), so AskAI applies the same settings once and the rules load once',
    detect(ctx) { const st = tokenKitState(ctx); return st ? { state: 'partial', detail: `token-setup ran here (${st}); AskAI takes over its settings` } : other('token-setup not used on this machine'); },
    install(ctx) {
      if (!tokenKitState(ctx)) return;
      const script = path.join(__dirname, '..', 'standalone', 'token-setup.mjs');
      if (!fs.existsSync(script)) throw new Error('standalone/token-setup.mjs is missing next to askai; run askai from a full checkout');
      const home = tokenKitHome(ctx);
      if (ctx.dry) { ctx.log.plan(`node standalone/token-setup.mjs --uninstall --home ${home}`); return; }
      const r = require('child_process').spawnSync(process.execPath, [script, '--uninstall', '--home', home], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`token-setup --uninstall failed: ${String(r.stderr || r.stdout).trim().split(/\r?\n/).pop()}`);
    },
    update(ctx) { tokenKit.install(ctx); },
    uninstall() { /* nothing of its own to remove */ },
  };

  // ---- prompt-hooks: in-session reminders that cost no tokens --------------------------------------------------------
  // SessionStart and UserPromptSubmit run `askai hook`, which answers only with systemMessage: Claude Code shows it to you and
  // does not add it to the model's context. Context at 60% / 80%, every 20 prompts, peak hours, a stale handoff, a cache miss.
  const HOOK_RE = /askai\.js"? hook (prompt|session)\b/;
  const hookCmd = (ctx, kind) => `node "${path.join(ctx.paths.app, 'askai.js').replace(/\\/g, '/')}" hook ${kind}`;
  const promptHooks = {
    id: 'prompt-hooks', host: 'claude', title: 'In-session reminders (zero-token Claude Code hooks)', evidence: 'none',
    plan: 'settings.json hooks: SessionStart and UserPromptSubmit -> `askai hook` (one-line reminders shown only to you: context at 60% and 80%, long sessions, peak hours, stale handoff, cache misses; nothing is added to the model\'s context)',
    detect(ctx) {
      const hs = cfg.listHooks(ctx.settings());
      const n = ['SessionStart', 'UserPromptSubmit'].filter(ev => hs.some(h => h.event === ev && HOOK_RE.test(h.command))).length;
      return n === 2 ? { state: 'ok', detail: 'reminders on' } : { state: n ? 'partial' : 'missing', detail: `${n} of 2 reminder hooks` };
    },
    install(ctx) {
      ctx.editSettings(st => {
        st.hooks = st.hooks && typeof st.hooks === 'object' && !Array.isArray(st.hooks) ? st.hooks : {};
        for (const [ev, kind] of [['SessionStart', 'session'], ['UserPromptSubmit', 'prompt']]) {
          const groups = Array.isArray(st.hooks[ev]) ? st.hooks[ev] : (st.hooks[ev] = []);
          if (!groups.some(g => (g.hooks || []).some(h => HOOK_RE.test(h.command || '')))) groups.push({ hooks: [{ type: 'command', command: hookCmd(ctx, kind), timeout: 5 }] });
        }
      });
      if (!ctx.dry) record(ctx, 'prompt-hooks', { on: true });
    },
    update(ctx) { promptHooks.install(ctx); },
    uninstall(ctx) { ctx.editSettings(st => { cfg.removeHooks(st, HOOK_RE); }); if (!ctx.dry) record(ctx, 'prompt-hooks', { on: false }); },
  };

  // ---- base-tools: the command-line tools agents search and inspect with (opt-in: --base-tools) -----------------------
  // rg for search, jq for JSON, gh instead of a GitHub MCP server. Cheaper than reading whole files or loading MCP tool lists.
  const BASE_TOOLS = [['rg', 'BurntSushi.ripgrep.MSVC'], ['jq', 'jqlang.jq'], ['gh', 'GitHub.cli']];
  const baseTools = {
    id: 'base-tools', host: 'any', optIn: true, optInFlag: 'baseTools', title: 'Base command-line tools (ripgrep, jq, gh)', evidence: 'none',
    plan: 'winget install BurntSushi.ripgrep.MSVC, winget install jqlang.jq, winget install GitHub.cli, each only if missing',
    detect(ctx) { const miss = BASE_TOOLS.filter(([b]) => !ctx.which(b)).map(([b]) => b); return miss.length ? { state: miss.length === 3 ? 'missing' : 'partial', detail: `missing: ${miss.join(', ')}` } : { state: 'ok', detail: 'rg, jq and gh on PATH' }; },
    install(ctx) {
      const pkg = require('./pkg'); const added = [];
      for (const [b, id] of BASE_TOOLS) if (!ctx.which(b)) { pkg.install(ctx, id, () => !!ctx.which(b)); added.push(id); }
      if (!ctx.dry && added.length) record(ctx, 'base-tools', { installedByAskai: true, ids: [...new Set([...(rec(ctx, 'base-tools').ids || []), ...added])] });
    },
    update(ctx) { const pkg = require('./pkg'); for (const id of rec(ctx, 'base-tools').ids || []) pkg.upgrade(ctx, id); },
    uninstall(ctx) { if (!ctx.opts.tools) return; const pkg = require('./pkg'); for (const id of rec(ctx, 'base-tools').ids || []) pkg.uninstall(ctx, id); },
  };

  // ---- MCP servers wired into every tool in play: Headroom (MCP mode), Context7 ------------------------------------------
  // JSON for Claude Code (~/.claude.json, user scope), Cursor and Antigravity; a [mcp_servers.NAME] table for Codex. Each entry
  // is added only when absent and recorded per tool, so uninstall removes only what AskAI added.
  const inPlay = ctx => { const hs = ctx.hostSel || {}; const all = !ctx.hostSel;
    return { claude: all || !!hs.claude, cursor: (all || !!hs.cursor) && !!ctx.cursorPaths, codex: (all || !!hs.codex) && !!ctx.codexPaths, agy: (all || !!hs.agy) && !!ctx.agyPaths }; };
  const jsonFile = (ctx, t) => (t === 'claude' ? ctx.paths.userJson : t === 'cursor' ? ctx.cursorPaths.mcp : ctx.agyPaths.mcp);
  function wireMcp(ctx, id, name, command, args) {
    const p = inPlay(ctx); const added = [];
    for (const t of ['claude', 'cursor', 'agy']) {
      if (!p[t]) continue; let had = false;
      ctx.editJson(jsonFile(ctx, t), j => { j.mcpServers = j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {}; if (j.mcpServers[name]) { had = true; return; } j.mcpServers[name] = { command, args }; });
      if (!had) added.push(t);
    }
    if (p.codex) {
      const before = cfg.readText(ctx.codexPaths.config) || '';
      if (!toml.hasTable(before, `mcp_servers.${name}`)) { editText(ctx, ctx.codexPaths.config, t => toml.setIfAbsent(toml.setIfAbsent(t, 'command', command, `mcp_servers.${name}`).text, 'args', args, `mcp_servers.${name}`).text); added.push('codex'); }
    }
    if (!ctx.dry) record(ctx, id, { hosts: [...new Set([...(rec(ctx, id).hosts || []), ...added])], command, args });
    return added;
  }
  function unwireMcp(ctx, id, name) {
    const r = rec(ctx, id);
    for (const t of r.hosts || []) {
      if (t === 'codex') { if (ctx.codexPaths) editText(ctx, ctx.codexPaths.config, x => { let c = toml.removeIfEqual(x, 'args', r.args, `mcp_servers.${name}`).text; c = toml.removeIfEqual(c, 'command', r.command, `mcp_servers.${name}`).text; return toml.removeTableIfEmpty(c, `mcp_servers.${name}`).text; }); continue; }
      if ((t === 'cursor' && !ctx.cursorPaths) || (t === 'agy' && !ctx.agyPaths)) continue;
      ctx.editJson(jsonFile(ctx, t), j => { if (j.mcpServers && j.mcpServers[name] && j.mcpServers[name].command === r.command) delete j.mcpServers[name]; });
    }
    if (!ctx.dry) record(ctx, id, { hosts: [] });
  }
  function mcpState(ctx, name) {
    const p = inPlay(ctx); const want = Object.keys(p).filter(k => p[k]); const have = [];
    for (const t of want) {
      if (t === 'codex') { if (toml.hasTable(cfg.readText(ctx.codexPaths.config) || '', `mcp_servers.${name}`)) have.push(t); continue; }
      let j = {}; try { j = cfg.readJson(jsonFile(ctx, t)); } catch (_) { /* unreadable */ }
      if (j.mcpServers && j.mcpServers[name]) have.push(t);
    }
    return { want, have };
  }
  // A Python CLI installed as a uv tool (uv is installed first when missing).
  function ensureUvTool(ctx, spec, bin) {
    if (ctx.which(bin)) return ctx.which(bin);
    require('./pkg').install(ctx, 'astral-sh.uv', () => !!ctx.which('uv'));
    const r = ctx.act(`uv tool install ${spec}`, ctx.which('uv') || 'uv', ['tool', 'install', '--python', '3.13', spec], { inherit: true, timeout: 900000 });
    if (!ctx.dry && !r.ok) throw new Error(`uv tool install ${spec} failed (exit ${r.status})`);
    ctx.refreshPath();
    return ctx.which(bin) || path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? `${bin}.exe` : bin);
  }
  const mcpComponent = (id, name, title, evidence, plan, getCmd, extraUninstall) => {
    const comp = {
      id, host: 'any', optIn: true, optInFlag: id, title, evidence, plan,
      detect(ctx) {
        const { want, have } = mcpState(ctx, name);
        if (!want.length) return other('no tool in play');
        return have.length === want.length ? { state: 'ok', detail: `registered in ${have.join(', ')}` } : { state: have.length ? 'partial' : 'missing', detail: `registered in ${have.join(', ') || 'none'} of ${want.join(', ')}` };
      },
      install(ctx) { const [cmd, args] = getCmd(ctx); const added = wireMcp(ctx, id, name, cmd, args); ctx.log.info(`${name}: ${added.length ? `registered in ${added.join(', ')}` : 'already registered'}`); },
      update(ctx) { if (rec(ctx, id).hosts && rec(ctx, id).hosts.length) comp.install(ctx); },
      uninstall(ctx) { unwireMcp(ctx, id, name); if (extraUninstall) extraUninstall(ctx); },
    };
    return comp;
  };
  const headroom = mcpComponent('headroom', 'headroom', 'Headroom (MCP mode: on-demand compression tools, no proxy)', 'reported',
    'uv tool install --python 3.13 "headroom-ai[mcp]" if missing; register `headroom mcp serve` as an MCP server in Claude Code, Codex, Cursor and Antigravity (headroom_compress, headroom_retrieve, headroom_stats). Proxy mode is NOT set up: it can move Claude Code to API billing',
    ctx => [ensureUvTool(ctx, 'headroom-ai[mcp]', 'headroom'), ['mcp', 'serve']],
    ctx => { if (ctx.opts.tools && ctx.which('uv')) ctx.act('uv tool uninstall headroom-ai', 'uv', ['tool', 'uninstall', 'headroom-ai'], { timeout: 300000 }); });
  const context7 = mcpComponent('context7', 'context7', 'Context7 (current library docs over MCP)', 'none',
    'register `npx -y @upstash/context7-mcp` as an MCP server in Claude Code, Codex, Cursor and Antigravity (needs Node.js; the agent calls it only for library docs)',
    () => ['npx', ['-y', '@upstash/context7-mcp']]);

  // ---- graphify: knowledge-graph skill for each tool in play -----------------------------------------------------------
  const GRAPHIFY_PLATFORM = { claude: 'claude', codex: 'codex', cursor: 'cursor', agy: 'antigravity' };
  const graphify = {
    id: 'graphify', host: 'any', optIn: true, optInFlag: 'graphify', title: 'Graphify (code knowledge graph skill)', evidence: 'claims',
    plan: 'uv tool install graphifyy if missing; `graphify install --platform claude|codex|cursor|antigravity` for each tool in play (its skill, a rule and, in Claude Code, a search hook). The Cursor rule is left off for ordinary turns. Build a project graph once with graphify update . (source only, no tokens). /graphify . also reads docs and images and spends tokens.',
    detect(ctx) {
      if (!ctx.which('graphify')) return { state: 'missing', detail: 'graphify not installed' };
      const done = (rec(ctx, 'graphify').platforms || []);
      const want = Object.entries(inPlay(ctx)).filter(([, v]) => v).map(([k]) => k);
      return want.every(t => done.includes(t)) ? { state: 'ok', detail: `skill registered for ${done.join(', ')}` } : { state: 'partial', detail: `registered for ${done.join(', ') || 'none'} of ${want.join(', ')}` };
    },
    install(ctx) {
      const exe = ensureUvTool(ctx, 'graphifyy', 'graphify');
      const done = new Set(rec(ctx, 'graphify').platforms || []);
      for (const [t, on] of Object.entries(inPlay(ctx))) {
        if (!on || done.has(t)) continue;
        if (ctx.sandbox && !ctx.dry) { ctx.log.info(`graphify ${GRAPHIFY_PLATFORM[t]}: skipped in a sandboxed run (graphify writes to your real home folder)`); continue; }
        const r = ctx.act(`graphify install --platform ${GRAPHIFY_PLATFORM[t]}`, exe, ['install', '--platform', GRAPHIFY_PLATFORM[t]], { timeout: 300000 });
        if (!ctx.dry && !r.ok) { ctx.log.warn(`graphify install --platform ${GRAPHIFY_PLATFORM[t]} failed (exit ${r.status})`); continue; }
        done.add(t);
      }
      if (!ctx.dry) record(ctx, 'graphify', { installedByAskai: true, platforms: [...done] });
      const ruleFiles = [];
      if (ctx.cursorPaths) ruleFiles.push(path.join(ctx.cursorPaths.home, 'rules', 'graphify.mdc'));
      if (ctx.opts && ctx.opts.project) ruleFiles.push(path.join(ctx.opts.project, '.cursor', 'rules', 'graphify.mdc'));
      for (const f of ruleFiles) {
        if (require('./cursor').scopeGraphifyRule(f, ctx.dry)) ctx.log.info(`graphify rule: ${f} is no longer always on. Use graphify query when a question is about how parts connect.`);
      }
    },
    update(ctx) { if (ctx.which('uv') && rec(ctx, 'graphify').installedByAskai) ctx.act('uv tool upgrade graphifyy', 'uv', ['tool', 'upgrade', 'graphifyy'], { timeout: 300000 }); },
    uninstall(ctx) {
      ctx.log.info('graphify: its skills, rules and hook stay until you remove them with graphify\'s own commands; --tools also removes the CLI');
      if (ctx.opts.tools && ctx.which('uv')) ctx.act('uv tool uninstall graphifyy', 'uv', ['tool', 'uninstall', 'graphifyy'], { timeout: 300000 });
      if (!ctx.dry) record(ctx, 'graphify', { platforms: [] });
    },
  };

  // ---- repomix (CLI only, used on demand), claude-mem (Claude Code plugin), codebase-memory-mcp (MCP code index) ------------
  const npmCli = (id, pkgName, bin, title, evidence, plan) => {
    const comp = {
      id, host: 'any', optIn: true, optInFlag: id.replace(/-([a-z])/g, (m, c) => c.toUpperCase()), title, evidence, plan,
      detect(ctx) { return ctx.which(bin) ? { state: 'ok', detail: `${bin} on PATH` } : { state: 'missing', detail: `${bin} not installed` }; },
      install(ctx) {
        if (ctx.which(bin)) return;
        if (!ctx.which('npm') && !ctx.dry) throw new Error('npm not found: install Node.js first');
        const r = ctx.act(`npm install -g ${pkgName}`, 'npm', ['install', '-g', pkgName], { inherit: true, timeout: 600000 });
        if (!ctx.dry && !r.ok) throw new Error(`npm install -g ${pkgName} failed (exit ${r.status})`);
        ctx.refreshPath(); if (!ctx.dry) record(ctx, id, { installedByAskai: true });
      },
      update(ctx) { if (rec(ctx, id).installedByAskai) ctx.act(`npm update -g ${pkgName}`, 'npm', ['update', '-g', pkgName], { timeout: 600000 }); },
      uninstall(ctx) { if (ctx.opts.tools && rec(ctx, id).installedByAskai) ctx.act(`npm uninstall -g ${pkgName}`, 'npm', ['uninstall', '-g', pkgName], { timeout: 300000 }); },
    };
    return comp;
  };
  const repomix = npmCli('repomix', 'repomix', 'repomix', 'Repomix (repository snapshot CLI, used on demand)', 'none',
    'npm install -g repomix if missing; nothing loads into sessions; use it for handovers between tools: repomix --compress --include "src/**"');
  const cbm = npmCli('codebase-memory', 'codebase-memory-mcp', 'codebase-memory-mcp', 'codebase-memory-mcp (code knowledge-graph MCP server)', 'claims',
    'npm install -g codebase-memory-mcp if missing; register it as an MCP server in Claude Code, Codex, Cursor and Antigravity; askai init indexes each repository with it (local, no model)');
  const cbmInstall = cbm.install; const cbmUninstall = cbm.uninstall;
  cbm.install = ctx => { cbmInstall(ctx); const exe = ctx.which('codebase-memory-mcp') || 'codebase-memory-mcp'; const added = wireMcp(ctx, 'codebase-memory', 'codebase-memory-mcp', exe, []); ctx.log.info(`codebase-memory-mcp: ${added.length ? `registered in ${added.join(', ')}` : 'already registered'}`); };
  cbm.detect = ctx => { const { want, have } = mcpState(ctx, 'codebase-memory-mcp'); if (!ctx.which('codebase-memory-mcp')) return { state: 'missing', detail: 'not installed' }; return have.length === want.length ? { state: 'ok', detail: `registered in ${have.join(', ')}` } : { state: 'partial', detail: `registered in ${have.join(', ') || 'none'} of ${want.join(', ')}` }; };
  cbm.uninstall = ctx => { unwireMcp(ctx, 'codebase-memory', 'codebase-memory-mcp'); cbmUninstall(ctx); };
  const claudeMem = {
    id: 'claude-mem', host: 'claude', optIn: true, optInFlag: 'claudeMem', title: 'claude-mem (session memory plugin)', evidence: 'none',
    plan: 'claude plugin marketplace add thedotmack/claude-mem; claude plugin install claude-mem@thedotmack (hooks plus a background worker that summarises sessions with Claude, which uses your plan)',
    detect(ctx) { const st = h.pluginState(ctx, 'claude-mem'); return st === 'enabled' ? { state: 'ok', detail: 'plugin enabled' } : { state: 'missing', detail: `plugin ${st}` }; },
    install(ctx) { if (h.pluginState(ctx, 'claude-mem') === 'enabled') return; h.addPlugin(ctx, 'thedotmack/claude-mem', 'thedotmack', 'claude-mem'); if (!ctx.dry) record(ctx, 'claude-mem', { installedByAskai: true }); },
    update() { /* the marketplace updates it */ },
    uninstall(ctx) { if (!rec(ctx, 'claude-mem').installedByAskai) return; const bin = ctx.claudeBin(); if (bin) ctx.act('claude plugin uninstall claude-mem@thedotmack', bin, ['plugin', 'uninstall', 'claude-mem@thedotmack'], { timeout: 120000 }); if (!ctx.dry) record(ctx, 'claude-mem', { installedByAskai: false }); },
  };

  lean.leanKeys = LEAN; lean.leanDeny = LEAN_DENY; // read by scripts/gen-docs.js
  return [tokenKit, baseTools, headroom, context7, graphify, repomix, cbm, claudeMem, promptHooks, codexBaseline, codexRules, codexRtk, codexSerena, agyBaseline, agyRules, agyRtk, agySerena, agyPathRules, handoff, lean, codeIntel];
}

module.exports = {
  make, codexPaths, agyPaths, defaultCodexHome, defaultAgyHome, codexPresent, agyPresent, HANDOFF_PROMPT, SKILL_MD, CURSOR_COMMAND,
  CODEX_HOSTED: ['codex-baseline', 'codex-rules', 'codex-rtk', 'codex-serena'], AGY_HOSTED: ['agy-baseline', 'agy-rules', 'agy-rtk', 'agy-serena', 'agy-path-rules'],
};
