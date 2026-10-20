#!/usr/bin/env node
'use strict';
// Regenerate SHA256SUMS.txt for every tracked file (git ls-files), or every file when this is not a git checkout.
// Run it before tagging a release: node scripts/sums.js
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let files;
const g = cp.spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' });
if (g.status === 0 && g.stdout.trim()) files = g.stdout.trim().split('\n');
else { files = []; const walk = d => { for (const n of fs.readdirSync(path.join(ROOT, d))) { if (n === '.git' || n === 'node_modules') continue; const r = d ? `${d}/${n}` : n; if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else files.push(r); } }; walk(''); }
files = files.filter(f => f !== 'SHA256SUMS.txt' && fs.existsSync(path.join(ROOT, f))).sort();
const lines = files.map(f => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')}  ${f}`);
fs.writeFileSync(path.join(ROOT, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`SHA256SUMS.txt: ${files.length} files`);
