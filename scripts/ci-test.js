#!/usr/bin/env node
'use strict';
// Preserve full TAP while making failures visible in Actions logs on every OS.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.join(__dirname,'..'),file=path.join(root,'tap.txt'),log=fs.openSync(file,'w');
const tests=fs.readdirSync(path.join(root,'test')).filter(n=>n.endsWith('.test.js')).sort().map(n=>path.join(root,'test',n));
let result;try{result=cp.spawnSync(process.execPath,['--test','--test-reporter','tap',...tests],{cwd:root,stdio:['ignore',log,log],timeout:900000});}finally{fs.closeSync(log);}
const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);let failure=false,budget=300;
for(const line of lines){if(/^\s*not ok\b/.test(line))failure=true;if((failure||/^# (tests|pass|fail|skipped|duration_ms)\b/.test(line))&&budget-->0)console.log(line);if(failure&&/^\s*\.\.\.\s*$/.test(line))failure=false;}
if(result.error)console.error(result.error.message);process.exitCode=result.status ?? 1;
