'use strict';
// Project choice for /askai-cli. Named path wins. Otherwise the chat's folder, then the only
// registered project. A question is returned only when several projects remain and the folder is not one of them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const registry = require('./project-registry');

const MANIFESTS = require('./project-source').MANIFESTS;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function rootOf(start) {
  let current = path.resolve(start);
  const home = os.homedir();
  let found = null;
  for (;;) {
    if (same(current, home)) break;
    if (fs.existsSync(path.join(current, '.git'))) return current;
    if (!found && MANIFESTS.some(n => fs.existsSync(path.join(current, n)))) found = current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

function namedMatch(data, dir) {
  const hit = Object.entries(data.projects).find(([, p]) => same(p, dir));
  return hit ? hit[0] : null;
}

function select(o, cwd = process.cwd()) {
  const home = registry.folder(o);
  const data = registry.read(home);
  const explicit = o.project || o.path || o.repo;
  if (explicit) {
    const found = registry.resolve(home, explicit, cwd, null);
    return { project: found.name || namedMatch(data, found.path), path: found.path, how: 'named' };
  }
  const root = rootOf(cwd);
  if (root) {
    let canonical = root;
    try { canonical = registry.canonical(root); } catch (_) { /* keep the resolved path */ }
    return { project: namedMatch(data, canonical), path: canonical, how: 'working-directory' };
  }
  if (process.env.ASKAI_PROJECT) {
    const active = registry.select(home, process.env.ASKAI_PROJECT);
    return { project: active.name, path: active.path, how: 'active' };
  }
  const names = Object.keys(data.projects);
  if (names.length === 1) {
    const one = registry.select(home, names[0]);
    return { project: one.name, path: one.path, how: 'only-registered' };
  }
  if (data.default) {
    const chosen = registry.select(home, data.default);
    return { project: chosen.name, path: chosen.path, how: 'default' };
  }
  return {
    need: 'project',
    question: names.length
      ? 'Which project should AskAI set up? Reply with a registered name or a folder path.'
      : 'Which project folder should AskAI set up? Reply with its path.',
    candidates: names.map(name => ({ name, path: data.projects[name] })),
  };
}

// Facts static detection could not fill. The host agent answers these from code when it can, and asks the user only for the rest.
function questions(info) {
  const out = [];
  if (!info.about || /\(one or two sentences/.test(info.about)) out.push({ id: 'about', ask: 'What is this project about, in one or two sentences?' });
  if (!info.type || info.type === 'other') out.push({ id: 'type', ask: 'What kind of project is this (website, android, ios, embedded, backend, library, docs, other)?' });
  if (!info.commands || !info.commands.test) out.push({ id: 'test', ask: 'What command runs one test or the tests?' });
  if (!info.commands || !info.commands.build) out.push({ id: 'build', ask: 'What command builds the project?' });
  return out;
}

module.exports = { select, questions, rootOf };
