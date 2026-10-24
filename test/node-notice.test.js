'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tmpHome,rm,fs,path,write}=require('./helpers');
const app=require('../askai'),platform=require('../lib/platform'),cfg=require('../lib/claude-config');
test('Node upgrade notice never creates config for reads, previews or first install',()=>{
  const saved=platform.nodeNotice,print=console.error;platform.nodeNotice=()=> 'Node upgrade fixture';console.error=()=>{};
  try{for(const [cmd,dry] of [['status',false],['suggest',false],['install',true],['install',false]]){
    const home=tmpHome();try{app.emitNodeNotice({claudeHome:home,dry},cmd);assert.deepEqual(fs.readdirSync(home),[]);}finally{rm(home);}
  }}finally{platform.nodeNotice=saved;console.error=print;}
});
test('Node upgrade notice persists only in an existing installation on a write command',()=>{
  const home=tmpHome(),saved=platform.nodeNotice,print=console.error;
  try{platform.nodeNotice=()=> 'Node upgrade fixture';console.error=()=>{};const paths=cfg.claudePaths(home,true);write(paths.manifest,'{}');app.emitNodeNotice({claudeHome:home},'install');assert.match(fs.readFileSync(path.join(paths.askaiDir,'node-eol.txt'),'utf8'),/^\d{4}-\d{2}-\d{2}/);}finally{platform.nodeNotice=saved;console.error=print;rm(home);}
});
