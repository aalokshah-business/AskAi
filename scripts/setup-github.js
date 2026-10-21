#!/usr/bin/env node
'use strict';
// One-time GitHub settings for the AskAI repository, with the GitHub CLI (gh, signed in as the owner):
//   public; main is the default branch; description and topics; Actions on with a read-only token; private vulnerability
//   reporting; a ruleset that blocks force pushes and deleting main and sends every pull request to the code owner (you can
//   still push directly); the release for the current version; and a check that nobody else can push.
//   node scripts/setup-github.js [--repo owner/name] [--dry-run]
const cp = require('child_process'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const repo = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : 'aalokshah-business/AskAi';
const owner = repo.split('/')[0];
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const show = a => `gh ${a.map(x => (/[\s"]/.test(x) ? JSON.stringify(x) : x)).join(' ')}`;
function gh(a, opts = {}) {
  if (dry && !opts.read) { console.log(`  [dry-run] ${show(a)}`); return { ok: true, out: opts.dryOut || '' }; }
  if (dry && opts.read) { console.log(`  [dry-run] ${show(a)}`); return { ok: false, out: '' }; }
  const r = cp.spawnSync('gh', a, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
let failed = 0;
const report = (title, r, hint) => { console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${title}${r.ok ? '' : `\n      ${String(r.out).split('\n')[0]}${hint ? `\n      ${hint}` : ''}`}`); if (!r.ok) failed++; };
function changelogEntry() {
  const t = fs.readFileSync(path.join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8');
  const i = t.indexOf(`## ${version}`); if (i < 0) return `AskAI ${version}`;
  const j = t.indexOf('\n## ', i + 3); return t.slice(i, j < 0 ? undefined : j).trim();
}

console.log(`GitHub settings for ${repo}${dry ? ' (dry run: nothing is changed)' : ''}\n`);
if (!dry) {
  const auth = gh(['auth', 'status']);
  if (!auth.ok) { console.log('The GitHub CLI is not installed or not signed in: install it from https://cli.github.com, run gh auth login, then run this again.'); process.exit(1); }
}
const edit = ['repo', 'edit', repo, '--visibility', 'public', '--accept-visibility-change-consequences', '--default-branch', 'main',
  '--description', 'Make Claude Code, Codex, Antigravity and Cursor subscriptions last longer: one command installs evidence-based token-saving settings, plugins and project files for all four.',
  '--homepage', `https://github.com/${repo}#readme`, '--enable-issues', '--enable-wiki=false', '--enable-projects=false', '--delete-branch-on-merge',
  ...['claude-code', 'codex', 'cursor', 'antigravity', 'ai-coding', 'tokens', 'developer-tools'].flatMap(t => ['--add-topic', t])];
let r = gh(edit);
if (!r.ok && /unknown flag.*accept-visibility/i.test(r.out)) r = gh(edit.filter(x => x !== '--accept-visibility-change-consequences'));
report('public, main as the default branch, description, topics, issues on, wiki and projects off', r, 'Settings, General: Change visibility; Default branch: main');
report('GitHub Actions on (all actions allowed)', gh(['api', '-X', 'PUT', `repos/${repo}/actions/permissions`, '-F', 'enabled=true', '-f', 'allowed_actions=all']), 'Settings, Actions, General: Allow all actions');
report('workflows get a read-only token and cannot approve pull requests', gh(['api', '-X', 'PUT', `repos/${repo}/actions/permissions/workflow`, '-f', 'default_workflow_permissions=read', '-F', 'can_approve_pull_request_reviews=false']), 'Settings, Actions, General, Workflow permissions: Read repository contents');
report('private vulnerability reporting on', gh(['api', '-X', 'PUT', `repos/${repo}/private-vulnerability-reporting`]), 'Settings, Code security: Private vulnerability reporting, Enable');
const existing = gh(['api', `repos/${repo}/rulesets`], { read: true });
if (existing.ok && /"name"\s*:\s*"protect-main"/.test(existing.out)) console.log('ok    ruleset protect-main already in place');
else report('ruleset protect-main: no force pushes, main cannot be deleted, every pull request goes to the code owner (you can push directly)', gh(['api', '-X', 'POST', `repos/${repo}/rulesets`, '--input', path.join(ROOT, '.github', 'rulesets', 'protect-main.json')]), 'Settings, Rules, Rulesets: New ruleset, Import a ruleset: .github/rulesets/protect-main.json');
const rel = gh(['release', 'view', `v${version}`, '--repo', repo], { read: true });
if (rel.ok) console.log(`ok    release v${version} already exists`);
else report(`release v${version} (tag on main, notes from the changelog)`, gh(['release', 'create', `v${version}`, '--repo', repo, '--target', 'main', '--title', `AskAI ${version}`, '--notes', changelogEntry()]), 'Releases: Draft a new release');
const col = gh(['api', `repos/${repo}/collaborators`, '--jq', '.[].login'], { read: true });
if (col.ok) { const others = col.out.split('\n').map(x => x.trim()).filter(x => x && x.toLowerCase() !== owner.toLowerCase()); console.log(others.length ? `WARN  these accounts can push: ${others.join(', ')}. Remove them in Settings, Collaborators if they should not.` : 'ok    nobody but you can push (no other collaborators)'); }
console.log(`\nIn the browser (no command for these):
  - Settings, Actions, General, "Approval for running fork pull request workflows": Require approval for all external contributors.
  - Optional: Settings, Moderation options, Interaction limits, if you ever need to pause comments and pull requests from strangers.
Check: https://raw.githubusercontent.com/${repo}/main/get.sh should show the script, and the Actions tab should show the test run.`);
process.exit(failed ? 1 : 0);
