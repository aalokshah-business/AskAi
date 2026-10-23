'use strict';
// One file list for map, review, and inventory. A git repo uses git ls-files.
// The result is cached in .ai-work/cache and dropped when git status or a top-level mtime changes.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const SOURCE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'kt', 'kts', 'java', 'swift', 'm', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'cs', 'rb', 'php', 'dart', 'vue', 'svelte']);

function git(dir, args) {
  try {
    const r = cp.spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return r.status === 0 ? String(r.stdout || '') : null;
  } catch (_) { return null; }
}

function signature(dir) {
  const head = git(dir, ['rev-parse', 'HEAD']) || '';
  const status = git(dir, ['status', '--porcelain', '--untracked-files=all']) || '';
  const parts = [head, status];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { /* unreadable */ }
  for (const e of ents) {
    if (e.name === '.ai-work' || e.name === '.git' || e.name === 'node_modules') continue;
    try {
      const st = fs.statSync(path.join(dir, e.name));
      parts.push(`${e.name}:${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch (_) { /* gone */ }
  }
  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}

function noteWorking(started, state) {
  if (!state || state.noted || Date.now() - started < 1000) return;
  state.noted = true;
  try { process.stderr.write('working...\n'); } catch (_) { /* stderr closed */ }
}

function trackedFiles(dir) {
  if (git(dir, ['rev-parse', '--is-inside-work-tree']) == null) return null;
  const listed = git(dir, ['ls-files', '-z']);
  if (listed == null) return null;
  return listed.split('\0').filter(Boolean).map(f => f.replace(/\\/g, '/'));
}

function cacheFile(dir) {
  return path.join(dir, '.ai-work', 'cache', 'detect.json');
}
function readDetect(dir, sig) {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8'));
    if (j && j.sig === sig && j.info) return j.info;
  } catch (_) { /* miss */ }
  return null;
}
function writeDetect(dir, sig, info) {
  try {
    const file = cacheFile(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ sig, info }));
  } catch (_) { /* a read-only folder still returns the live scan */ }
}

function scanSource(dir) {
  dir = path.resolve(dir || '.');
  const sig = signature(dir);
  const cached = readDetect(dir, sig);
  if (cached && Array.isArray(cached.files)) return { files: cached.files, sig, cached: true };
  const files = trackedFiles(dir);
  return { files, sig, cached: false, fromGit: Array.isArray(files) };
}

function toolTimeout(bin) {
  return bin === 'headroom' || bin === 'graphify' ? 3000 : 30000;
}

function handoffState(repo) { return require('./session').handoffState(repo); }
function countUntracked(repo) { return require('./session').countUntracked(repo); }

module.exports = { SOURCE_EXT, signature, noteWorking, trackedFiles, readDetect, writeDetect, scanSource, toolTimeout, handoffState, countUntracked };
