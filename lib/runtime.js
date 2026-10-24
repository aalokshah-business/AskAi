'use strict';
// Runtime identity is independent of version labels and never reads credentials or Git remotes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
function fingerprint(root) {
  const files = [];
  const walk = rel => {
    const file = path.join(root,rel);
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(rel,name));
    else if (stat.isFile()) files.push(rel);
  };
  for (const name of ['askai.js','package.json','lib','commands','templates','knowledge','standalone','hooks/askai-report.js','scripts/gen-docs.js','scripts/validate-install.js']) walk(name);
  if(fs.existsSync(path.join(root,'docs')))for(const name of fs.readdirSync(path.join(root,'docs')).sort())if(/\.(md|png)$/i.test(name))walk(path.join('docs',name));
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) hash.update(file.replace(/\\/g,'/')).update('\0').update(fs.readFileSync(path.join(root,file))).update('\0');
  return hash.digest('hex');
}
function identity(root) {
  root = path.resolve(root);
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(path.join(root,'runtime.json'),'utf8')); } catch (_) { /* development/old runtime */ }
  let revision = saved.revision || null; let dirty = saved.dirty ?? null;
  if (fs.existsSync(path.join(root,'.git'))) {
    const git = args => cp.spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:2000,windowsHide:true});
    const head=git(['rev-parse','HEAD']); if (head.status === 0) revision=head.stdout.trim();
    const status=git(['status','--porcelain','--untracked-files=no']); if (status.status === 0) dirty=!!status.stdout.trim();
  }
  let contentHash;try{contentHash=fingerprint(root);}catch{contentHash=null;}
  return {root,revision,dirty,contentHash,integrity:!contentHash?'unreadable':saved.contentHash ? (saved.contentHash===contentHash ? 'matches-install-stamp' : 'changed-since-install') : 'unstamped'};
}
function stamp(source,dest) {
  const data=identity(source);
  const saved={revision:data.revision,dirty:data.dirty,contentHash:fingerprint(dest),installedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(dest,'runtime.json'),JSON.stringify(saved,null,2)+'\n');
  return saved;
}
function describe(root) {
  const data=identity(root);
  return `runtime ${data.revision ? data.revision.slice(0,12) : 'revision unknown'}${data.dirty ? ' (local edits)' : ''} · ${data.root} · ${data.integrity}`;
}
function inventory(root,paths) {
  const current=identity(root), seen=new Set();const copies=[];
  for(const folder of [root,...paths]) {
    const resolved=path.resolve(folder);if(seen.has(resolved)||!fs.existsSync(path.join(resolved,'askai.js')))continue;seen.add(resolved);
    const data=identity(resolved);copies.push({...data,matchesCurrent:!!data.contentHash && data.contentHash===current.contentHash});
  }
  return {...current,copies};
}
module.exports={fingerprint,identity,stamp,describe,inventory};
