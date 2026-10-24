'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('child_process');
const {tmpHome,rm,fs,path}=require('./helpers');
test('a desktop signing failure preserves core CLI setup and fails explicit GUI setup',()=>{
  const home=tmpHome();try{
    const root=path.join(__dirname,'..');
    const run=explicit=>{
      const args=explicit?['desktop','install']:['install','--only','baseline'];
      args.push('--claude-home',home,'--target','claude','--no-path','--yes');
      const code=`const root=${JSON.stringify(root)};const app=require(root+'/askai');const desktop=require(root+'/lib/desktop');desktop.environment=()=>({supported:true,kind:'windows'});desktop.install=()=>{throw Error('Signing Policy Block');};require(root+'/lib/components').byId('markitdown').detect=()=>({state:'ok',detail:'fixture installed'});process.argv=[process.execPath,root+'/askai.js',...${JSON.stringify(args)}];app.main().then(code=>{process.exitCode=code;}).catch(e=>{console.error(e);process.exitCode=9;});`;
      return cp.spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:30000});
    };
    const normal=run(false);assert.equal(normal.status,0,normal.stdout+normal.stderr);assert.match(normal.stdout,/desktop\s+needs-you/);assert.ok(fs.existsSync(path.join(home,'askai','app','askai.js')));
    const explicit=run(true);assert.equal(explicit.status,1,explicit.stdout+explicit.stderr);assert.match(explicit.stdout,/desktop\s+failed/);
  }finally{rm(home);}
});
