'use strict';
// Records which source revision received a host-agent review; never claims the review happened by itself.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const project = require('./project');
const session = require('./session');
const FILE = 'ai-review.json';
const INPUTS = [...new Set(['README.md', 'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'requirements.txt',
  'pyproject.toml', 'pytest.ini', 'go.mod', 'Cargo.toml', 'tsconfig.json', 'platformio.ini',
  'build.gradle', 'build.gradle.kts', 'settings.gradle.kts', 'Package.swift', 'Podfile', 'CMakeLists.txt', 'mk.sh', ...require('./project-source').MANIFESTS])];

function hashes(dir, source) {
  const files = { ...source.fileHashes };
  for (const rel of INPUTS) {
    try { files[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return files;
}

const REMOVED_FRACTION = 0.2;
function save(dir, source, reviewedAt) {
  session.ensure(dir, false);
  const body = { version: 2, reviewedAt: reviewedAt || null, scanned: source.scanned, eligible: source.eligible, skipped: source.skipped, files: hashes(dir, source) };
  fs.writeFileSync(path.join(dir, session.DIR, FILE), JSON.stringify(body, null, 2));
  return body;
}
function status(dir, o = {}) {
  const source = project.detect(dir).source;
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(path.join(dir, session.DIR, FILE), 'utf8')); } catch (_) { /* first run */ }
  const before = previous?.files || {};
  const current = hashes(dir, source);
  const changed = Object.keys(current).filter(f => current[f] !== before[f]);
  const removed = Object.keys(before).filter(f => !current[f]);
  const limit = o.removedFraction == null ? REMOVED_FRACTION : Number(o.removedFraction);
  const removedFraction = Object.keys(before).length ? removed.length / Object.keys(before).length : 0;
  let state = !previous ? 'needed' : changed.length || removedFraction > limit ? 'stale' : 'current';
  let refreshed = false;
  if (previous && !changed.length && removed.length && removedFraction <= limit) {
    save(dir, source, previous.reviewedAt);
    state = 'current';
    refreshed = true;
  }
  const scanned = state === 'current' && previous && previous.scanned != null && !refreshed ? previous.scanned : source.scanned;
  return { state, refreshed, scanned, eligible: source.eligible, skipped: source.skipped,
    changedCount: changed.length, removedCount: removed.length,
    changed: o.all ? changed : changed.slice(0, 40), removed: o.all ? removed : removed.slice(0, 40),
    pathsTruncated: !o.all && (changed.length > 40 || removed.length > 40),
    skippedFiles: source.skippedFiles.slice(0, 40), truncated: !!source.truncated,
    reviewedAt: previous?.reviewedAt || null };
}
function done(dir) {
  const source = project.detect(dir).source;
  const reviewedAt = new Date().toISOString();
  save(dir, source, reviewedAt);
  return { state: 'current', reviewedAt, scanned: source.scanned, eligible: source.eligible, skipped: source.skipped };
}
module.exports = { status, done };
