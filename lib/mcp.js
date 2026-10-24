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
    const m = /^\s*\[mcp_servers\.(?:"([^"]+)"|([a-zA-Z0-9_-]+))\s*\]\s*$/.exec(l);
    if (!m) return;
    const name = m[1] || m[2];
    let end = lines.findIndex((x, j) => j > i && /^\s*\[/.test(x)); if (end < 0) end = lines.length;
    const body = lines.slice(i + 1, end);
    out.push({ name, start: i, end, enabled: !body.some(x => /^\s*enabled\s*=\s*false\b/.test(x)) });
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
  const out = [
    'tool          server                  state',
    '------------  ----------------------  -----'
  ];
  for (const r of rows) out.push(`${(NAMES[r.tool] || r.tool).padEnd(12)}  ${r.name.padEnd(22)}  ${r.state}`);
  out.push('', 'Switch between sessions, not during one: askai mcp off <name> [--tool T]   askai mcp on <name> [--tool T]',
    'Claude Code project servers (.mcp.json) and live connection status: /mcp inside the session. Calls each server got: askai infra.');
  return out.join('\n');
}
// Explicit probe only: never called by status/check/infra. Does not call any MCP tool.
function definitions(ctx, dir) {
  const result = new Map();
  const input = sources(ctx).concat(dir ? [
    {tool:'claude',file:path.join(dir,'.mcp.json'),kind:'json'},
    {tool:'cursor',file:path.join(dir,'.cursor','mcp.json'),kind:'json'},
  ] : []);
  for (const source of input) {
    const text = cfg.readText(source.file) || '';
    if (source.kind === 'json') {
      for (const [name, def] of Object.entries((readJ(source.file) || {}).mcpServers || {})) {
        result.set(`${source.tool}:${name}`, {tool:source.tool,name,def,file:source.file});
      }
    } else {
      const toml = require('./toml-lite');
      const value = raw => {
        if (raw === undefined) return undefined;
        if (/^'.*'$/.test(raw)) return raw.slice(1,-1);
        return JSON.parse(raw);
      };
      for (const server of tomlServers(text)) {
        const table = `mcp_servers.${server.name}`;
        let def;
        try {
          def = {enabled:server.enabled};
          for (const key of ['command','args','url','cwd']) def[key] = value(toml.get(text,key,table));
          const envTable = `${table}.env`;
          def.env = {};
          for (const line of text.split(/\r?\n/)) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
            if (m) { const v = toml.get(text,m[1],envTable); if (v !== undefined) def.env[m[1]] = value(v); }
          }
        } catch (_) { def = {unsupported:true}; }
        result.set(`codex:${server.name}`,{tool:'codex',name:server.name,def,file:source.file});
      }
    }
  }
  return [...result.values()];
}
function probeServer(entry, options = {}) {
  const def = entry.def || {};
  const command = typeof def.command === 'string' ? (require('./sys').which(def.command) || def.command) : def.command;
  const row = {tool:entry.tool,name:entry.name,state:'not-verified',detail:'',tools:0,scope:'server-process-only',clientConnectionVerified:false};
  if (def.disabled || def.enabled === false) return Promise.resolve({...row,state:'disabled',detail:'not started'});
  if (def.unsupported || def.url || !command || /\.(cmd|bat)$/i.test(command)) {
    return Promise.resolve({...row,detail:'use the native client for HTTP/OAuth, complex TOML or Windows shell launchers'});
  }
  const expand = text => String(text).replace(/\$\{workspaceFolder\}/g,options.cwd || process.cwd()).replace(/\$\{env:([^}]+)\}/g,(_,key) => {
    if (process.env[key] === undefined) throw new Error('missing environment variable'); return process.env[key];
  });
  return new Promise(resolve => {
    const cp = require('child_process'); let child; let timer; let buffer = ''; let bytes = 0; let finished = false;
    const finish = (state,detail,tools=0) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (child) {
        child.stdin.destroy();
        let stopped = child.exitCode !== null || child.signalCode !== null || !child.pid;
        if (!stopped) try {
          if (process.platform !== 'win32') { process.kill(-child.pid,'SIGTERM'); stopped=true; }
          else {
            const result=cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:2000});
            stopped = result.status === 0 || child.kill();
          }
        } catch (_) { try { stopped=child.kill() || stopped; } catch (_) { /* report cleanup failure below */ } }
        if (!stopped) {
          // Closing stdin may already have made the server exit while taskkill ran.
          const wait=setTimeout(()=>{ child.unref(); resolve({...row,state:'cleanup-failed',detail:`process cleanup not confirmed (PID ${child.pid})`,tools}); },500);
          child.once('close',()=>{clearTimeout(wait);resolve({...row,state,detail,tools});});
          child.stdout.destroy(); child.stderr.destroy(); return;
        }
        child.stdout.destroy(); child.stderr.destroy();
      }
      resolve({...row,state,detail,tools});
    };
    const send = msg => { if (!finished) child.stdin.write(JSON.stringify({jsonrpc:'2.0',...msg})+'\n'); };
    try {
      if (def.args && (!Array.isArray(def.args) || def.args.some(a=>typeof a !== 'string'))) throw new Error('invalid args');
      const env = Object.fromEntries(Object.entries(def.env || {}).map(([k,v])=>[k,expand(v)]));
      child = cp.spawn(expand(command),(def.args || []).map(expand),{
        cwd:def.cwd ? expand(def.cwd) : options.cwd, env:{...process.env,...env},
        stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform !== 'win32',
      });
      timer = setTimeout(()=>finish('timeout','initialize/tools-list did not finish'),options.timeout || 8000);
      child.on('error',()=>finish('failed','could not start configured server'));
      child.on('close',()=>finish('failed','server exited before verification'));
      child.stdin.on('error',()=>finish('failed','server input closed'));
      child.stderr.on('data',()=>{}); // Do not print server logs: they may contain credentials.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk,'utf8'); if (bytes > 1024*1024) return finish('failed','response exceeded 1 MiB');
        buffer += chunk.toString('utf8');
        let end;
        while (!finished && (end=buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0,end); buffer=buffer.slice(end+1); let msg;
          try { msg=JSON.parse(line); } catch (_) { continue; }
          if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return finish('failed','malformed JSON-RPC response');
          if (msg.id === 1) {
            if (msg.error || !msg.result || typeof msg.result.protocolVersion !== 'string') return finish('failed','initialize rejected or malformed');
            if (!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(msg.result.protocolVersion)) return finish('not-verified','server selected an unsupported protocol version');
            send({method:'notifications/initialized'});
            if (!msg.result.capabilities || !msg.result.capabilities.tools) return finish('initialized','server has no tools capability');
            send({id:2,method:'tools/list',params:{}});
          } else if (msg.id === 2) {
            if (msg.error || !msg.result || !Array.isArray(msg.result.tools) || msg.result.tools.some(t=>!t || typeof t.name !== 'string' || !t.inputSchema || typeof t.inputSchema !== 'object')) return finish('failed','tools/list rejected or malformed');
            return finish(msg.result.nextCursor ? 'partial' : 'verified',msg.result.nextCursor ? 'first tools page only' : 'initialize and tools/list succeeded',msg.result.tools.length);
          } else if (msg.id !== undefined && msg.method) send({id:msg.id,error:{code:-32601,message:'verification client does not implement this method'}});
        }
      });
      send({id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'askai-verify',version:'1.0'}}});
    } catch (_) { finish('failed','unsupported configuration or missing environment value'); }
  });
}
async function verify(ctx, dir, options = {}) {
  const tool = options.tool === 'antigravity' ? 'agy' : options.tool;
  if (tool && !['claude','codex','cursor','agy'].includes(tool)) throw new Error('unknown MCP environment');
  const entries = definitions(ctx,dir).filter(e=>(!tool || e.tool===tool) && (!options.name || e.name===options.name));
  const rows = [];
  for (const entry of entries) rows.push(await probeServer(entry,{...options,cwd:dir}));
  return rows;
}
// Accept a small normalized export; never persist tool arguments, outputs or auth data.
function importTelemetry(dir,file,tool,options={}) {
  tool=tool === 'antigravity' ? 'agy' : tool;
  if (!['codex','agy','cursor','claude'].includes(tool)) throw new Error('choose --tool codex|agy|cursor|claude');
  if (!file || fs.statSync(file).size > 4*1024*1024) throw new Error('telemetry export must be at most 4 MiB');
  const rows=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>{
    const row=JSON.parse(line);
    if (!row || !Number.isFinite(Date.parse(row.timestamp)) || Date.parse(row.timestamp)>Date.now()+60000 || !/^[\w.-]{1,100}$/.test(row.server || '') || !/^[\w.-]{1,100}$/.test(row.tool || '') || !/^[\w.:-]{1,150}$/.test(row.eventId || '') || !['success','failure','unknown'].includes(row.status)) throw new Error('each telemetry row needs a non-future timestamp, server, tool, eventId and status success|failure|unknown');
    return {timestamp:new Date(row.timestamp).toISOString(),host:tool,server:row.server,tool:row.tool,eventId:row.eventId,status:row.status,source:'normalized-export'};
  });
  const target=path.join(dir,'.ai-work','mcp-telemetry.jsonl');
  if (fs.existsSync(target) && fs.statSync(target).size > 4*1024*1024) throw new Error('archive telemetry before importing more');
  const prior=fs.existsSync(target) ? fs.readFileSync(target,'utf8').split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}) : [];
  const seen=new Set(prior.map(r=>`${r.host}:${r.eventId}`)); const fresh=[];
  for (const row of rows) if (!seen.has(`${row.host}:${row.eventId}`)) {seen.add(`${row.host}:${row.eventId}`);fresh.push(row);}
  const text=fresh.map(r=>JSON.stringify(r)+'\n').join('');
  if (Buffer.byteLength(text)+(fs.existsSync(target)?fs.statSync(target).size:0)>4*1024*1024) throw new Error('combined telemetry exceeds 4 MiB');
  if (!options.dry && fresh.length) { require('./session').ensure(dir,false); fs.appendFileSync(target,text); }
  return {added:fresh.length,duplicates:rows.length-fresh.length};
}
function telemetry(ctx,dir,days=7) {
  const since=Date.now()-days*86400000, totals=new Map(),seen=new Set(); let skipped=0, scanned=0, bytes=0;
  const add=(host,server,status,id,source)=>{
    if(!['success','failure'].includes(status))status='unknown';
    if(id && seen.has(host+':'+id))return;
    if(id)seen.add(host+':'+id);
    const key=host+':'+server; if (!totals.has(key)) totals.set(key,{tool:host,server,calls:0,failures:0,unknownOutcomes:0,userLogCalls:0,projectExportCalls:0});
    const row=totals.get(key);row.calls++;row[source==='user-log'?'userLogCalls':'projectExportCalls']++;if(status==='failure')row.failures++;if(status==='unknown')row.unknownOutcomes++;
  };
  if (ctx.codexPaths) for (const file of require('./usage').walk(path.join(ctx.codexPaths.home,'sessions'))) {
    let stat;try{stat=fs.statSync(file);}catch{continue;}
    if(stat.mtimeMs<since)continue;
    if(stat.size>16*1024*1024 || bytes+stat.size>32*1024*1024 || scanned>=100){skipped++;continue;}
    let body;try{body=fs.readFileSync(file,'utf8');}catch{skipped++;continue;}
    scanned++;bytes+=stat.size;
    for(const line of body.split(/\r?\n/)){
      let event;try{event=JSON.parse(line);}catch{continue;}
      if(!Number.isFinite(Date.parse(event.timestamp)) || Date.parse(event.timestamp)<since)continue;
      const p=event.payload;
      if(event.type!=='response_item' || !p || !['function_call','tool_call','mcp_tool_call'].includes(p.type))continue;
      const match=/^mcp__([\w-]+?)__(.+)$/.exec(p.name || '');
      if(match)add('codex',match[1],p.is_error===true?'failure':'unknown',typeof p.call_id==='string'?p.call_id:null,'user-log');
    }
  }
  const file=dir && path.join(dir,'.ai-work','mcp-telemetry.jsonl');
  if(file && fs.existsSync(file) && fs.statSync(file).size<=4*1024*1024) for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    let row;try{row=JSON.parse(line);}catch{continue;}
    if(row && ['codex','agy','cursor','claude'].includes(row.host) && row.source==='normalized-export' && Date.parse(row.timestamp)>=since && /^[\w.-]{1,100}$/.test(row.server || ''))add(row.host,row.server,row.status,row.eventId,'project-export');
  }
  return {rows:[...totals.values()],scope:'user logs are account-wide; exports are project-local; partial observations, not authoritative client attachment',coverage:{codex:`structured direct MCP calls across user logs; ${scanned} logs read, ${skipped} skipped by budget; wrapped calls and missing outcomes unsupported`,agy:'normalized exports only; native opaque logs not decoded'},scanned,skipped};
}
module.exports = { list, setState, render, tomlServers, parkFile, definitions, probeServer, verify, importTelemetry, telemetry };
