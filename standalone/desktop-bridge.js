#!/usr/bin/env node
'use strict';
const fs=require('fs'),desktop=require('../lib/desktop');
(async()=>{
  if(process.argv[2]==='--catalog'){console.log(JSON.stringify(desktop.catalog()));return;}
  if(process.argv[2]==='--mode'){
    const cfg=require('../lib/claude-config');
    // Sandboxed (--claude-home / CLAUDE_CONFIG_DIR) keeps the manifest under that home; a real install's
    // manifest lives under ~/.askai (or the legacy ~/.claude/askai) instead -- the same distinction buildCtx
    // makes in askai.js. Hardcoding sandbox here (as the first version did) reads the wrong file on a real
    // machine and silently falls back to convertOnly:false.
    const sandbox=!!process.env.CLAUDE_CONFIG_DIR;
    let manifest={};
    try{manifest=cfg.loadManifest(cfg.claudePaths(cfg.defaultClaudeHome(),sandbox));}catch(_){/* no manifest yet: every tab stays enabled */}
    console.log(JSON.stringify(desktop.mode({manifest})));return;
  }
  const file=process.argv[2];
  if(!file || fs.statSync(file).size>1024*1024)throw Error('Invalid desktop request file.');
  const data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  console.log(JSON.stringify(await desktop.request(data)));
})().catch(error=>{console.log(JSON.stringify({code:1,stdout:'',stderr:error.message}));process.exitCode=1;});
