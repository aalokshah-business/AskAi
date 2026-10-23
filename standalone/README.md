# Standalone settings script (no AskAI needed)

`token-setup.mjs` applies AskAI's evidence-based settings on a machine where you want only the configuration: no CLI on PATH, no ledger, no checks. One file, Node 18+, no dependencies. Previews by default; `--apply` writes; `--uninstall` removes only what it added.

```bash
bash standalone/setup.sh                       # preview (macOS, Linux, WSL)
bash standalone/setup.sh --apply               # apply for Claude Code plus every other tool found
bash standalone/setup.sh --apply --project ~/code/myapp
bash standalone/setup.sh --uninstall
```

```powershell
powershell -ExecutionPolicy Bypass -File .\standalone\setup.ps1 --apply   # Windows
```

Options: `--tools claude,codex,agy,cursor`, `--install-clis`, `--claude-model ID` (default `claude-haiku-5-5`), `--lsp ts,py`, `--lean-git`, `--home DIR` (testing). `templates/` holds the exact files it writes. Its settings match `askai install` (see docs/ARCHITECTURE.md); the full reasoning is in docs/research/TOKEN_SAVING_GUIDE.md.
