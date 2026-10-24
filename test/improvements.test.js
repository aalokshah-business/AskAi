'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), cp=require('child_process');
const {tmpHome,rm,write,fs,path,makeCtx,cli}=require('./helpers');
const runtime=require('../lib/runtime'),mcp=require('../lib/mcp'),graph=require('../lib/graph-query'),session=require('../lib/session');
test('source cache notices another edit to an already-dirty nested file',()=>{
  const home=tmpHome();try{
    cp.spawnSync('git',['init'],{cwd:home,stdio:'ignore'});
    write(path.join(home,'.gitignore'),'.ai-work/\n');
    const file=path.join(home,'src','main.js');write(file,'function alpha() {}\n');
    const project=require('../lib/project'),first=project.detect(home);
    assert.strictEqual(project.detect(home),first);
    write(file,'function bravo() {}\n');const later=new Date(Date.now()+2000);fs.utimesSync(file,later,later);
    const second=project.detect(home);assert.notStrictEqual(second,first);
    assert.ok(second.source.rows.find(r=>r.file==='src/main.js').symbols.includes('bravo'));
  }finally{rm(home);}
});
test('runtime stamps distinguish same-version copies, tampering and unknown revisions',()=>{
  const home=tmpHome();try{
    const a=path.join(home,'a'),b=path.join(home,'b');
    for(const dir of [a,b]){write(path.join(dir,'askai.js'),'// app');write(path.join(dir,'package.json'),'{"version":"1.3.0"}');write(path.join(dir,'lib','x.js'),'module.exports=1;');}
    runtime.stamp(a,b);assert.equal(runtime.identity(b).integrity,'matches-install-stamp');
    assert.equal(runtime.identity(b).revision,null);
    write(path.join(b,'lib','x.js'),'module.exports=2;');
    assert.equal(runtime.identity(b).integrity,'changed-since-install');
    assert.equal(runtime.inventory(a,[a,b]).copies.length,2);
    assert.equal(runtime.inventory(a,[b]).copies[1].matchesCurrent,false);
    const r=cli(['version','--json']);assert.equal(r.code,0);assert.ok(JSON.parse(r.out).contentHash);
  }finally{rm(home);}
});
test('orphaned Headroom is detected and repaired with an explicitly selected Python',()=>{
  const home=tmpHome();try{
    let broken=true;
    const exe=path.join(home,'headroom.exe'),python=path.join(home,'python.exe');
    const ctx=makeCtx(home,{python},{tools:{headroom:exe,uv:path.join(home,'uv.exe')},
      probe:(bin,args)=>bin===exe?{ok:!broken,status:broken?1:0,stdout:broken?'':'headroom 1',stderr:broken?'uv trampoline failed':''}:{ok:false,status:1,stdout:'',stderr:''},
      act:(bin,args)=>{if(args.includes('install')){if(args.includes('--force')){broken=false;return {ok:true,status:0};}return {ok:false,status:1,stdout:'',stderr:'Executable already exists'};}return {ok:true,status:0};}
    });
    const component=require('../lib/components').byId('headroom');
    assert.equal(component.detect(ctx).state,'partial');
    component.install(ctx);assert.equal(broken,false);
    assert.ok(ctx.calls.some(s=>s.includes('uv tool install -p '+python)));
  }finally{rm(home);}
});
test('MCP telemetry counts structured calls, bounds scans, deduplicates exports and drops secrets',()=>{
  const home=tmpHome();try{
    const ctx=makeCtx(home,{codexHome:path.join(home,'codex')});
    const now=new Date().toISOString(),old='2000-01-01T00:00:00Z';
    const event=(timestamp,payload)=>JSON.stringify({timestamp,type:'response_item',payload});
    write(path.join(ctx.codexPaths.home,'sessions','calls.jsonl'),[
      event(old,{type:'function_call',name:'mcp__serena__find_symbol'}),
      event(now,{type:'function_call',name:'mcp__serena__find_symbol'}),
      event(now,{type:'function_call',name:'functions.exec',arguments:'mcp__headroom__compress mentioned only'})
    ].join('\n'));
    const large=path.join(ctx.codexPaths.home,'sessions','large.jsonl');write(large,'');fs.truncateSync(large,17*1024*1024);
    const input=path.join(home,'events.jsonl');write(input,JSON.stringify({timestamp:now,server:'headroom',tool:'compress',eventId:'event-1',status:'success',arguments:'secret',token:'must-not-persist'}));
    assert.equal(mcp.importTelemetry(home,input,'agy',{dry:true}).added,1);assert.ok(!fs.existsSync(path.join(home,'.ai-work')));
    assert.equal(mcp.importTelemetry(home,input,'agy').added,1);assert.equal(mcp.importTelemetry(home,input,'agy').duplicates,1);
    assert.doesNotMatch(fs.readFileSync(path.join(home,'.ai-work','mcp-telemetry.jsonl'),'utf8'),/secret|token|arguments/);
    const report=mcp.telemetry(ctx,home);assert.equal(report.skipped,1);assert.equal(report.rows.find(r=>r.server==='serena').calls,1);
    assert.equal(report.rows.filter(r=>r.tool==='codex').length,1);assert.match(report.coverage.agy,/exports only/);
    write(input,'{"timestamp":"bad"}');assert.throws(()=>mcp.importTelemetry(home,input,'agy'));
  }finally{rm(home);}
});
test('graph query bounds process lifetime and never rebuilds a missing graph',async()=>{
  const home=tmpHome();try{
    assert.equal((await graph.query(home,'question',{exe:process.execPath})).state,'missing-graph');
    write(path.join(home,'graphify-out','graph.json'),'{}');
    const fake=path.join(home,'fake.js');write(fake,'setInterval(()=>{},1000);');
    const result=await graph.query(home,'question',{exe:process.execPath,prefixArgs:[fake],timeout:1});
    assert.equal(result.state,'timeout');assert.match(result.fallback,/rg/);
    write(fake,'console.log("bounded answer");');
    const success=await graph.query(home,'question',{exe:process.execPath,prefixArgs:[fake],timeout:2});
    assert.equal(success.state,'ok');assert.match(success.output,/bounded answer/);
    assert.throws(()=>graph.query(home,'question',{timeout:0}));
  }finally{rm(home);}
});
test('quota plans require acceptance and exclude unpaired, cross-window or failed workloads',()=>{
  const home=tmpHome(),out=[];const print=s=>out.push(s);try{
    const plan={repo:home,_:['session','quota','plan'],name:'trial',tool:'codex',task:'repeatable task',model:'test-model',effort:'medium',accountLabel:'account',acceptance:'tests pass'};
    session.run('quota',plan,print);const file=path.join(home,'.ai-work','quota-plan.json');assert.ok(fs.existsSync(file));
    const read=(variant,phase,used,windowId='same',success=1)=>session.run('quota',{repo:home,name:'trial',variant,phase,used,windowId,usageSource:'dashboard',isolated:true,success},print);
    read('baseline','before',10);read('baseline','after',20);read('askai','before',30,'different');read('askai','after',34,'different');
    session.run('quota',{repo:home,_:['session','quota','report']},print);assert.doesNotMatch(out.join('\n'),/Observed comparison/);
    read('askai','before',30);read('askai','after',34);
    out.length=0;session.run('quota',{repo:home,_:['session','quota','report']},print);assert.match(out.join('\n'),/difference 6.00 pp/);
    assert.throws(()=>session.run('quota',{...plan,acceptance:''},print));
  }finally{rm(home);}
});
