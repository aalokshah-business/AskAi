'use strict';
// Read a node:test TAP log. Print every skip and its reason.
// On Linux, a skip that only exists because bash or a fake gh was missing fails the run.
const fs = require('fs');
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const skips = text.split(/\n/).filter(l => /# SKIP\b/.test(l) || /^# skip\b/i.test(l));
for (const line of skips) console.log(line);
console.log(`skips: ${skips.length}`);
const silent = skips.filter(l => !/# SKIP\s+\S/.test(l) && !/^# skip\s+\S/i.test(l));
if (silent.length) {
  console.error('A test skipped without a reason.');
  process.exit(1);
}
if (process.platform === 'linux') {
  const blocked = skips.filter(l => /needs bash|fake gh/i.test(l));
  if (blocked.length) {
    console.error('Linux skipped a bash or fake-gh test. Those must run on Tier 1.');
    process.exit(1);
  }
}
