'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpHome, rm, makeCtx, fs, path } = require('./helpers');
const columns = require('../lib/columns');
const infra = require('../lib/infra');
const status = require('../lib/status');
const session = require('../lib/session');
const selftest = require('../lib/selftest');
const findings = require('../lib/findings');

test('tables preserve long evidence and align continuation columns within terminal width', () => {
  const evidence = 'compile_commands.json must describe the firmware build and all generated include directories';
  const lines = columns.table(['Tool', 'Evidence'], [['Cursor', evidence], ['Codex', 'not measured']], {width:60});
  assert.ok(lines.every(line => line.length <= 60));
  const starts = lines.filter(line => line.includes(' | ')).map(line => line.indexOf(' | '));
  assert.ok(starts.every(n => n === starts[0]));
  const text = lines.join('\n');
  for (const word of evidence.split(' ')) assert.ok(text.includes(word), word);
  assert.ok(!text.includes('…'));
  assert.match(columns.table(['Tool','Scope','Finding','Evidence','Next'], [['Cursor','project','navigation','no compile database','configure build']], {width:60}).join('\n'), /Evidence: no compile database/);
});

test('infra does not claim a desktop exists from a configuration path', () => {
  const text = infra.render({tools:{agy:{config:'/home/dev/.gemini'},cursor:{config:'/home/dev/.cursor'}},environment:{container:true,missingBaseTools:['jq','gh']}});
  assert.doesNotMatch(text, /Desktop IDE present/);
  assert.match(text, /desktop not verified/);
  assert.match(text, /Base tools missing: jq, gh/);
  assert.match(text, /remote workspace/);
  assert.match(infra.opLabel('cursor','serena',true,{cursor:{}}), /no call observed/);
});

test('Cursor infra requirements do not borrow Claude rules or Claude-only recommendations', () => {
  const home = tmpHome();
  try {
    const ctx = makeCtx(home,{cursorHome:path.join(home,'cursor')});
    ctx.opts.host = 'cursor';
    ctx.which = bin => bin === 'rg' ? '/usr/bin/rg' : null;
    const result = infra.collect(ctx,null);
    assert.equal(result.assets.required.find(r => r.name === 'terse block').ok,false);
    assert.equal(result.assets.recommended.find(r => r.name === 'base-tools').ok,false);
    assert.ok(!result.assets.recommended.some(r => /Claude/.test(r.name)));
    assert.deepEqual(result.environment.missingBaseTools,['jq','gh']);
  } finally { rm(home); }
});

test('status adapts environment columns to a narrow container terminal', () => {
  const home = tmpHome();
  try {
    const lines = status.renderStatus(makeCtx(home), null, {width:60}).lines;
    assert.ok(lines.includes('Codex') && lines.includes('Antigravity') && lines.includes('Cursor') && lines.includes('Claude Code'));
    assert.ok(!lines.some(line => /Codex\s+Antigravity/.test(line)));
  } finally { rm(home); }
});

test('blank and invalid measurements never create fake observations', () => {
  const home = tmpHome(); const output = [];
  try {
    assert.equal(session.run('measure',{repo:home}, line => output.push(line)),1);
    assert.equal(session.run('measure',{repo:home,tool:'cursor',task:'test',success:'1',minutes:'NaN'},()=>{}),1);
    assert.ok(!fs.existsSync(path.join(home,'.ai-work','measurements.csv')));
    assert.match(output.join('\n'), /No measurement saved/);
    assert.equal(session.run('measure',{repo:home,tool:'cursor',task:'test',success:'1',minutes:'2'},()=>{}),0);
    assert.ok(fs.existsSync(path.join(home,'.ai-work','measurements.csv')));
  } finally { rm(home); }
});

test('self-test includes weigh input and quotes shell expressions with expected failure exits', () => {
  const home = selftest.makeFixture();
  try { assert.ok(fs.existsSync(path.join(home,'AGENTS.md'))); } finally { rm(home); }
  const steps = selftest.fullPlan();
  const failingRun = steps.find(s => s.args[0] === 'run' && s.args.at(-1).includes('exit(1)'));
  assert.equal(failingRun.args.at(-1), '"process.exit(1)"');
  assert.equal(failingRun.expect.exit,1);
  for (const args of [['mcp','on'],['mcp','off'],['why','handoff.empty']]) {
    assert.equal(selftest.lookReason({args,label:args.join(' '),code:1,stdout:'argument required',stderr:''}), '');
  }
});

test('check --fix --dry-run does not create a project pack', () => {
  const home = tmpHome(); const collect = findings.collectFindings;
  findings.collectFindings = () => [];
  try {
    require('../lib/check').run(makeCtx(home),home,{fix:true,dry:true},()=>{});
    assert.ok(!fs.existsSync(path.join(home,'AGENTS.md')));
    assert.ok(!fs.existsSync(path.join(home,'.ai-work')));
  } finally { findings.collectFindings = collect; rm(home); }
});

test('audit groups findings and labels cross-tool candidate estimates without truncation', () => {
  const home = tmpHome();
  try {
    fs.writeFileSync(path.join(home,'AGENTS.md'),'# Shared project instructions\nSearch the relevant source files before reading.\n');
    const output = [];
    const ctx = makeCtx(home);
    require('../lib/audit').run(ctx,home,{width:80},line=>output.push(line));
    const text = output.join('\n');
    assert.match(text, /\[OK\]|\[MEDIUM\]|\[HIGH\]/);
    const json = [];
    require('../lib/audit').run(ctx,home,{json:true},line=>json.push(line));
    const rows = JSON.parse(json.join(''));
    assert.ok(rows.some(r => r.finding === 'Memory files in scope' && r.cost.includes('all tools combined')));
    assert.ok(rows.every(r => !/tokens per session|every session and subagent/.test(r.cost)));
    assert.match(text, /Memory estimates use characters/);
    assert.ok(!text.includes('…'));
  } finally { rm(home); }
});
