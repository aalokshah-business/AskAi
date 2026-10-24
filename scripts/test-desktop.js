#!/usr/bin/env node
'use strict';
// Actual GUI control construction and clipboard-handler tests, without changing the user's clipboard.
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const root=path.join(__dirname,'..'),desktop=require('../lib/desktop');
if(process.platform==='win32'){
  const result=cp.spawnSync(desktop.build(),['--self-test',root,process.execPath],{encoding:'utf8',timeout:30000,windowsHide:true});
  if(result.status!==0)throw Error(result.stderr || result.stdout || result.error);
  console.log(result.stdout.trim());
}else if(process.platform==='linux'){
  const file=path.join(os.tmpdir(),`askai-gui-test-${require('crypto').randomUUID()}.json`);
  try{
    const result=cp.spawnSync('python3',[path.join(root,'standalone','desktop.py'),'--app-root',root,'--node',process.execPath,'--smoke-test','--ready',file],{encoding:'utf8',timeout:30000});
    if(result.status!==0)throw Error(result.stderr || result.stdout || result.error);
    const ready=JSON.parse(fs.readFileSync(file,'utf8'));if(!ready.ok)throw Error(ready.error);
    console.log('Linux Tkinter form, required fields, file picker and multiline copy passed.');
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);}
}else console.log('GUI smoke test supports Windows/Linux.');
