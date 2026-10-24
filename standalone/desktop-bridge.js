#!/usr/bin/env node
'use strict';
const fs=require('fs'),desktop=require('../lib/desktop');
(async()=>{
  if(process.argv[2]==='--catalog'){console.log(JSON.stringify(desktop.catalog()));return;}
  const file=process.argv[2];
  if(!file || fs.statSync(file).size>1024*1024)throw Error('Invalid desktop request file.');
  const data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  console.log(JSON.stringify(await desktop.request(data)));
})().catch(error=>{console.log(JSON.stringify({code:1,stdout:'',stderr:error.message}));process.exitCode=1;});
