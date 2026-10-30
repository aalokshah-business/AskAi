'use strict';
// Shared form definitions for both desktops. CLI help and parser remain the source for option names/types.
const help=require('./help');
const title=value=>value.replace(/\b[a-z]/g,c=>c.toUpperCase());
const pickerKind=name=>{const text=String(name||'').toLowerCase().replace(/-/g,' ');if(/\bfile\b/.test(text))return 'file';if(/\b(?:dir|directory|folder|path|repo)\b/.test(text))return 'folder';return '';};
const numeric=/token|minute|percent|timeout|budget|threshold|count|port|days/;
const fieldCue=name=>numeric.test(String(name||'').toLowerCase())?'Number':'';
const optionCue=(command,flag)=>{
  const entry=help.H[command],blobs=[entry.usage,...(entry.options||[]).map(row=>row[0])];
  for(const blob of blobs){
    const match=new RegExp('(?:^|[\\s\\[])--'+flag+'(?:=|\\s+)(\\[?[A-Za-z0-9_.,|-]+\\]?)').exec(blob);
    if(!match)continue;
    const token=match[1].replace(/^\[|\]$/g,'');
    if(token.includes('|'))return '';
    if(/^(?:N|NUM|#)$/i.test(token)||numeric.test(flag))return 'Number';
    if(/^(?:DIR|DIRECTORY|FOLDER)$/i.test(token))return 'Folder';
    if(/^PATH$/i.test(token))return 'Path';
    if(/^FILE$/i.test(token))return 'File';
    if(/^URL$/i.test(token))return 'URL';
    if(/^ID$/i.test(token))return 'Id';
    if(/^(?:TEXT|MSG|MESSAGE)$/i.test(token))return 'Text';
    if(/^HOST$/i.test(token))return 'Host';
    if(/^(?:M|MODEL)$/i.test(token)||/model/.test(flag))return 'Model name';
    if(/^[A-Z][A-Z0-9_-]{1,}$/.test(token))return token.charAt(0)+token.slice(1).toLowerCase();
  }
  return numeric.test(flag)?'Number':'';
};
const field=(name,required=true,choices)=>{const row={name,label:title(name.replace(/-/g,' ')),required,...(choices?{choices}:{})};const pick=!choices&&pickerKind(name);if(pick)row.picker=pick;const hint=!choices&&!pick&&fieldCue(name);if(hint)row.hint=hint;return row;};
const variant=(label,positionals=[],flags='',required=[])=>({label,positionals,flags,required});
const forms={
  start:[variant('default',[],'tool task repo',['tool','task'])],
  go:[variant('default',[field('tool',true,['claude','codex','cursor','agy']),field('task',false)],'tier files done resume dry-run')],
  tools:[variant('update',[],'target')],
  session:['init','pause','status','finish','measure','report','quota','quota plan','quota report'].map(label=>variant(label,[],label==='quota plan'?'name tool task model effort account-label acceptance':label==='quota'?'name tool used window window-id usage-source variant phase isolated success task model effort account-label acceptance notes':'tool task difficulty summary next result minutes input-tokens output-tokens cached-tokens success rework-minutes usage-source notes json',label==='quota plan'?['name','tool','task','model','effort','account-label','acceptance']:label==='quota'?['tool','used','window-id']:[])),
  project:[variant('default',[field('directory',false)]),...['list','show'].map(label=>variant(label)),variant('rename',[field('old name'),field('new name')]),variant('path',[field('name'),field('new path')]),variant('remove',[field('name')]),variant('switch',[field('name',false)]),variant('refresh',[field('directory',false)]),variant('sync',[field('directory',false)]),variant('hide-local',[field('directory',false)],'personal shared undo'),variant('build',[],'json dry-run'),variant('build select',[field('preset or command')],'json dry-run')],
  set:[variant('project',[field('name')]),variant('project --clear'),variant('default',[field('name')]),variant('default --clear')],
  shell:[variant('init',[field('shell',true,['powershell','bash','zsh'])]),variant('install',[field('shell',true,['powershell','bash','zsh'])],'path',['path']),variant('uninstall')],
  models:[variant('default'),variant('set',[field('tool.tier'),field('model[:effort]')]),variant('verify',[field('tool',false,['claude','codex','cursor','agy'])])],
  mcp:[variant('list',[],'tool json'),variant('verify',[field('server',false)],'tool json record'),variant('on',[field('server')],'tool'),variant('off',[field('server')],'tool unused'),variant('telemetry',[],'json'),variant('connections',[],'tool json'),variant('import',[field('file')],'tool dry-run',['tool']),variant('confirm',[field('server')],'tool success notes test-tool dry-run json',['tool','success','notes'])],
  plugins:[variant('list'),variant('ready',[field('directory',false)]),variant('info',[field('id')]),variant('install',[field('id')]),variant('decisions')],
  convert:[variant('file or URL',[field('file or URL')],'out'),variant('scan',[field('directory',false)],'yes ignore-originals')],
  todo:[variant('default',[field('directory',false)],'all'),variant('done',[field('id')]),variant('undo',[field('id')])],
  graph:[variant('default',[field('directory',false)]),variant('query',[field('question')],'timeout budget'),variant('status',[],'json')],
  help:[variant('default'),variant('category',[field('category',true,Object.keys(help.CATEGORIES))]),variant('command',[field('command',true,help.names().sort())]),variant('all')],
  context:[variant('percent',[field('percent')]),variant('counters',[],'used window',['used','window'])],
  prompt:[variant('request',[field('request')],'tier kind files done mode copy'),variant('safe output',[],'output-safe',['output-safe']),variant('resume',[],'resume')],
  run:[variant('command',[{...field('command'),rest:true}],'save yes')],
  ask:[variant('default',[{...field('words',false),suggestions:require('./kb').KB.map(e=>e.id).sort()}])],
  desktop:[variant('open'),variant('install',[],'yes dry-run no-desktop python'),variant('remove',[],'dry-run'),variant('catalog')],
};
const choices={profile:['lean','minimal','code','docs','full','experimental'],target:['auto','claude','codex','cursor','agy','all'],tool:['claude','codex','cursor','agy'],host:['claude','codex','cursor','antigravity'],for:['claude','codex','cursor','agy'],tier:['chore','build','lead'],success:['1','0'],phase:['before','after'],variant:['baseline','askai'],effort:['low','medium','high','xhigh','max'],caveman:['lite','full','ultra','off'],kind:['bug','feature','design','risky','commit','firmware']};
const extra={install:'profile target retry dry-run yes only skip add no-desktop no-path python main-model subagent-model codex-model markitdown ccusage headroom graphify context7 repomix rtk context-mode caveman lsp',update:'check dry-run agents profile target no-desktop python',init:'name path about type yes refresh offline dry-run build test goal',start:'tool task repo',handoff:'for fill goal next',go:'tier files done resume dry-run'};
function environmentFor(command,definition){
  const flag=['host','tool','target','for'].find(key=>definition.options.some(option=>option.flag===key));
  const field=command==='go'?'tool':null;
  const supported=!!flag||!!field;
  const required=!!field||!!definition.options.find(option=>option.flag===flag&&option.required);
  const values=[['Claude Code','claude'],['Codex','codex'],['Cursor','cursor'],['Antigravity',flag==='host'?'antigravity':'agy']];
  if(flag==='target')values.unshift(['All Environments','all']);
  return {supported,flag:flag||null,field,required,hiddenFields:command==='status'?['environment']:[],defaultLabel:required?'Select Environment *':supported?'Default / All':'Project Scope',choices:supported?values.map(([label,value])=>({label,value})):[]};
}
function schema(name,types){
  const entry=help.H[name];if(!entry)throw Error('Unknown command');
  const usage=entry.usage.replace(new RegExp('^askai '+name+'\\s*'),'');
  const mentioned=[...usage.matchAll(/--([a-z][a-z-]*)/g)].map(m=>m[1]);
  for(const row of entry.options||[])for(const match of row[0].matchAll(/--([a-z][a-z-]*)/g))mentioned.push(match[1]);
  const defaultFlags=[...new Set([...mentioned,...(extra[name]||'').split(' ').filter(Boolean)])];
  let definitions=forms[name];
  if(!definitions){
    const positional=usage.replace(/\[--[^\]]*\]/g,'').replace(/--[\w-]+(?:\s+[A-Z][\w|.-]*)?/g,'').replace(/\[(?:install )?options\]/g,'').trim();
    const fields=[];const tokens=positional.match(/\[[^\]]+\]|<[^>]+>|"[^"]+"|\S+/g)||[];
    for(const token of tokens){
      if(token==='|' || token==='--')break;
      if(token.startsWith('[')){const text=token.slice(1,-1).replace(/"/g,'');if(!text || text.startsWith('--'))continue;const label=name==='status'?'environment':['tips','guide'].includes(name)?'topic':name==='docs'?'document':name==='chat'?'client':'action';fields.push(text.includes('|')?field(label,false,text.split('|')):field(text,false));}
      else if(token.startsWith('<')){const text=token.slice(1,-1);fields.push(field(text,true,text.includes('|')&&!['file|url'].includes(text)?text.split('|'):undefined));}
      else if(token.startsWith('"'))fields.push(field(token.slice(1,-1)));
      else if(/^[a-z][a-z|-]*$/i.test(token))fields.push(field(token));
    }
    definitions=[variant('default',fields,defaultFlags.join(' '))];
  }
  return definitions.map((definition,index)=>{
    const flags=definition.flags.split(' ').filter(Boolean);
    const options=[...new Set(flags)].filter(flag=>types[flag]).map(flag=>{const pick=types[flag]!=='boolean'&&!choices[flag]?pickerKind(flag):'';const hint=types[flag]!=='boolean'&&!choices[flag]&&!pick?optionCue(name,flag):'';return {flag,kind:types[flag],label:title(flag.replace(/-/g,' ')),required:(definition.required||[]).includes(flag),...(choices[flag]?{choices:choices[flag]}:{}),...(pick?{picker:pick}:{}),...(hint?{hint}:{})};});
    const result={...definition,id:String(index),options};return {...result,environment:environmentFor(name,result)};
  });
}
function buildArgs(command,data,types){
  const definitions=schema(command,types),selected=definitions.find(v=>v.id===String(data.variant??'0'));
  if(!selected)throw Error('Choose a valid command action.');
  const args=[],fields={...(data.fields||{})},providedOptions=[...(data.options||[])];
  if(data.environment){
    const env=selected.environment;
    if(!env.supported||!env.choices.some(choice=>choice.value===data.environment))throw Error('Choose A Valid Environment.');
    if(env.field)fields[env.field]=data.environment;
    if(env.flag){if(providedOptions.some(row=>row.flag===env.flag))throw Error('Environment Already Set In Options.');providedOptions.push({flag:env.flag,value:data.environment});}
  }
  if(Object.prototype.hasOwnProperty.call(data,'environment') && selected.environment.required && !data.environment && !fields[selected.environment.field] && !providedOptions.some(row=>row.flag===selected.environment.flag))throw Error('Required: Environment');
  if(!['default','file or URL','percent','counters','request','safe output','resume','command'].includes(selected.label))args.push(...selected.label.split(' '));
  if(selected.label==='resume'&&command==='prompt')args.push('--resume');
  for(const item of selected.positionals){
    const value=String(fields[item.name]??'').trim();
    if(!value){if(item.required)throw Error(`Required: ${item.label}`);continue;}
    if(item.choices&&!item.choices.includes(value))throw Error(`Choose a valid ${item.label}.`);
    if(item.rest){args.push('--',...require('../askai').cliArgs(value));}else args.push(value);
  }
  const seen=new Set();
  for(const row of providedOptions){
    const item=selected.options.find(o=>o.flag===row.flag);
    if(!item||seen.has(row.flag))throw Error('Invalid or duplicate command option.');seen.add(row.flag);
    if(item.kind==='boolean'){if(row.value===true||row.value==='true')args.push('--'+item.flag);else if(item.required)throw Error(`Required: ${item.label}`);}
    else{const value=String(row.value??'').trim();if(!value)throw Error(`Value required: ${item.label}`);if(item.choices&&!item.choices.includes(value))throw Error(`Choose a valid ${item.label}.`);args.push('--'+item.flag,value);}
  }
  for(const item of selected.options)if(item.required&&!seen.has(item.flag))throw Error(`Required: ${item.label}`);
  // Options precede the literal command separator used by askai run.
  if(command==='run'){const split=args.indexOf('--');if(split>=0){const count=require('../askai').cliArgs(String(fields.command||'')).length;const trailing=args.splice(split+1+count);args.splice(split,0,...trailing);}}
  return args;
}
module.exports={schema,buildArgs};
