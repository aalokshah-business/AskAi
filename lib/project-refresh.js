'use strict';
// askai project refresh: create only missing init files, rewrite the project map, then print review state.
const path = require('path');
const project = require('./project');
const review = require('./project-review');

function run(dir, o = {}) {
  dir = path.resolve(dir);
  const ctx = { ...(o.ctx || {}), which: () => null };
  const initResult = project.init(dir, { yes: true, dry: !!o.dry, missingOnly: true, references: [] }, ctx, () => {});
  const created = (initResult.plan || []).filter(p => p[0] === 'create').length;
  const early = !o.dry && created === 0 ? review.status(dir) : null;
  if (early && early.state === 'current') {
    const lines = [
      `askai project refresh  ${dir}`,
      'init: up to date',
      'map: current',
    `review: current (${early.scanned}/${early.eligible} scanned)`,
    require('./daily').hideLocal(dir, {}).text,
  ];
    return { text: lines.join('\n'), created, review: early };
  }
  project.map(dir, { dry: !!o.dry }, () => {});
  const rev = o.dry ? { state: 'skipped', scanned: null, eligible: null } : review.status(dir);
  const lines = [
    `askai project refresh  ${dir}`,
    created ? `init: ${created} created` : 'init: up to date',
    'map: docs/ai/PROJECT_MAP.md',
    rev.scanned == null ? `review: ${rev.state}` : `review: ${rev.state} (${rev.scanned}/${rev.eligible} scanned)`,
    o.dry ? 'hide-local: skipped' : require('./daily').hideLocal(dir, {}).text,
  ];
  return { text: lines.slice(0, 8).join('\n'), created, review: rev };
}
module.exports = { run };
