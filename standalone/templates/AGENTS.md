# AGENTS.md (shared by Claude Code, Codex, Antigravity and Cursor; keep under 60 lines)

## Stack
- (language, framework, package manager)

## Commands (pipe long output through tail -n 40)
- Install: 
- Test one file: 
- Lint / typecheck: 
- Build: 

## Where things live (read only when the task needs it)
- 

## Do not read
- node_modules/, build output, lockfiles, generated files, .env*

## Working rules
- Smallest change that solves the task; run the narrowest test; read only failing lines.
- Before a break: write .ai-work/HANDOFF.md (the /handoff command).
