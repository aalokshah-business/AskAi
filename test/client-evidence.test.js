'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tmpHome,rm,write,makeCtx,fs,path,cli}=require('./helpers');
const mcp=require('../lib/mcp');
function fixture(fn){const home=tmpHome();try{const ctx=makeCtx(home,{codexHome:path.join(home,'codex')});write(ctx.codexPaths.config,'[mcp_servers.fake]\ncommand = "must-not-run"\nargs = []\n[mcp_servers.fake.env]\nTOKEN = "private-config-token"\n');return fn(home,ctx);}finally{rm(home);}}
test('native client checks remain reported evidence, separate from process verification',()=>fixture((home,ctx)=>{
  ctx.probe=()=>{throw Error('must not probe');};
  assert.equal(mcp.connections(ctx,home,{tool:'codex'})[0].state,'unconfirmed');
  mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:'1',notes:'Native MCP view connected; tool succeeded',testTool:'get_config',dry:true});
  assert.ok(!fs.existsSync(path.join(home,'.ai-work','mcp-client-checks.json')));
  const row=mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:'1',notes:'Native view connected',testTool:'get_config'});
  assert.equal(row.clientConnectionVerified,false);
  const report=mcp.connections(ctx,home,{tool:'codex'})[0];assert.equal(report.state,'reported-connected');assert.equal(report.testedTool,'get_config');
  assert.doesNotMatch(fs.readFileSync(path.join(home,'.ai-work','mcp-client-checks.json'),'utf8'),/private-config-token|must-not-run/);
  assert.equal(mcp.connections(ctx,home,{now:Date.now()+25*3600000})[0].state,'stale');
  write(ctx.codexPaths.config,fs.readFileSync(ctx.codexPaths.config,'utf8').replace('must-not-run','changed-command'));
  assert.equal(mcp.connections(ctx,home)[0].state,'stale');
}));
test('failed reports, disabled servers and corrupt evidence do not appear connected',()=>fixture((home,ctx)=>{
  const row=mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:'0',notes:'Native client shows startup failure',testTool:'ignored'});
  assert.equal(row.state,'reported-failed');assert.equal(mcp.connections(ctx,home)[0].testedTool,'');
  assert.throws(()=>mcp.confirmClient(ctx,home,'unknown',{tool:'codex',success:1,notes:'checked'}),/not configured/);
  assert.throws(()=>mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:1,notes:''}),/notes/);
  const file=path.join(home,'.ai-work','mcp-client-checks.json');write(file,'secret malformed value');
  assert.equal(mcp.connections(ctx,home)[0].state,'unconfirmed');
  assert.throws(()=>mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:1,notes:'checked'}),error=>!error.message.includes('secret') && /invalid client evidence/.test(error.message));
  assert.equal(fs.readFileSync(file,'utf8'),'secret malformed value');
  write(ctx.codexPaths.config,'[mcp_servers.fake]\ncommand = "must-not-run"\nenabled = false\n');
  assert.equal(mcp.connections(ctx,home)[0].state,'disabled');
  assert.throws(()=>mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:1,notes:'checked'}),/disabled/);
}));
test('CLI connection commands use the selected project without calling a server',()=>fixture((home,ctx)=>{
  const flags=['--claude-home',home,'--codex-home',ctx.codexPaths.home,'--repo',home,'--json'];
  const before=cli(['mcp','connections','--tool','codex',...flags]);assert.equal(before.code,0,before.err);assert.equal(JSON.parse(before.out)[0].state,'unconfirmed');
  const recorded=cli(['mcp','confirm','fake','--tool','codex','--success','1','--notes','Observed native connection',...flags]);assert.equal(recorded.code,0,recorded.err);assert.equal(JSON.parse(recorded.out).state,'reported-connected');
  assert.equal(JSON.parse(cli(['mcp','connections','--tool','codex',...flags]).out)[0].clientConnectionVerified,false);
}));
test('todo and brief status reflect pending, reported and stale client checks without probing',()=>fixture((home,ctx)=>{
  ctx.probe=(name)=>{assert.equal(name,'npm');return {ok:false};};ctx.which=()=>null;
  const pending=()=>require('../lib/todo').collectItems(ctx,home).some(r=>r.id==='codex-mcp-client-check');
  const live=()=>require('../lib/status').brief(ctx,home,{host:'codex'}).result.rows[0].live;
  assert.equal(pending(),true);assert.equal(live(),'0/1 reported; 1 pending');
  mcp.confirmClient(ctx,home,'fake',{tool:'codex',success:1,notes:'Observed connected in native client'});
  assert.equal(pending(),false);assert.equal(live(),'1/1 reported; 0 pending');
  write(ctx.codexPaths.config,fs.readFileSync(ctx.codexPaths.config,'utf8').replace('must-not-run','changed-command'));
  assert.equal(pending(),true);assert.equal(live(),'0/1 reported; 1 pending');
}));
