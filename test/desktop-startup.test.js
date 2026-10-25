'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('child_process');
const {tmpHome,rm,write,fs,path,makeCtx}=require('./helpers');
const desktop=require('../lib/desktop');

async function scenario(source,options,verify){
  const dir=tmpHome(),ready=path.join(dir,'ready.json');
  const child=cp.spawn(process.execPath,['-e',source,ready],{stdio:'ignore'});
  try{await verify(desktop.waitForWindow(child,ready,{timeout:3000,settle:150,interval:5,...options}));assert.equal(fs.existsSync(ready),false);}
  finally{if(child.exitCode===null && child.signalCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}rm(dir);}
}
const announce='require("fs").writeFileSync(process.argv[1],JSON.stringify({ok:true}));';
test('desktop rejects an exit before readiness with its exit status',async()=>{
  await scenario('process.exit(7)',{},promise=>assert.rejects(promise,/before reporting ready.*exit 7/));
});
test('desktop rejects an immediate exit after readiness',async()=>{
  await scenario(announce+'setTimeout(()=>process.exit(9),60)',{},promise=>assert.rejects(promise,/during startup after reporting ready.*exit 9/));
});
test('desktop detects an exit immediately after writing readiness even before the next poll',async()=>{
  await scenario(announce+'process.exit(4)',{interval:200},promise=>assert.rejects(promise,/during startup after reporting ready.*exit 4/));
});
test('desktop succeeds only after a live process survives the startup check',async()=>{
  await scenario(announce+'setInterval(()=>{},1000)',{},promise=>promise);
});
test('desktop surfaces startup errors from the native application',async()=>{
  await scenario('require("fs").writeFileSync(process.argv[1],JSON.stringify({ok:false,error:"Fixture startup failure"}));process.exit(1)',{},promise=>assert.rejects(promise,/Fixture startup failure/));
});
test('desktop times out on malformed readiness data and terminates the pending child',async()=>{
  await scenario('require("fs").writeFileSync(process.argv[1],"{");setInterval(()=>{},1000)',{timeout:350},promise=>assert.rejects(promise,/did not finish startup/));
});
test('desktop reports OS spawn failures separately from readiness failures',async()=>{
  const dir=tmpHome();try{
    const child=cp.spawn(path.join(dir,'missing-executable'),[],{stdio:'ignore'});
    await assert.rejects(desktop.waitForWindow(child,path.join(dir,'ready')),/process could not start.*ENOENT/);
  }finally{rm(dir);}
});
test('Windows setup prepares matching legacy GUI builds and preserves unrelated installs',{skip:process.platform!=='win32'},()=>{
  const dir=tmpHome();try{
    const app=path.join(dir,'.askai','app'),home=path.join(dir,'.claude'),legacy=path.join(home,'askai','app');
    const source=path.join(app,'standalone','desktop.cs'),other=path.join(legacy,'standalone','desktop.cs');
    const exe=path.join(app,'desktop-bin','AskAI-0123456789abcdef.exe'),target=path.join(legacy,'desktop-bin',path.basename(exe));
    write(source,'matching source');write(other,'matching source');write(path.join(legacy,'package.json'),' {"name":"askai"}');write(exe,'fixture executable');
    const ctx=makeCtx(dir);ctx.sandbox=false;ctx.paths={...ctx.paths,app,home};ctx.desktopBuild=()=>exe;
    desktop.install(ctx);assert.equal(fs.readFileSync(target,'utf8'),'fixture executable');
    desktop.install(ctx);assert.equal(fs.readFileSync(target,'utf8'),'fixture executable');
    fs.unlinkSync(target);write(other,'different source');desktop.install(ctx);assert.equal(fs.existsSync(target),false);
    write(other,'matching source');write(path.join(legacy,'package.json'),'{"name":"unrelated"}');desktop.install(ctx);assert.equal(fs.existsSync(target),false);
    write(path.join(legacy,'package.json'),'{"name":"askai"}');ctx.dry=true;desktop.install(ctx);assert.equal(fs.existsSync(target),false);
    ctx.dry=false;ctx.sandbox=true;desktop.install(ctx);assert.equal(fs.existsSync(target),false);
    ctx.sandbox=false;desktop.install(ctx);desktop.install(ctx,true);assert.ok(fs.existsSync(target),'removing shortcuts preserves build cache');
  }finally{rm(dir);}
});
test('Windows compilation permission failures identify the runtime and repair command without retrying',{skip:process.platform!=='win32'},()=>{
  const dir=tmpHome(),spawn=cp.spawnSync;try{
    write(path.join(dir,'standalone','desktop.cs'),'fixture source');let calls=0;
    cp.spawnSync=()=>{calls++;return {status:1,stdout:'error CS1567: Error generating Win32 resource: Access is denied.'};};
    assert.throws(()=>desktop.build(dir),error=>/build permission denied/.test(error.message)&&error.message.includes(path.join(dir,'desktop-bin'))&&error.message.includes('askai desktop install --yes'));
    assert.equal(calls,1);
    assert.equal(fs.readdirSync(path.join(dir,'desktop-bin')).length,0);
  }finally{cp.spawnSync=spawn;rm(dir);}
});
