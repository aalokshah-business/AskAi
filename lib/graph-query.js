'use strict';
// Bound the optional local query process. Never rebuild a graph or invoke an AI model.
const fs=require('fs'), path=require('path'), cp=require('child_process');
function status(dir) {
  const file=path.join(dir,'graphify-out','graph.json');
  if(!fs.existsSync(file))return {state:'missing',newerFiles:[],note:'Build explicitly with graphify update .; use rg meanwhile.'};
  const modified=fs.statSync(file).mtimeMs;
  const scan=require('./scan'), files=scan.trackedFiles(dir);
  if(!files)return {state:'unknown',newerFiles:[],note:'No Git file inventory; freshness cannot be established.'};
  const newer=files.filter(f=>scan.SOURCE_EXT.has(path.extname(f).slice(1).toLowerCase())).filter(f=>{try{return fs.statSync(path.join(dir,f)).mtimeMs>modified;}catch{return false;}});
  return {state:newer.length?'possibly-stale':'no-newer-source-observed',newerCount:newer.length,newerFiles:newer.slice(0,20),note:'Modification times are a heuristic, not proof of graph completeness. No rebuild ran.'};
}
function query(dir,text,options={}) {
  if(!String(text || '').trim())throw new Error('usage: askai graph query "question"');
  const timeout=options.timeout===undefined?10:Number(options.timeout),budget=options.budget===undefined?600:Number(options.budget);
  if(!Number.isFinite(timeout)||timeout<1||timeout>60||!Number.isInteger(budget)||budget<100||budget>4000)throw new Error('--timeout must be 1–60 seconds; --budget must be 100–4000 tokens');
  const freshness=status(dir),exe=options.exe || require('./sys').which('graphify');
  const fallback='Use rg for a targeted search. Refresh explicitly with graphify update . when needed.';
  if(freshness.state==='missing'||!exe)return Promise.resolve({state:!exe?'not-installed':'missing-graph',freshness,output:'',fallback});
  return new Promise(resolve=>{
    let child,timer,settle,reason='',output='',finished=false;
    const finish=state=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(settle);resolve({state,freshness,output:state==='ok'?output:'',fallback:state==='ok'?'':fallback});};
    const stop=state=>{
      if(reason)return;reason=state;
      try{if(process.platform==='win32')cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:2000});else process.kill(-child.pid,'SIGTERM');}catch{try{child.kill();}catch{/* reported below */}}
      child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
      settle=setTimeout(()=>{child.unref();finish('cleanup-unconfirmed');},1500);
    };
    try{
      child=cp.spawn(exe,[...(options.prefixArgs || []),'query',text,'--budget',String(budget)],{cwd:dir,stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
      child.stdin.end();child.on('error',()=>finish('failed-to-start'));
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>128*1024)stop('output-limit');});
      child.stderr.on('data',()=>{});
      child.on('close',code=>finish(reason || (code===0?'ok':'failed')));
      timer=setTimeout(()=>stop('timeout'),timeout*1000);
    }catch{finish('failed-to-start');}
  });
}
module.exports={status,query};
