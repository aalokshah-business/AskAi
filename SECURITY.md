# Security

## What the installer changes

AskAI writes only to your user configuration: `~/.claude` (settings, CLAUDE.md block, rules, commands, hooks), `~/.codex` (config.toml keys, AGENTS.md block, skills), `~/.gemini` (settings, GEMINI.md block, skills) and `~/.cursor` (rules, MCP entries), plus the project files of a repository you name. Every file is backed up before its first change (`~/.claude/askai/backups`), settings you already set are never overwritten, and `askai uninstall` removes only what AskAI added. It never uses sudo, never routes your plan through a proxy, sends no telemetry, and makes network requests only to install the tools you chose.

## Check before you run

- Read the bootstrap script first: download [get.sh](get.sh) or [get.ps1](get.ps1), read it, then run it.
- Preview: add `--dry-run` (PowerShell `-DryRun`); nothing is written.
- Verify files: `SHA256SUMS.txt` lists a checksum for every file in the repository.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting (the Security tab of the repository, "Report a vulnerability") rather than a public issue. Never paste API keys, tokens or private code into an issue.
