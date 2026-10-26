#!/usr/bin/env node
'use strict';
const fs=require('fs'),desktop=require('../lib/desktop');
(async()=>{
  if(process.argv[2]==='--catalog'){console.log(JSON.stringify(desktop.catalog()));return;}
  if(process.argv[2]==='--mode'){
    const cfg=require('../lib/claude-config');
    let manifest={};
    try{manifest=cfg.loadManifest(cfg.claudePaths(cfg.defaultClaudeHome(),true));}catch(_){/* no manifest yet: every tab stays enabled */}
    console.log(JSON.stringify(desktop.mode({manifest})));return;
  }
  const file=process.argv[2];
  if(!file || fs.statSync(file).size>1024*1024)throw Error('Invalid desktop request file.');
  const data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  console.log(JSON.stringify(await desktop.request(data)));
})().catch(error=>{console.log(JSON.stringify({code:1,stdout:'',stderr:error.message}));process.exitCode=1;});
