'use strict';
// Read build metadata only. Never infer a board, execute a build, or rewrite editor settings.
const fs = require('fs');
const path = require('path');
function discover(dir) {
  const root = fs.realpathSync(dir); const presets = []; const warnings = []; const seen = new Set();
  const read = file => {
    const absolute = fs.realpathSync(file);
    if (absolute !== root && !absolute.startsWith(root+path.sep)) throw new Error('metadata outside project');
    if (fs.statSync(absolute).size > 1024*1024) throw new Error('metadata exceeds 1 MiB');
    return fs.readFileSync(absolute,'utf8');
  };
  const visit = file => {
    if (!fs.existsSync(file) || seen.has(file)) return;
    if (seen.size >= 20) { warnings.push('preset include limit reached'); return; }
    seen.add(file);
    try {
      const data = JSON.parse(read(file));
      for (const entry of (data.configurePresets || []).slice(0,200)) if (entry && typeof entry.name === 'string' && !entry.hidden && entry.condition !== false) {
        presets.push({kind:'cmake',name:entry.name,binaryDir:entry.binaryDir || null,conditional:entry.condition != null,inherits:entry.inherits || null});
      }
      for (const include of (data.include || []).slice(0,20)) {
        if (typeof include !== 'string' || include.includes('$')) { warnings.push('preset include with unresolved macros requires CMake'); continue; }
        visit(path.resolve(path.dirname(file),include));
      }
    } catch (_) { warnings.push(`could not safely read ${path.basename(file)}`); }
  };
  visit(path.join(root,'CMakePresets.json')); visit(path.join(root,'CMakeUserPresets.json'));
  const platformio = path.join(root,'platformio.ini');
  if (fs.existsSync(platformio)) {
    try { for (const match of read(platformio).matchAll(/^\s*\[env:([^\]]+)\]/gm)) presets.push({kind:'platformio',name:match[1].trim()}); }
    catch (_) { warnings.push('could not safely read platformio.ini'); }
  }
  if (fs.existsSync(path.join(root,'mk.sh')) && fs.statSync(path.join(root,'mk.sh')).isFile()) {
    presets.push({kind:'script',name:'./mk.sh',binaryDir:null});
  }
  const databases = ['compile_commands.json','build/compile_commands.json','_out/compile_commands.json'].filter(rel=>fs.existsSync(path.join(root,rel)));
  return {root,presets,databases,zephyr:fs.existsSync(path.join(root,'west.yml')) || fs.existsSync(path.join(root,'prj.conf')) || fs.existsSync(path.join(root,'.west')),warnings,
    note:'Preset conditions, inheritance, toolchains and firmware board compatibility require the real build system. Nothing was built or configured.'};
}
function select(dir, name, options = {}) {
  const result = discover(dir);
  const matches = result.presets.filter(p=>p.name === name);
  if (matches.length !== 1) throw new Error('select one unique discovered preset/environment; run askai project build');
  const preset = matches[0];
  const selection = {...preset,root:result.root,argv:preset.kind === 'cmake' ? ['cmake','--preset',preset.name,'-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'] : preset.kind === 'platformio' ? ['pio','run','-e',preset.name] : [preset.name],
    verified:false,note:'Explicit selection only; review argv and run with your toolchain. CMake compile export requires Ninja/Makefiles.'};
  if (!options.dry) {
    require('./session').ensure(result.root,false);
    const file = path.join(result.root,'.ai-work','build-selection.json');
    fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(selection,null,2)+'\n');
  }
  return selection;
}
module.exports = {discover,select};
