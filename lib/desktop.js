'use strict';
// Native Windows UI; all work runs in child processes, with no HTTP listener or model client.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.join(__dirname,'..');
function environment(options={}){
  const platform=options.platform || process.platform,env=options.env || process.env,exists=options.exists || fs.existsSync;
  if(platform==='win32')return {supported:true,kind:'windows'};
  if(platform!=='linux')return {supported:false,reason:'desktop app supports Windows and Linux'};
  if(require('./platform').inContainer(env,exists) || exists('/run/.containerenv'))return {supported:false,reason:'Docker/container environment'};
  if(!env.DISPLAY && !env.WAYLAND_DISPLAY)return {supported:false,reason:'no graphical Linux session (DISPLAY/WAYLAND_DISPLAY missing)'};
  return {supported:true,kind:'linux'};
}
const LINUX_MARKER='# Managed by AskAI desktop';
function linuxEntry(root,node,python){
  const quote=value=>{
    if(/[\r\n\x00]/.test(value))throw Error('Invalid desktop launcher path.');
    return '"'+value.replace(/%/g,'%%').replace(/[\\`"$]/g,'\\$&').replace(/\\/g,'\\\\')+'"';
  };
  return `${LINUX_MARKER}\n[Desktop Entry]\nType=Application\nName=Ask AI\nComment=Markdown conversion and AskAI commands\nExec=${[python,path.join(root,'standalone','desktop.py'),'--app-root',root,'--node',node].map(quote).join(' ')}\nIcon=utilities-terminal\nTerminal=false\nCategories=Development;Utility;\n`;
}
function linuxShortcuts(ctx,python,remove=false){
  const home=ctx.env?.HOME || require('os').homedir(),env=ctx.env || process.env;
  const data=env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:path.join(home,'.local','share');
  let desktop=path.join(home,'Desktop');
  try { const dirs=fs.readFileSync(path.join(home,'.config','user-dirs.dirs'),'utf8');const match=/^XDG_DESKTOP_DIR="([^"\n]+)"/m.exec(dirs);if(match){const value=match[1].replace(/^\$HOME(?=\/|$)/,home);if(path.isAbsolute(value))desktop=value;} }catch{}
  const files=[path.join(data,'applications','askai.desktop')];if(fs.existsSync(desktop))files.push(path.join(desktop,'askai.desktop'));
  for(const file of files)if(fs.existsSync(file) && !fs.readFileSync(file,'utf8').startsWith(LINUX_MARKER+'\n'))throw Error(`Preserved unrelated launcher: ${file}`);
  for(const file of files){if(remove){if(fs.existsSync(file))fs.unlinkSync(file);}else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,linuxEntry(ctx.paths.app,process.execPath,python),{mode:0o755});fs.chmodSync(file,0o755);}}
  return remove?'Ask AI Linux launchers removed':'Ask AI installed in the Linux application menu and existing Desktop folder';
}
function linuxDependencies(ctx){
  let python=ctx.which('python3');
  const ready=()=>!!python && ctx.probe(python,['-c','import tkinter']).ok && !!ctx.which('tesseract');
  if(ready())return python;
  const managers=[['apt-get',['install','-y','python3','python3-tk','tesseract-ocr']],['dnf',['install','-y','python3','python3-tkinter','tesseract']],['pacman',['-S','--needed','--noconfirm','python','tk','tesseract','tesseract-data-eng']],['zypper',['--non-interactive','install','python3','python3-tk','tesseract-ocr']]];
  const manager=managers.find(([name])=>ctx.which(name));
  const root=typeof process.getuid==='function'&&process.getuid()===0;
  const sudo=!root && ctx.which('sudo') && ctx.probe('sudo',['-n','true']).ok;
  if(!manager || (!root&&!sudo))throw Error('Desktop prerequisites missing. Install Python 3, Tkinter and Tesseract with your OS package manager (Debian/Ubuntu: sudo apt-get install python3 python3-tk tesseract-ocr), then rerun askai desktop install --yes. No password prompt is opened automatically.');
  const [name,args]=manager,r=ctx.act('Linux desktop prerequisites',root?name:'sudo',root?args:['-n',name,...args],{timeout:900000});
  if(!r.ok)throw Error('Linux desktop prerequisite installation failed; check package-manager/network access.');
  python=ctx.which('python3');if(!ready())throw Error('Python/Tkinter/Tesseract still unavailable after installation.');return python;
}
function build(root=ROOT){
  try { return compile(root); }
  catch(error){
    const denied=/EACCES|EPERM|access (?:is )?denied|permission denied/i.test(error.code+' '+error.message);
    if(denied)throw Error('Ask AI desktop build permission denied in '+path.join(root,'desktop-bin')+'. Run askai desktop install --yes in a terminal permitted to write to this installation, then retry askai gui. Codex sandbox permissions and Windows application-control policy still apply; AskAI does not change them. Details: '+error.message);
    throw error;
  }
}
function compile(root){
  if(process.platform!=='win32')throw Error('Native desktop build requires Windows.');
  const windows=process.env.SystemRoot || 'C:\\Windows';
  const framework=['Framework64','Framework'].map(n=>path.join(windows,'Microsoft.NET',n,'v4.0.30319')).find(d=>fs.existsSync(path.join(d,'csc.exe')));
  if(!framework)throw Error('Windows .NET Framework compiler is unavailable.');
  const source=path.join(root,'standalone','desktop.cs');
  const hash=require('crypto').createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0,16);
  const folder=path.join(root,'desktop-bin'),exe=path.join(folder,`AskAI-${hash}.exe`);
  const valid=file=>fs.existsSync(file)&&fs.statSync(file).size>1024&&fs.readFileSync(file).subarray(0,2).toString()==='MZ';
  if(valid(exe))return exe;
  fs.mkdirSync(folder,{recursive:true});
  const references=['System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll',path.join(framework,'System.Runtime.WindowsRuntime.dll')];
  for(const name of ['System.Runtime.dll','System.Threading.Tasks.dll','System.Runtime.InteropServices.WindowsRuntime.dll']){
    const file=[path.join(framework,'Facades',name),path.join(framework,name)].find(f=>fs.existsSync(f));if(file)references.push(file);
  }
  const candidate=path.join(folder,`AskAI-build-${require('crypto').randomUUID()}.exe`);
  const icon=path.join(root,'standalone','askai.ico');
  const args=['/nologo','/target:winexe','/optimize+','/out:'+candidate,...(fs.existsSync(icon)?['/win32icon:'+icon]:[]),...references.map(r=>'/reference:'+r),source];
  let result;
  // Retry transient resource failures, but report permission failures immediately.
  // Access denied can come from sandbox permissions, ACLs or application-control policy.
  for(let attempt=1;attempt<=3;attempt++){
    if(fs.existsSync(candidate))fs.unlinkSync(candidate);
    result=cp.spawnSync(path.join(framework,'csc.exe'),args,{encoding:'utf8',timeout:60000,windowsHide:true});
    if(result.status===0 && valid(candidate))break;
    if(attempt<3 && /Error generating Win32 resource/i.test(result.stdout || '') && !/access (?:is )?denied|permission denied/i.test((result.stdout || '')+(result.stderr || ''))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400*attempt);
    else break;
  }
  if(result.status!==0 || !valid(candidate)){if(fs.existsSync(candidate))fs.unlinkSync(candidate);throw Error('Native desktop compilation failed: '+(result.stdout || result.stderr || result.error));}
  if(valid(exe))fs.unlinkSync(candidate);else fs.renameSync(candidate,exe);
  // Every source change compiles a new hash-named exe; drop earlier builds so the one on disk is always the
  // latest source, and askai update/install don't leave every past compile behind.
  const keep=path.basename(exe);
  for(const name of fs.readdirSync(folder)){
    if(name===keep)continue;
    if(/^AskAI-(build-)?[0-9a-f-]+\.exe$/.test(name)){try{fs.unlinkSync(path.join(folder,name));}catch(_){/* in use; next build retries */}}
  }
  return exe;
}
function catalog(){
  const help=require('./help');
  const types=require('../askai').optionTypes;
  return help.names().sort().map(name=>({name,category:help.groupOf(name).group,summary:help.H[name].summary,usage:help.H[name].usage,variants:require('./desktop-schema').schema(name,types)}));
}
// askai install --convert-only records this so the desktop app can open straight to Convert To Markdown and grey out
// Commands/Help -- without it, a GUI meant only for document conversion still shows every askai command.
function mode(ctx){
  return {convertOnly:!!(ctx && ctx.manifest && ctx.manifest.convertOnly)};
}
const SHORTCUT='Ask AI managed desktop launcher';
function blockedStart(error){
  const text=`${error&&error.code||''} ${error&&error.message||''} ${error&&error.stderr||''} ${error&&error.error||''}`;
  return /UNKNOWN|EPERM|Application Control policy has blocked/i.test(text);
}
function windowsPython(){
  if(windowsPython.cached!==undefined)return windowsPython.cached;
  const found=[];
  const listed=cp.spawnSync('py',['-0p'],{encoding:'utf8',windowsHide:true,timeout:8000});
  if(listed.status===0)for(const line of String(listed.stdout||'').split(/\r?\n/)){const match=/([A-Za-z]:\\.*python\.exe)\s*$/i.exec(line.trim());if(match && !/WindowsApps/i.test(match[1]))found.push(match[1]);}
  const local=path.join(process.env.LOCALAPPDATA||'','Programs','Python');
  if(fs.existsSync(local))for(const name of fs.readdirSync(local)){const exe=path.join(local,name,'python.exe');if(fs.existsSync(exe))found.push(exe);}
  for(const name of ['python','python3']){const exe=require('./sys').which(name);if(exe && !/WindowsApps/i.test(exe))found.push(exe);}
  const seen=new Set();
  for(const exe of found){const key=path.resolve(exe).toLowerCase();if(seen.has(key))continue;seen.add(key);const probe=cp.spawnSync(exe,['-c','import tkinter'],{windowsHide:true,timeout:20000});if(probe.status===0)return windowsPython.cached=exe;}
  return windowsPython.cached=null;
}
function windowsScriptShortcuts(ctx,python,remove=false){
  const home=require('os').homedir();
  const programs=path.join(process.env.APPDATA||path.join(home,'AppData','Roaming'),'Microsoft','Windows','Start Menu','Programs');
  const folders=ctx.shortcutFolders || [path.join(home,'Desktop'),programs].filter(dir=>fs.existsSync(dir));
  const pythonw=path.join(path.dirname(python),'pythonw.exe');
  const host=fs.existsSync(pythonw)?pythonw:python;
  const quote=value=>{if(/[\r\n"]/.test(value))throw Error('Invalid desktop launcher path.');return `"${value}"`;};
  const payload={remove,folders,host,description:SHORTCUT,work:home,arguments:[path.join(ctx.paths.app,'standalone','desktop.py'),'--app-root',ctx.paths.app,'--node',process.execPath].map(quote).join(' ')};
  const file=path.join(require('os').tmpdir(),`askai-shortcut-${process.pid}-${Date.now()}.json`);
  const script=path.join(require('os').tmpdir(),`askai-shortcut-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(file,JSON.stringify(payload));
  fs.writeFileSync(script,`$payload = Get-Content -LiteralPath $args[0] -Raw -Encoding UTF8 | ConvertFrom-Json\n$shell = New-Object -ComObject WScript.Shell\nforeach($folder in $payload.folders){\n  $file = Join-Path $folder 'Ask AI.lnk'\n  if($payload.remove -and -not (Test-Path -LiteralPath $file)){ continue }\n  $link = $shell.CreateShortcut($file)\n  if((Test-Path -LiteralPath $file) -and $link.Description -ne $payload.description){ throw "Preserved unrelated shortcut: $file" }\n  if($payload.remove){ Remove-Item -LiteralPath $file; continue }\n  if(-not (Test-Path -LiteralPath $folder)){ New-Item -ItemType Directory -Path $folder | Out-Null }\n  $link.TargetPath = $payload.host\n  $link.Arguments = $payload.arguments\n  $link.WorkingDirectory = $payload.work\n  $link.Description = $payload.description\n  $link.Save()\n}\n`);
  const r=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script,file],{encoding:'utf8',windowsHide:true,timeout:30000});
  fs.rmSync(file,{force:true});fs.rmSync(script,{force:true});
  if(r.status!==0)throw Error(`Desktop Shortcut Setup Failed: ${(r.stderr||r.stdout||'shortcut setup failed').trim()}. Ask AI does not change application-control policy.`);
  return remove?'Ask AI shortcuts removed':'Ask AI Desktop and Start Menu shortcuts installed';
}
function install(ctx,remove=false){
  if(ctx.sandbox)return 'skipped (custom configuration home)';
  const available=environment({env:ctx.env || process.env});
  if(ctx.dry)return `${remove?'remove':'install'} Ask AI desktop shortcuts (when supported)`;
  if(process.platform==='linux' && remove)return linuxShortcuts(ctx,'python3',true);
  if(!available.supported)return `not needed (${available.reason})`;
  if(available.kind==='linux')return linuxShortcuts(ctx,linuxDependencies(ctx));
  let exe;
  if(remove){const folder=path.join(ctx.paths.app,'desktop-bin');exe=fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>/^AskAI-[a-f0-9]{16}\.exe$/.test(n)).map(n=>path.join(folder,n))[0]:null;}
  else {
    exe=(ctx.desktopBuild || build)(ctx.paths.app);
    prepareLegacyBuild(ctx,exe);
  }
  if(exe){
    const args=[remove?'--remove-shortcuts':'--install-shortcuts',ctx.paths.app,process.execPath];
    const r=ctx.act('Ask AI desktop shortcuts',exe,args,{timeout:30000});
    if(r.ok)return remove?'Ask AI shortcuts removed':'Ask AI Desktop and Start Menu shortcuts installed';
    if(!blockedStart(r))throw Error(`Desktop Shortcut Setup Failed: ${r.stderr || r.error || r.status}. On Windows, check application-control signing requirements; no security policy is changed.`);
  }else if(remove)return 'No managed desktop runtime to remove';
  const python=windowsPython();
  if(!python){if(remove)return 'No managed desktop runtime to remove';throw Error('Desktop Shortcut Setup Failed: the compiled window is blocked and no Python with Tk is allowed to run. Ask AI does not change that policy.');}
  return windowsScriptShortcuts(ctx,python,remove);
}
// Installation has already refreshed the legacy app. Share only an identical-source build.
function prepareLegacyBuild(ctx,exe){
  if(!ctx.paths.home)return;
  const legacy=path.join(ctx.paths.home,'askai','app');
  if(path.resolve(legacy)===path.resolve(ctx.paths.app))return;
  const pkg=path.join(legacy,'package.json');
  try{if(JSON.parse(fs.readFileSync(pkg,'utf8')).name!=='askai')return;}catch{return;}
  const source=path.join(ctx.paths.app,'standalone','desktop.cs'),other=path.join(legacy,'standalone','desktop.cs');
  if(!fs.existsSync(other) || !fs.readFileSync(source).equals(fs.readFileSync(other)))return;
  const folder=path.join(legacy,'desktop-bin');
  fs.mkdirSync(folder,{recursive:true});
  const target=path.join(folder,path.basename(exe));
  if(fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(exe)))return;
  fs.copyFileSync(exe,target);
}
function pythonWindow(dir,python){
  const ready=path.join(require('os').tmpdir(),`askai-desktop-ready-${require('crypto').randomUUID()}.json`);
  const args=[path.join(ROOT,'standalone','desktop.py'),'--app-root',ROOT,'--node',process.execPath,'--project',path.resolve(dir),'--ready',ready];
  return waitForWindow(cp.spawn(python,args,{detached:true,stdio:'ignore'}),ready);
}
async function launch(dir){
  const available=environment();if(!available.supported)throw Error(`Ask AI desktop skipped: ${available.reason}; use askai cli.`);
  if(available.kind!=='windows'){const python=require('./sys').which('python3');if(!python)throw Error('Python 3 missing; run askai desktop install --yes.');return pythonWindow(dir,python);}
  const ready=path.join(require('os').tmpdir(),`askai-desktop-ready-${require('crypto').randomUUID()}.json`);
  let child;
  try{child=cp.spawn(build(),[ROOT,process.execPath,path.resolve(dir),ready],{detached:true,stdio:'ignore'});}
  catch(error){if(!blockedStart(error))throw error;child=null;}
  if(child){try{return await waitForWindow(child,ready);}catch(error){if(!blockedStart(error))throw error;}}
  const python=windowsPython();
  if(!python)throw Error('Ask AI desktop skipped: Application Control blocked the compiled window, and no Python with Tk is allowed to run. Ask AI does not change that policy; use askai cli.');
  return pythonWindow(dir,python);
}
function waitForWindow(child,ready,{timeout=15000,settle=750,interval=100}={}){
  return new Promise((resolve,reject)=>{
    const started=Date.now();let readyAt=null,finished=false;
    const guidance=process.platform==='win32'?'Check application-control policy and .NET availability.':'Check the graphical session and Python/Tkinter availability.';
    const onError=error=>finish(Error('Ask AI desktop process could not start: '+error.message+' '+guidance));
    const readReady=()=>{try{return JSON.parse(fs.readFileSync(ready,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
    const startupError=result=>Error('Ask AI desktop startup failed: '+(result.error || 'Unknown error'));
    const onExit=(code,signal)=>{
      const result=readReady();
      if(result && !result.ok){finish(startupError(result));return;}
      finish(Error('Ask AI desktop exited '+(readyAt===null && !result?.ok?'before reporting ready':'during startup after reporting ready')+' (exit '+code+(signal?', signal '+signal:'')+'). '+guidance));
    };
    const finish=error=>{
      if(finished)return;finished=true;clearInterval(timer);
      child.removeListener('error',onError);child.removeListener('exit',onExit);
      try{fs.unlinkSync(ready);}catch{}
      if(error){if(child.exitCode==null && child.signalCode==null)child.kill();reject(error);}else{child.unref();resolve();}
    };
    const timer=setInterval(()=>{
      if(readyAt===null && fs.existsSync(ready)){
        const result=readReady();
        if(result){if(!result.ok){finish(startupError(result));return;}readyAt=Date.now();}
      }
      if(readyAt!==null && Date.now()-readyAt>=settle)finish();
      else if(Date.now()-started>timeout)finish(Error('Ask AI window did not finish startup within '+timeout+' ms. '+guidance));
    },interval);
    child.once('error',onError);child.once('exit',onExit);
  });
}
function outputPath(source,folder){
  let name;
  if(/^https?:\/\//i.test(source)){
    const url=new URL(source);
    name=['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname)?'youtube-'+(url.hostname==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v') || url.pathname.split('/').pop() || 'transcript'):url.hostname+url.pathname;
  }else name=path.basename(source,path.extname(source));
  name=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'converted';
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))name='_'+name;
  const dest=path.resolve(folder);
  if(!fs.statSync(dest).isDirectory())throw Error('Choose an existing output folder.');
  for(let i=0;i<10000;i++){const f=path.join(dest,`${name}${i?`-${i}`:''}.md`);if(!fs.existsSync(f))return f;}
  throw Error('Too many existing output names; choose another folder.');
}
function execute(argv,cwd,options={}){
  return new Promise((resolve,reject)=>{
    const child=cp.spawn(options.exe || process.execPath,argv,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32',env:{...process.env,ASKAI_FRONTEND:'gui'}});
    let stdout='',stderr='',size=0,failure='';
    const stop=()=>{if(!child.pid)return;if(process.platform==='win32')cp.spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});else try{process.kill(-child.pid,'SIGKILL');}catch{}};
    const canceled=()=>{stop();setTimeout(()=>process.exit(130),200).unref();};
    if(process.platform!=='win32')process.once('SIGTERM',canceled);
    const timer=setTimeout(()=>{failure='Time limit reached; child process stopped.';stop();},options.timeout || 900000);
    const collect=(stream,text)=>{size+=text.length;if(size>2*1024*1024){if(!failure){failure='Output exceeds 2 MiB; use askai run or a terminal for the full log.';stop();}return;}if(stream==='out')stdout+=text;else stderr+=text;};
    child.stdout.on('data',b=>collect('out',b.toString()));child.stderr.on('data',b=>collect('err',b.toString()));
    child.once('error',e=>{clearTimeout(timer);process.removeListener('SIGTERM',canceled);reject(e);});
    child.once('close',code=>{clearTimeout(timer);process.removeListener('SIGTERM',canceled);resolve({code:failure?1:code ?? 1,stdout,stderr:[stderr,failure].filter(Boolean).join('\n')});});
  });
}
async function request(data){
  if(!data || typeof data.project!=='string' || !fs.statSync(data.project).isDirectory())throw Error('Choose an existing project folder.');
  const cwd=path.resolve(data.project);
  if(data.kind==='command'){
    if(!catalog().some(c=>c.name===data.command))throw Error('Choose a known AskAI command.');
    if(['cli','desktop'].includes(data.command))throw Error('Use Open terminal or the desktop shortcut instead.');
    const args=data.variant!==undefined?require('./desktop-schema').buildArgs(data.command,data,require('../askai').optionTypes):require('../askai').cliArgs(String(data.args || ''));
    const separator=args.indexOf('--');if(separator<0)args.push('--repo',cwd);else args.splice(separator,0,'--repo',cwd);
    return formatResult(await execute([path.join(ROOT,'askai.js'),data.command,...args],cwd));
  }
  if(data.kind!=='convert' || typeof data.source!=='string')throw Error('Unknown desktop request.');
  const isUrl=/^https?:\/\//i.test(data.source);
  const src=isUrl?data.source:path.resolve(data.source);
  if(!isUrl){
    const stat=fs.statSync(src);
    if(stat.isDirectory())return formatResult(await convertFolder(src,path.resolve(data.folder || cwd),cwd));
    if(!stat.isFile())throw Error('Select a file to convert.');
    if(/\.md$/i.test(src))return{code:0,stdout:'',stderr:'',output:null,display:`${path.basename(src)} is already Markdown.`};
  }
  const folder=data.folder || (isUrl?cwd:path.dirname(src));
  return formatResult(await convertOne(src,folder,cwd));
}
async function convertOne(src,folder,cwd){
  const out=outputPath(src,folder);
  let result;
  if(/\.(png|jpe?g|bmp|tiff?)$/i.test(src)){
    if(process.platform==='win32'){
      result=await execute(['--ocr',src,out],cwd,{exe:build(),timeout:180000});
      if(result.code===0 && !fs.existsSync(out))throw Error('OCR returned without creating Markdown.');
    }else if(process.platform==='linux'){
      const exe=require('./sys').which('tesseract');if(!exe)throw Error('Tesseract missing; run askai desktop install --yes on Linux desktop.');
      result=await execute([src,'stdout'],cwd,{exe,timeout:180000});
      if(result.code===0){if(!result.stdout.trim())throw Error('No text recognized in the image.');fs.writeFileSync(out,`# ${path.basename(src)}\n\n${result.stdout.trim()}\n`,{flag:'wx',encoding:'utf8'});}
    }else throw Error('Local image OCR supports Windows and Linux.');
    if(result.code===0)result.stdout=`Wrote ${out}\nLocal OCR; review recognized text for errors.`;
  }else result=await execute([path.join(ROOT,'askai.js'),'convert',src,'--out',out,'--repo',cwd],cwd,{timeout:180000});
  return {...result,output:result.code===0?out:null};
}
async function convertFolder(src,dest,cwd){
  if(!fs.statSync(dest).isDirectory())throw Error('Choose an existing output folder.');
  const exts=/\.(pdf|docx?|pptx?|xlsx?|htm|html|txt|png|jpe?g|bmp|tiff?)$/i;
  const files=fs.readdirSync(src,{withFileTypes:true}).filter(e=>e.isFile() && exts.test(e.name)).map(e=>path.join(src,e.name)).sort();
  if(!files.length)throw Error('No convertible files in that folder (supported: PDF, Word, PowerPoint, Excel, HTML, text, images).');
  const lastLine=text=>(String(text||'').trim().split(/\r?\n/).filter(Boolean).pop())||'conversion failed';
  const okLines=[],failLines=[];let ok=0;
  for(const file of files){
    const name=path.basename(file);
    try{
      const r=await convertOne(file,dest,cwd);
      if(r.code===0){ok++;okLines.push(`OK   ${name} -> ${path.relative(dest,r.output)}`);}
      else failLines.push(`FAIL ${name}: ${lastLine(r.stderr || r.stdout).split(file).join(name)}`);
    }catch(e){failLines.push(`FAIL ${name}: ${e.message.split(file).join(name)}`);}
  }
  return {code:ok?0:1,stdout:`Converted ${ok} of ${files.length} file(s) into ${dest}\n\n${[...okLines,...failLines].join('\n')}`,stderr:''};
}
function titleHeadings(text){
  const title=value=>value.split(/(`[^`]*`)/g).map(part=>part.startsWith('`')?part:part.replace(/(?<!')\b[a-z]/g,c=>c.toUpperCase())).join('');
  const lines=text.split('\n');return lines.map((line,index)=>{
    const markdown=/^(#{1,6}\s+)(.+)$/.exec(line);if(markdown)return markdown[1]+title(markdown[2]);
    if(/^\[[A-Za-z][A-Za-z /-]*\]$/.test(line))return title(line);
    if(line.includes('|') && /^[\s|:+-]+$/.test(lines[index+1]||''))return title(line);
    if(/^(summary|usage|options|examples|details|exit|next steps):?$/i.test(line.trim()))return title(line);
    return line;
  }).join('\n');
}
function formatResult(result){
  const clean=value=>String(value||'').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/\r\n|\r/g,'\n');
  let body=clean(result.stdout).trim();try{body=JSON.stringify(JSON.parse(body),null,2);}catch{body=titleHeadings(body);}
  const sections=[`Exit Code: ${result.code}`];if(body)sections.push(body);
  const errors=clean(result.stderr).trim();if(errors)sections.push('Diagnostics\n'+errors);
  if(result.output){const size=fs.statSync(result.output).size;if(size<=2*1024*1024)sections.push('Markdown Preview\n'+clean(fs.readFileSync(result.output,'utf8')));else sections.push('Markdown Preview Exceeds 2 MiB. Open The Saved Markdown File To Read It.');}
  return {...result,display:sections.join('\n\n')};
}
module.exports={waitForWindow,catalog,mode,install,launch,outputPath,execute,request,build,environment,linuxEntry,linuxShortcuts,linuxDependencies,formatResult,titleHeadings,blockedStart,windowsPython,windowsScriptShortcuts};
