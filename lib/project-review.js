'use strict';
// Records which source revision received a host-agent review; never claims the review happened by itself.
const fs = require('fs');
const path = require('path');
const project = require('./project');
const session = require('./session');
const FILE = 'ai-review.json';

function status(dir) {
  const source = project.detect(dir).source;
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(path.join(dir, session.DIR, FILE), 'utf8')); } catch (_) { /* first run */ }
  const before = previous?.files || {};
  const current = source.fileHashes;
  const changed = Object.keys(current).filter(f => current[f] !== before[f]);
  const removed = Object.keys(before).filter(f => !current[f]);
  const state = !previous ? 'needed' : changed.length || removed.length ? 'stale' : 'current';
  return { state, scanned: source.scanned, eligible: source.eligible, skipped: source.skipped,
    changedCount: changed.length, removedCount: removed.length,
    changed: changed.slice(0, 40), removed: removed.slice(0, 40),
    skippedFiles: source.skippedFiles.slice(0, 40), truncated: !!source.truncated,
    reviewedAt: previous?.reviewedAt || null };
}
function done(dir) {
  const source = project.detect(dir).source;
  session.ensure(dir, false);
  const reviewedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, session.DIR, FILE), JSON.stringify({ version: 1, reviewedAt, files: source.fileHashes }, null, 2));
  return { state: 'current', reviewedAt, scanned: source.scanned, eligible: source.eligible, skipped: source.skipped };
}
module.exports = { status, done };
