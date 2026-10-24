#!/usr/bin/env node
'use strict';
// Hash clean-checkout bytes according to .gitattributes, independently of local newline differences.
// Run it before tagging a release: node scripts/sums.js
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
function checkoutBytes(data,attrs={}) {
  if(attrs.text==='unset'||(attrs.text==='auto'&&data.subarray(0,8000).includes(0))||!['lf','crlf'].includes(attrs.eol))return data;
  const lf=data.toString('latin1').replace(/\r\n/g,'\n');
  return Buffer.from(attrs.eol==='crlf'?lf.replace(/\n/g,'\r\n'):lf,'latin1');
}
function attributes(root,files) {
  const result=cp.spawnSync('git',['-C',root,'check-attr','-z','--stdin','text','eol'],{encoding:'utf8',input:files.join('\0')+'\0'});
  if(result.status!==0)throw Error('Cannot read Git attributes for checksum generation.');
  const values=result.stdout.split('\0'),out=new Map();for(let i=0;i+2<values.length;i+=3){const [file,key,value]=values.slice(i,i+3);if(!out.has(file))out.set(file,{});out.get(file)[key]=value;}return out;
}
function generate(root=ROOT) {
  let files;const g=cp.spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'});
  if(g.status===0&&g.stdout)files=g.stdout.split('\0').filter(Boolean);
  else {files=[];const walk=d=>{for(const n of fs.readdirSync(path.join(root,d))){if(n==='.git'||n==='node_modules'||n==='desktop-bin')continue;const r=d?`${d}/${n}`:n;if(fs.statSync(path.join(root,r)).isDirectory())walk(r);else files.push(r);}};walk('');}
  files=files.filter(f=>f!=='SHA256SUMS.txt'&&fs.existsSync(path.join(root,f))).sort();
  const attrs=g.status===0?attributes(root,files):new Map();
  const lines=files.map(f=>`${crypto.createHash('sha256').update(checkoutBytes(fs.readFileSync(path.join(root,f)),attrs.get(f))).digest('hex')}  ${f}`);
  fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),lines.join('\n')+'\n');return files.length;
}
if(require.main===module)console.log(`SHA256SUMS.txt: ${generate()} files (clean-checkout bytes)`);
module.exports={checkoutBytes,attributes,generate};
