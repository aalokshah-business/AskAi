'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {tmpHome,rm,makeCtx,write,fs,path,cli} = require('./helpers');
const mcp = require('../lib/mcp');
const build = require('../lib/project-build');
const session = require('../lib/session');
const platform = require('../lib/platform');

test('MCP performs initialize and tools/list without executing tools or exposing server logs', async () => {
  const code = `const r=require('readline').createInterface({input:process.stdin});r.on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize'){console.error('private-server-log');console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}}));}if(m.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'fake',inputSchema:{type:'object'}}]}}));if(m.method==='tools/call')process.exit(9);});`;
  const row = await mcp.probeServer({tool:'cursor',name:'fake',def:{command:process.execPath,args:['-e',code]}},{timeout:3000});
  assert.equal(row.state,'verified'); assert.equal(row.tools,1);
  assert.ok(!JSON.stringify(row).includes('private-server-log'));
  const disabled = await mcp.probeServer({tool:'codex',name:'disabled',def:{disabled:true,command:'must-not-start'}});
  assert.equal(disabled.state,'disabled');
  assert.equal((await mcp.probeServer({tool:'agy',name:'http',def:{url:'https://example.invalid'}})).state,'not-verified');
});

test('MCP timeout and protocol errors do not leak environment or raw server messages', async () => {
  const timed = await mcp.probeServer({tool:'claude',name:'slow',def:{command:process.execPath,args:['-e','setInterval(()=>{},1000)']}},{timeout:100});
  assert.equal(timed.state,'timeout');
  const code = `process.stdin.on('data',()=>console.log(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-1,message:'secret-auth-value'}})));`;
  const denied = await mcp.probeServer({tool:'agy',name:'denied',def:{command:process.execPath,args:['-e',code]}},{timeout:3000});
  assert.equal(denied.state,'failed'); assert.ok(!JSON.stringify(denied).includes('secret-auth-value'));
});

test('MCP reports early server exit without a false cleanup failure', async () => {
  const row = await mcp.probeServer({tool:'codex',name:'exited',def:{command:process.execPath,args:['-e','process.exit(2)']}},{timeout:3000});
  assert.equal(row.state,'failed');
  assert.doesNotMatch(row.detail,/cleanup/);
  if (process.platform === 'win32') {
    const shell = await mcp.probeServer({tool:'codex',name:'npm-shim',def:{command:'npx',args:[]}});
    if (/\.(cmd|bat)$/i.test(require('../lib/sys').which('npx') || '')) assert.equal(shell.state,'not-verified');
  }
});

test('plugin reports request the durable Headroom ledger rather than proxy performance', () => {
  const home = tmpHome();
  try {
    const win = process.platform === 'win32';
    const file = path.join(home,win ? 'headroom.cmd' : 'headroom');
    write(file,win ? '@echo off\r\necho requested: %*\r\n' : '#!/bin/sh\nprintf "requested: %s\\n" "$*"\n');
    if (!win) fs.chmodSync(file,0o755);
    const ctx = makeCtx(home,{}, {tools:{headroom:file}});
    const report = require('../lib/savings').report(ctx,7,home);
    assert.match(report,/requested: savings --days 7/);
    assert.doesNotMatch(report,/requested: perf/);
    assert.match(report,/not plan quota/);
  } finally { rm(home); }
});

test('MCP resolves all four clients and project overrides without printing configuration secrets', () => {
  const home=tmpHome();
  try {
    const ctx=makeCtx(home,{cursorHome:path.join(home,'cursor'),codexHome:path.join(home,'codex'),agyHome:path.join(home,'gemini')});
    for (const file of [ctx.paths.userJson,ctx.cursorPaths.mcp,ctx.agyPaths.mcp]) write(file,JSON.stringify({mcpServers:{fake:{command:'node',args:[]}}}));
    write(ctx.codexPaths.config,'[mcp_servers.fake]\ncommand = "node"\nargs = []\n[mcp_servers.fake.env]\nTOKEN = "private"\n');
    write(path.join(home,'.cursor','mcp.json'),JSON.stringify({mcpServers:{fake:{disabled:true}}}));
    const rows=mcp.definitions(ctx,home);
    assert.deepEqual([...new Set(rows.map(r=>r.tool))].sort(),['agy','claude','codex','cursor']);
    assert.equal(rows.find(r=>r.tool==='cursor').def.disabled,true);
    assert.equal(rows.find(r=>r.tool==='codex').def.env.TOKEN,'private');
  } finally { rm(home); }
});

test('build discovery never guesses a target or configures files; selection records argv only', () => {
  const home=tmpHome();
  try {
    write(path.join(home,'CMakePresets.json'),JSON.stringify({version:3,configurePresets:[{name:'base',hidden:true},{name:'debug',inherits:'base',binaryDir:'${sourceDir}/build/debug'}]}));
    write(path.join(home,'platformio.ini'),'[env:board_a]\nboard=board_a\n');
    const found=build.discover(home);
    assert.deepEqual(found.presets.map(p=>p.name),['debug','board_a']);
    assert.ok(!fs.existsSync(path.join(home,'.ai-work')));
    assert.throws(()=>build.select(home,'unknown'),/unique discovered/);
    const dry=build.select(home,'debug',{dry:true}); assert.equal(dry.verified,false);
    assert.ok(!fs.existsSync(path.join(home,'.ai-work')));
    const selected=build.select(home,'debug');
    assert.deepEqual(selected.argv,['cmake','--preset','debug','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']);
    assert.ok(fs.existsSync(path.join(home,'.ai-work','build-selection.json')));
    assert.ok(!fs.existsSync(path.join(home,'build')));
    write(path.join(home,'mk.sh'),'#!/bin/bash\necho do-not-execute > built.txt\n');
    const script=build.select(home,'./mk.sh');
    assert.deepEqual(script.argv,['./mk.sh']);
    assert.equal(script.verified,false);
    assert.ok(!fs.existsSync(path.join(home,'built.txt')));
  } finally { rm(home); }
});

test('quota observations keep windows separate, detect resets, and compare only labeled workloads', () => {
  const home=tmpHome();
  const capture=[]; const print=line=>capture.push(line);
  try {
    assert.equal(session.run('quota',{repo:home,tool:'cursor',used:'10'},print),1);
    assert.ok(!fs.existsSync(path.join(home,'.ai-work','quota-observations.jsonl')));
    const common={repo:home,tool:'cursor',window:'100',usageSource:'dashboard',task:'same task',model:'same-model',effort:'medium',name:'trial',accountLabel:'test-account',acceptance:'tests pass',isolated:true};
    for (const [variant,start,end] of [['baseline',10,20],['askai',30,36]]) {
      for (const [i,used] of [start,end].entries()) assert.equal(session.run('quota',{...common,variant,windowId:'same-window',phase:i?'after':'before',success:i?1:undefined,used:String(used)},print),0);
    }
    for (const used of [90,2]) session.run('quota',{...common,windowId:'reset',used:String(used)},print);
    session.run('quota',{repo:home,_:['session','quota','report']},print);
    const text=capture.join('\n');
    assert.match(text,/difference 4.00 pp/); assert.match(text,/reset; use a new window ID/);
    assert.match(text,/No automatic Cursor\/Antigravity quota API or proven net savings/);
  } finally { rm(home); }
});

test('oversized terminal clipboard requests fall back to a file without emitting escape sequences', () => {
  const home=tmpHome(); let emitted=false;
  try {
    const file=path.join(home,'copy.txt');
    const result=platform.copyToClipboard('x'.repeat(100001),{platform:'linux',spawn:()=>({status:1}),isTTY:true,write:()=>{emitted=true;},file});
    assert.equal(result,'file'); assert.equal(emitted,false);
    assert.equal(fs.statSync(file).size,100001);
  } finally { rm(home); }
});

test('CLI exposes build and quota workflows through project resolution and JSON', () => {
  const home=tmpHome();
  try {
    write(path.join(home,'CMakePresets.json'),JSON.stringify({version:3,configurePresets:[{name:'debug'}]}));
    const found=cli(['project','build','--repo',home,'--json']);
    assert.equal(found.code,0,found.err); assert.equal(JSON.parse(found.out).presets[0].name,'debug');
    const record=cli(['session','quota','--repo',home,'--tool','cursor','--used','23','--window-id','window-1','--usage-source','dashboard','--variant','baseline']);
    assert.equal(record.code,0,record.err);
    const report=cli(['session','quota','report','--repo',home,'--json']);
    assert.equal(report.code,0,report.err); assert.equal(JSON.parse(report.out)[0].percent,23);
    assert.ok(!fs.existsSync(path.join(home,'.ai-work','build-selection.json')));
  } finally { rm(home); }
});

test('resume always saves fallback text and does not claim OSC 52 paste confirmation', () => {
  const home=tmpHome(); const previous=platform.copyToClipboard; const output=[];
  platform.copyToClipboard=()=> 'osc52';
  try {
    assert.equal(session.run('resume',{repo:home,copy:true},line=>output.push(line)),0);
    assert.equal(fs.readFileSync(path.join(home,'.ai-work','RESUME_PROMPT.md'),'utf8'),session.RESUME_PROMPT);
    assert.match(output.join('\n'),/paste is not verified/);
    assert.doesNotMatch(output.join('\n'),/copied with osc52/);
  } finally { platform.copyToClipboard=previous; rm(home); }
});
