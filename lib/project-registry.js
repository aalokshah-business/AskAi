'use strict';
// User-level project aliases. Project notes and session data remain in each repository.
const fs = require('fs');
const os = require('os');
const path = require('path');

const EMPTY = () => ({ version: 1, projects: {}, default: null });
const folder = o => path.resolve(process.env.ASKAI_HOME || (o && o.claudeHome
  ? path.join(path.dirname(path.resolve(o.claudeHome)), '.askai') : path.join(os.homedir(), '.askai')));
const file = dir => path.join(dir, 'projects.json');
const validName = name => /^[a-z0-9][a-z0-9._-]*$/i.test(String(name || ''));
const keyOf = (projects, name) => Object.keys(projects).find(k => k.toLowerCase() === String(name).toLowerCase());
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const isDir = dir => { try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; } };
const canonical = dir => {
  const full = path.resolve(dir);
  if (!isDir(full)) throw new Error(`project folder does not exist: ${full}`);
  return fs.realpathSync.native ? fs.realpathSync.native(full) : fs.realpathSync(full);
};

function read(dir) {
  const f = file(dir);
  if (!fs.existsSync(f)) return EMPTY();
  let data;
  try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`project registry is unreadable: ${f} (${e.message})`); }
  if (!data || data.version !== 1 || !data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)
    || Object.entries(data.projects).some(([name, p]) => !validName(name) || typeof p !== 'string' || !path.isAbsolute(p))
    || (data.default !== null && data.default !== undefined && !keyOf(data.projects, data.default))) {
    throw new Error(`project registry is invalid: ${f}; repair it or restore a backup`);
  }
  return data;
}

// Lock the read-modify-write cycle, then replace the file atomically. Never overwrite a corrupt registry.
function change(dir, edit) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = file(dir) + '.lock';
  let handle;
  for (let i = 0; i < 40; i++) {
    try { handle = fs.openSync(lock, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmSync(lock); } catch (_) { /* another writer moved it */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  if (handle === undefined) throw new Error(`project registry is busy: ${lock}`);
  try {
    const data = read(dir);
    const result = edit(data);
    const tmp = path.join(dir, `.projects-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(tmp, file(dir)); }
    finally { try { fs.rmSync(tmp); } catch (_) { /* already renamed */ } }
    return result;
  } finally { fs.closeSync(handle); fs.rmSync(lock, { force: true }); }
}

function checkRegistration(data, name, target) {
  if (!validName(name)) throw new Error('project name must use letters, numbers, dots, underscores or hyphens');
  const old = keyOf(data.projects, name);
  if (old && !same(data.projects[old], target)) throw new Error(`project "${name}" already points to ${data.projects[old]}`);
  const duplicate = Object.entries(data.projects).find(([k, p]) => k !== old && same(p, target));
  if (duplicate) throw new Error(`project folder is already registered as "${duplicate[0]}"`);
  return old || name;
}
function canRegister(dir, name, location) {
  return checkRegistration(read(dir), name, canonical(location));
}
function register(dir, name, location) {
  const target = canonical(location);
  return change(dir, data => {
    const key = checkRegistration(data, name, target);
    data.projects[key] = target;
    return { name: key, path: target };
  });
}
function rename(dir, from, to) {
  if (!validName(to)) throw new Error('project name must use letters, numbers, dots, underscores or hyphens');
  return change(dir, data => {
    const old = keyOf(data.projects, from);
    if (!old) throw new Error(`unknown project "${from}"; run askai projects`);
    if (keyOf(data.projects, to) && old.toLowerCase() !== to.toLowerCase()) throw new Error(`project "${to}" already exists`);
    const target = data.projects[old]; delete data.projects[old]; data.projects[to] = target;
    if (data.default && data.default.toLowerCase() === old.toLowerCase()) data.default = to;
    return { name: to, path: target };
  });
}
function move(dir, name, location) {
  const target = canonical(location);
  return change(dir, data => {
    const key = keyOf(data.projects, name);
    if (!key) throw new Error(`unknown project "${name}"; run askai projects`);
    if (Object.entries(data.projects).some(([k, p]) => k !== key && same(p, target))) throw new Error(`project folder is already registered`);
    data.projects[key] = target; return { name: key, path: target };
  });
}
function remove(dir, name) {
  return change(dir, data => {
    const key = keyOf(data.projects, name);
    if (!key) throw new Error(`unknown project "${name}"; run askai projects`);
    const target = data.projects[key]; delete data.projects[key];
    if (data.default === key) data.default = null;
    return { name: key, path: target };
  });
}
function setDefault(dir, name) {
  return change(dir, data => {
    const key = name === null ? null : keyOf(data.projects, name);
    if (name !== null && !key) throw new Error(`unknown project "${name}"; run askai projects`);
    data.default = key; return key;
  });
}
function select(dir, name) {
  const data = read(dir); const key = keyOf(data.projects, name);
  if (!key) throw new Error(`unknown project "${name}"; run askai projects`);
  const target = data.projects[key];
  if (!isDir(target)) throw new Error(`project "${key}" points to a missing folder: ${target}; run askai project path ${key} <new-path>`);
  return { name: key, path: target };
}
function resolve(dir, explicit, cwd = process.cwd(), active = process.env.ASKAI_PROJECT) {
  const data = read(dir);
  if (explicit) {
    const key = keyOf(data.projects, explicit);
    if (key) return select(dir, key);
    if (isDir(explicit)) return { name: null, path: canonical(explicit) };
    if (path.isAbsolute(explicit) || /[\\/]/.test(explicit) || explicit === '.' || explicit === '..') throw new Error(`${path.resolve(explicit)} is not a directory`);
    throw new Error(`unknown project "${explicit}"; run askai projects or askai init <folder>`);
  }
  if (active) return select(dir, active);
  const here = path.resolve(cwd);
  const matches = Object.entries(data.projects).filter(([, p]) => same(here, p) || same(here.slice(0, p.length + 1), p + path.sep));
  if (matches.length) { matches.sort((a, b) => b[1].length - a[1].length); return select(dir, matches[0][0]); }
  for (let current = here; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.ai-work', 'askai-init.json'))) return { name: null, path: current };
    const parent = path.dirname(current); if (parent === current) break;
  }
  if (data.default) return select(dir, data.default);
  return null;
}

module.exports = { folder, file, read, canRegister, register, rename, move, remove, setDefault, select, resolve, canonical };
