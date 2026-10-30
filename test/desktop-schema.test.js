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
  assert.throws(()=>buildArgs('why',{variant:0,fields:{}},optionTypes),/Required: Finding Id/);
  assert.throws(()=>buildArgs('start',{variant:0},optionTypes),/Required: Tool/);
  assert.deepEqual(buildArgs('start',{variant:0,options:[{flag:'tool',value:'codex'},{flag:'task',value:'Fix paths with spaces'}]},optionTypes),['--tool','codex','--task','Fix paths with spaces']);
  const confirm=schema('mcp',optionTypes).find(row=>row.label==='confirm');
  assert.equal(confirm.options.filter(row=>row.required).length,3);
  assert.throws(()=>buildArgs('mcp',{variant:confirm.id,fields:{server:'serena'}},optionTypes),/Required: Tool/);
  assert.equal(schema('project',optionTypes)[0].positionals.find(row=>row.name==='directory').picker,'folder');
  assert.equal(schema('start',optionTypes)[0].options.find(row=>row.flag==='repo').picker,'folder');
  assert.equal(schema('install',optionTypes)[0].options.find(row=>row.flag==='no-path').picker,undefined);
  assert.equal(schema('weigh',optionTypes)[0].options.find(row=>row.flag==='threshold').hint,'Number');
  assert.equal(schema('context',optionTypes).find(row=>row.label==='percent').positionals[0].hint,'Number');
});
test('typed options, branches and paths reach the CLI without shell quoting',()=>{
  const options=[{flag:'host',value:'codex'},{flag:'json',value:'true'}];
  assert.deepEqual(parseArgs(['status',...buildArgs('status',{variant:0,options},optionTypes)]),{_:['status'],host:'codex',json:true});
  assert.throws(()=>buildArgs('status',{variant:0,options:[{flag:'host',value:'bad'}]},optionTypes),/valid Host/);
  assert.throws(()=>buildArgs('status',{variant:0,options:[...options,options[0]]},optionTypes),/duplicate/);
  const rename=schema('project',optionTypes).find(row=>row.label==='rename');
  assert.deepEqual(buildArgs('project',{variant:rename.id,fields:{'old name':'One project','new name':'Two projects'}},optionTypes),['rename','One project','Two projects']);
  assert.deepEqual(buildArgs('run',{variant:0,fields:{command:'node "file with spaces.js"'},options:[{flag:'yes',value:'true'}]},optionTypes),['--yes','--','node','file with spaces.js']);
});
test('result display preserves paragraphs, pretty prints JSON and previews saved Markdown',()=>{
  assert.match(desktop.formatResult({code:0,stdout:'one\ntwo\n\nthree',stderr:'warning\nnext'}).display,/one\ntwo\n\nthree/);
  assert.match(desktop.formatResult({code:0,stdout:'{"one":1,"two":[2,3]}'}).display,/\n  "one": 1,/);
  const {tmpHome,rm,write,path}=require('./helpers'),dir=tmpHome();try{const file=path.join(dir,'converted.md');write(file,'# Title\n\nParagraph one\n\nParagraph two\n');assert.match(desktop.formatResult({code:0,stdout:'Saved',output:file}).display,/Markdown Preview\n# Title\n\nParagraph one\n\nParagraph two/);}finally{rm(dir);}
});
test('Markdown Preview shows a converted file verbatim, not re-cased',()=>{
  // A converted document's own heading (a YouTube title, a PDF's first line, ...) is source content, not an
  // askai-generated label: re-casing it corrupts data the preview claims to show exactly as written to disk.
  const {tmpHome,rm,write,path}=require('./helpers'),dir=tmpHome();
  try{
    const file=path.join(dir,'converted.md');
    write(file,"## give me 10 mins and i'll save you tokens\n\nbody text stays as-is\n");
    assert.match(desktop.formatResult({code:0,stdout:'Saved',output:file}).display,/Markdown Preview\n## give me 10 mins and i'll save you tokens\n\nbody text stays as-is/);
  }finally{rm(dir);}
});
test('heading title case preserves commands, paths, inline code, data and contractions',()=>{
  assert.equal(desktop.titleHeadings('# next steps for `askai cli`\naskai cli --repo /my/path\nrule file | result\n----------+-------\nmodel_id | myModel'), '# Next Steps For `askai cli`\naskai cli --repo /my/path\nRule File | Result\n----------+-------\nmodel_id | myModel');
  assert.equal(desktop.titleHeadings("# don't break this"), "# Don't Break This");
});
test('GUI help uses the complete command help and preserves its command syntax',async()=>{
  const result=await desktop.request({kind:'command',project:require('os').tmpdir(),command:'help',args:'command mcp --advanced'});
  assert.equal(result.code,0);assert.match(result.display,/confirm NAME --tool T --success 1\|0/);assert.match(result.display,/Usage:/);
});
test('environment selector uses only supported command semantics without duplicate arguments',()=>{
  assert.deepEqual(buildArgs('status',{environment:'codex'},optionTypes),['--host','codex']);
  assert.deepEqual(buildArgs('status',{environment:'antigravity'},optionTypes),['--host','antigravity']);
  const verify=schema('mcp',optionTypes).find(row=>row.label==='verify');
  assert.deepEqual(buildArgs('mcp',{variant:verify.id,environment:'cursor'},optionTypes),['verify','--tool','cursor']);
  assert.deepEqual(buildArgs('go',{environment:'codex',fields:{task:'Fix alignment'}},optionTypes),['codex','Fix alignment']);
  assert.throws(()=>buildArgs('version',{environment:'codex'},optionTypes),/Valid Environment/);
  assert.equal(schema('version',optionTypes)[0].environment.defaultLabel,'Project Scope');
  assert.throws(()=>buildArgs('status',{environment:'codex',options:[{flag:'host',value:'cursor'}]},optionTypes),/Already Set/);
  assert.throws(()=>buildArgs('start',{environment:''},optionTypes),/Required: Environment/);
});
