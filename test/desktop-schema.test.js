'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {schema,buildArgs}=require('../lib/desktop-schema'),{optionTypes,parseArgs}=require('../askai');
const help=require('../lib/help'),desktop=require('../lib/desktop');
test('every public command has structured forms using recognized CLI options',()=>{
  for(const name of help.names()){
    const forms=schema(name,optionTypes);assert.ok(forms.length,name);
    for(const form of forms){assert.ok(Array.isArray(form.positionals),name);for(const option of form.options)assert.ok(optionTypes[option.flag],name+': '+option.flag);}
  }
});
test('forms identify mandatory fields and options before invoking a process',()=>{
  assert.throws(()=>buildArgs('why',{variant:0,fields:{}},optionTypes),/Required: finding id/);
  assert.throws(()=>buildArgs('start',{variant:0},optionTypes),/Required: tool/);
  assert.deepEqual(buildArgs('start',{variant:0,options:[{flag:'tool',value:'codex'},{flag:'task',value:'Fix paths with spaces'}]},optionTypes),['--tool','codex','--task','Fix paths with spaces']);
  const confirm=schema('mcp',optionTypes).find(row=>row.label==='confirm');
  assert.equal(confirm.options.filter(row=>row.required).length,3);
  assert.throws(()=>buildArgs('mcp',{variant:confirm.id,fields:{server:'serena'}},optionTypes),/Required: tool/);
});
test('typed options, branches and paths reach the CLI without shell quoting',()=>{
  const options=[{flag:'host',value:'codex'},{flag:'json',value:'true'}];
  assert.deepEqual(parseArgs(['status',...buildArgs('status',{variant:0,options},optionTypes)]),{_:['status'],host:'codex',json:true});
  assert.throws(()=>buildArgs('status',{variant:0,options:[{flag:'host',value:'bad'}]},optionTypes),/valid host/);
  assert.throws(()=>buildArgs('status',{variant:0,options:[...options,options[0]]},optionTypes),/duplicate/);
  const rename=schema('project',optionTypes).find(row=>row.label==='rename');
  assert.deepEqual(buildArgs('project',{variant:rename.id,fields:{'old name':'One project','new name':'Two projects'}},optionTypes),['rename','One project','Two projects']);
  assert.deepEqual(buildArgs('run',{variant:0,fields:{command:'node "file with spaces.js"'},options:[{flag:'yes',value:'true'}]},optionTypes),['--yes','--','node','file with spaces.js']);
});
test('result display preserves paragraphs, pretty prints JSON and previews saved Markdown',()=>{
  assert.match(desktop.formatResult({code:0,stdout:'one\ntwo\n\nthree',stderr:'warning\nnext'}).display,/one\ntwo\n\nthree/);
  assert.match(desktop.formatResult({code:0,stdout:'{"one":1,"two":[2,3]}'}).display,/\n  "one": 1,/);
  const {tmpHome,rm,write,path}=require('./helpers'),dir=tmpHome();try{const file=path.join(dir,'converted.md');write(file,'# Title\n\nParagraph one\n\nParagraph two\n');assert.match(desktop.formatResult({code:0,stdout:'Saved',output:file}).display,/Markdown preview\n# Title\n\nParagraph one\n\nParagraph two/);}finally{rm(dir);}
});
