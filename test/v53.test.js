'use strict';
// askai 5.3: help for every command and flag, help all, a usage guide for every installable plugin, askai savings.
const test = require('node:test');
const assert = require('node:assert');
const { tmpHome, rm, write, makeCtx, cli, fs, path } = require('./helpers');
const help = require('../lib/help');
const plugins = require('../lib/plugins');
const ug = require('../lib/usage-guide');
const savings = require('../lib/savings');
const infra = require('../lib/infra');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'askai.js'), 'utf8');
const withHome = fn => { const h = tmpHome(); try { return fn(h); } finally { rm(h); } };

test('every command has help, and askai help all prints all of them', () => {
  const cases = [...new Set([...SRC.matchAll(/^\s+case '([a-z-]+)'/gm)].map(m => m[1]))].filter(c => c !== 'version');
  for (const c of cases) assert.ok(help.has(c), `askai help ${c}`);
  const all = cli(['help', 'all']).out;
  for (const n of help.names()) assert.ok(all.includes(help.H[n].usage), `help all shows ${n}`);
  assert.match(cli([]).out + cli(['help']).out, /askai help all/);
});

test('every flag askai accepts is documented in the help', () => {
  const text = JSON.stringify(help.H) + SRC.slice(SRC.indexOf('const HELP'), SRC.indexOf('`;', SRC.indexOf('const HELP')));
  for (const n of ['BOOL', 'VAL']) {
    const m = new RegExp(`const ${n} = \\{([^}]*)\\}`).exec(SRC);
    for (const f of m[1].match(/'?([a-z0-9-]+)'?:/g).map(x => x.replace(/[':]/g, ''))) if (f.length > 1) assert.ok(text.includes(`--${f}`), `--${f} is documented`);
  }
});

test('every plugin AskAI can install has a usage guide: commands, check, savings, off switch', () => {
  for (const p of plugins.P) {
    if (!(p.how && (p.how.component || p.how.context7 || p.how.npm || p.how.graphify))) continue;
    const u = ug.get(p.id); assert.ok(u, `usage guide for ${p.id}`);
    assert.ok((u.terminal && u.terminal.length) || (u.agent && u.agent.length), `${p.id} has commands`);
    for (const k of ['check', 'savings', 'off']) assert.ok(u[k], `${p.id}.${k}`);
  }
  for (const id of ['caveman', 'lsp', 'ponytail', 'karpathy']) assert.ok(ug.get(id), id);
  const hr = cli(['plugins', 'info', 'headroom']).out;
  for (const w of ['headroom stats', 'headroom_compress', 'headroom_stats', 'Check it works', 'Switch it off', 'Careful']) assert.ok(hr.includes(w), w);
  assert.match(cli(['plugins', 'info', 'litellm']).out, /Not installed by AskAI/);
  assert.strictEqual(cli(['plugins', 'info']).code, 1);
});

test('askai savings runs the reports that exist and says how to add the others', () => withHome(h => {
  const bin = path.join(h, 'bin'); write(path.join(bin, 'rtk'), '#!/bin/sh\necho "Tokens saved: 1234 over 9 commands"\n'); fs.chmodSync(path.join(bin, 'rtk'), 0o755);
  const ctx = makeCtx(h, {}, { tools: { rtk: path.join(bin, 'rtk') } });
  const out = savings.report(ctx, 7, h);
  assert.match(out, /Tokens saved: 1234/); assert.match(out, /ccusage[\s\S]*not installed/); assert.match(out, /\/context-mode:ctx-stats/);
  write(path.join(h, 'graphify-out', 'GRAPH_REPORT.md'), '# g'); assert.match(savings.report(ctx, 7, h), /graph built/);
  assert.strictEqual(cli(['savings', '--claude-home', path.join(h, 'c')]).code, 0);
}));

test('infra points every installed plugin at its usage guide', () => withHome(h => {
  const ctx = makeCtx(h, {}, { tools: { markitdown: '/x/markitdown' } });
  assert.match(infra.render(infra.collect(ctx, null)), /MarkItDown\s+on PATH\s+use: askai plugins info markitdown/);
}));
