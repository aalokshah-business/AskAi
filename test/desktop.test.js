'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('child_process');
const {tmpHome,rm,write,makeCtx,fs,path,cli}=require('./helpers');
const desktop=require('../lib/desktop');
test('desktop command catalog covers every public command and routes help without launching a window',()=>{
  assert.deepEqual(desktop.catalog().map(r=>r.name),require('../lib/help').names().sort());
  assert.ok(desktop.catalog().every(r=>typeof r.category==='string' && r.usage && r.summary));
  const r=cli(['desktop','catalog']);assert.equal(r.code,0,r.err);assert.ok(JSON.parse(r.out).some(r=>r.name==='mcp'));
  assert.equal(cli(['desktop','--help']).code,0);
});
test('desktop mode reports convertOnly from the manifest, honouring --claude-home',()=>{
  assert.deepEqual(desktop.mode(undefined),{convertOnly:false});
  assert.deepEqual(desktop.mode({manifest:{}}),{convertOnly:false});
  assert.deepEqual(desktop.mode({manifest:{convertOnly:true}}),{convertOnly:true});
  const home=tmpHome();
  try{
    assert.deepEqual(JSON.parse(cli(['desktop','mode','--claude-home',home]).out),{convertOnly:false});
    assert.equal(cli(['install','--only','markitdown','--convert-only','--yes','--claude-home',home,'--no-desktop']).code,0);
    assert.deepEqual(JSON.parse(cli(['desktop','mode','--claude-home',home]).out),{convertOnly:true});
  }finally{rm(home);}
});
test('install --convert-only previews opening Ask AI under --dry-run, without --no-desktop',()=>{
  const home=tmpHome();
  try{
    const r=cli(['install','--convert-only','--dry-run','--yes','--claude-home',home]);
    assert.equal(r.code,0,r.err);
    assert.match(r.out,/\[dry-run\] would open Ask AI after install/);
  }finally{rm(home);}
});
test('desktop output paths preserve existing files, reject deceptive URLs and normalize names',()=>{
  const dir=tmpHome();try{
    write(path.join(dir,'spec.md'),'original');
    assert.equal(desktop.outputPath('spec.pdf',dir),path.join(dir,'spec-1.md'));
    assert.equal(desktop.outputPath('CON.pdf',dir),path.join(dir,'_CON.md'));
    assert.equal(desktop.outputPath('https://youtu.be/abc123',dir),path.join(dir,'youtube-abc123.md'));
    assert.throws(()=>desktop.outputPath('https://',dir),/Invalid URL/);
    assert.match(desktop.outputPath('https://example.com/page',dir),/example.com_page.md$/);
    assert.equal(fs.readFileSync(path.join(dir,'spec.md'),'utf8'),'original');
  }finally{rm(dir);}
});
test('desktop request uses the selected project and rejects unknown commands or missing files',async()=>{
  const dir=tmpHome();try{
    const r=await desktop.request({kind:'command',project:dir,command:'version'});assert.equal(r.code,0);assert.match(r.stdout,/\d+\.\d+\.\d+/);
    await assert.rejects(()=>desktop.request({kind:'command',project:dir,command:'not-a-command'}),/known/);
    await assert.rejects(()=>desktop.request({kind:'command',project:dir,command:'cli'}),/Open terminal/);
    await assert.rejects(()=>desktop.request({kind:'convert',project:dir,source:path.join(dir,'absent.pdf')}),/ENOENT/);
    const bad=await desktop.request({kind:'command',project:dir,command:'help',args:'"unclosed'}).catch(e=>e);assert.match(bad.message,/unclosed quote/);
  }finally{rm(dir);}
});
test('desktop request rejects a folder with nothing convertible in it',async()=>{
  const dir=tmpHome();try{
    write(path.join(dir,'notes.json'),'{}');
    await assert.rejects(()=>desktop.request({kind:'convert',project:dir,source:dir}),/No convertible files/);
  }finally{rm(dir);}
});
const hasMarkitdown=cp.spawnSync('markitdown',['--version'],{encoding:'utf8'}).status===0;
test('desktop request on a folder converts every supported file into the output folder, skipping the rest',{skip:hasMarkitdown?false:'markitdown not installed'},async()=>{
  const dir=tmpHome();try{
    const src=path.join(dir,'inputs');fs.mkdirSync(src);
    write(path.join(src,'one.txt'),'first document');
    write(path.join(src,'two.txt'),'second document');
    write(path.join(src,'skip.json'),'{}');
    const out=path.join(dir,'out');fs.mkdirSync(out);
    const r=await desktop.request({kind:'convert',project:dir,source:src,folder:out});
    assert.equal(r.code,0);
    assert.match(r.stdout,/Converted 2 of 2 file\(s\)/);
    assert.ok(fs.existsSync(path.join(out,'one.md')));
    assert.ok(fs.existsSync(path.join(out,'two.md')));
    assert.ok(!fs.existsSync(path.join(out,'skip.md')));
  }finally{rm(dir);}
});
test('desktop request on a folder groups successes before failures, each tagged and naming only the file',{skip:hasMarkitdown?false:'markitdown not installed'},async()=>{
  const dir=tmpHome();try{
    const src=path.join(dir,'inputs');fs.mkdirSync(src);
    write(path.join(src,'good.txt'),'has content');
    fs.writeFileSync(path.join(src,'blank.html'),'');
    const out=path.join(dir,'out');fs.mkdirSync(out);
    const r=await desktop.request({kind:'convert',project:dir,source:src,folder:out});
    assert.equal(r.code,0);
    assert.match(r.stdout,/Converted 1 of 2 file\(s\)/);
    const okIndex=r.stdout.indexOf('OK   good.txt');
    const failIndex=r.stdout.indexOf('FAIL blank.html:');
    assert.ok(okIndex>=0 && failIndex>okIndex,'OK lines must precede FAIL lines');
    assert.ok(!r.stdout.includes(path.join(src,'blank.html')),'failure line should not repeat the full path');
  }finally{rm(dir);}
});
test('desktop process capture enforces deadlines and treats shell text as data',async()=>{
  const dir=tmpHome();try{
    const r=await desktop.execute(['-e','console.log(process.argv[1])','$(untrusted); & echo'],dir);assert.equal(r.code,0);assert.match(r.stdout,/\$\(untrusted\); & echo/);
    const slow=await desktop.execute(['-e','setInterval(()=>{},1000)'],dir,{timeout:100});assert.equal(slow.code,1);assert.match(slow.stderr,/Time limit/);
    const large=await desktop.execute(['-e','process.stdout.write("x".repeat(3*1024*1024))'],dir);assert.equal(large.code,1);assert.match(large.stderr,/2 MiB/);
  }finally{rm(dir);}
});
test('desktop setup respects dry runs and isolated configuration homes',()=>{
  const dir=tmpHome();try{
    const ctx=makeCtx(dir);assert.match(desktop.install(ctx),/skipped|not needed/);assert.equal(ctx.calls.length,0);
    ctx.sandbox=false;ctx.dry=true;assert.match(desktop.install(ctx),/install|not needed/);assert.equal(ctx.calls.length,0);
    ctx.dry=false;ctx.desktopBuild=()=>'/fake/AskAI.exe';desktop.install(ctx);if(process.platform==='win32'){assert.ok(ctx.calls.some(c=>c.includes('--install-shortcuts')));assert.ok(ctx.calls.every(c=>!c.includes('powershell')));}
  }finally{rm(dir);}
});
test('Windows desktop PowerShell sources parse without errors',{skip:process.platform!=='win32'?'Windows setup wrapper only':false},()=>{
  const scripts=[path.join(__dirname,'..','setup-desktop.ps1')];
  for(const file of scripts){
    const code='$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|Out-String|Write-Error;exit 1}';
    const r=cp.spawnSync('powershell.exe',['-NoProfile','-Command',`& {${code}} '${file.replace(/'/g,"''")}'`],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
  }
});
test('Linux GUI installs only in graphical sessions outside containers',()=>{
  const env={DISPLAY:':0'},exists=()=>false;
  assert.equal(desktop.environment({platform:'linux',env,exists}).supported,true);
  assert.equal(desktop.environment({platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0'},exists}).supported,true);
  assert.match(desktop.environment({platform:'linux',env,exists:p=>p==='/.dockerenv'}).reason,/container/);
  assert.match(desktop.environment({platform:'linux',env:{...env,REMOTE_CONTAINERS:'1'},exists}).reason,/container/);
  assert.match(desktop.environment({platform:'linux',env:{},exists}).reason,/graphical/);
  assert.equal(desktop.environment({platform:'win32',env:{},exists}).supported,true);
  assert.equal(desktop.environment({platform:'darwin',env,exists}).supported,false);
});
test('Linux desktop launchers quote paths and preserve unrelated files',()=>{
  const home=tmpHome();try{
    fs.mkdirSync(path.join(home,'Desktop'));
    const ctx={env:{HOME:home},paths:{app:path.join(home,'app with spaces')}};
    desktop.linuxShortcuts(ctx,'/usr/bin/python3');
    const file=path.join(home,'.local','share','applications','askai.desktop');
    const data=fs.readFileSync(file,'utf8');assert.match(data,/Name=Ask AI/);assert.match(data,/app with spaces/);assert.match(data,/Terminal=false/);
    desktop.linuxShortcuts(ctx,'/usr/bin/python3',true);assert.equal(fs.existsSync(file),false);
    write(file,'unrelated desktop entry');assert.throws(()=>desktop.linuxShortcuts(ctx,'python3'),/Preserved unrelated/);assert.equal(fs.readFileSync(file,'utf8'),'unrelated desktop entry');
    assert.throws(()=>desktop.linuxEntry('bad\npath','node','python3'),/Invalid/);
    assert.match(desktop.linuxEntry('/path/100%','node','python3'),/100%%/);
  }finally{rm(home);}
});
test('native Windows shortcut installation is repeatable and removal preserves unrelated files',{skip:process.platform!=='win32'?'Windows native shortcuts only':false},()=>{
  const dir=tmpHome();try{
    const exe=desktop.build(),root=path.join(__dirname,'..'),args=[root,process.execPath,dir];
    const run=mode=>cp.spawnSync(exe,[mode,...args],{encoding:'utf8',windowsHide:true,timeout:30000});
    for(let i=0;i<2;i++){const result=run('--install-shortcuts');assert.equal(result.status,0,result.stderr);assert.ok(fs.existsSync(path.join(dir,'Ask AI.lnk')));}
    assert.equal(run('--remove-shortcuts').status,0);assert.equal(fs.existsSync(path.join(dir,'Ask AI.lnk')),false);
    write(path.join(dir,'Ask AI.lnk'),'unrelated file');assert.notEqual(run('--install-shortcuts').status,0);assert.equal(fs.readFileSync(path.join(dir,'Ask AI.lnk'),'utf8'),'unrelated file');
    assert.notEqual(run('--remove-shortcuts').status,0);assert.ok(fs.existsSync(path.join(dir,'Ask AI.lnk')));
  }finally{rm(dir);}
});
