#!/usr/bin/env bash
# askai for macOS, Linux and WSL. Makes sure Node.js is present (askai needs 18+, Context Mode 22.5+), then runs askai.js with the
# same arguments. With no arguments it runs `askai install` (asks once before changing anything).
#
#   bash install.sh --dry-run                         # the plan, changes nothing
#   bash install.sh                                   # coding profile, every host found on this machine
#   bash install.sh --profile docs --target claude,codex
#   bash install.sh suggest ~/code/myapp              # any askai command works: status, doctor, tips, session ...
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARGS=("$@"); if [ ${#ARGS[@]} -eq 0 ] || [[ "${ARGS[0]}" == -* ]]; then ARGS=(install "${ARGS[@]}"); fi  # no command, or options first: install
SHELL_INTEGRATION=0
FILTERED=(); for a in "${ARGS[@]}"; do if [ "$a" = --shell-integration ]; then SHELL_INTEGRATION=1; else FILTERED+=("$a"); fi; done
ARGS=("${FILTERED[@]}")
has() { for a in "${ARGS[@]}"; do [ "$a" = "$1" ] && return 0; done; return 1; }
YES=0; { has --yes || has -y; } && YES=1
DRY=0; has --dry-run && DRY=1
ask() { [ "$YES" -eq 1 ] && return 0; local a; read -r -p "$1 [y/N] " a || true; [[ "$a" =~ ^[Yy] ]]; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. askai needs 18+ (Context Mode needs 22.5+)."
  if [ "$DRY" -eq 1 ]; then echo "[dry-run] would install Node.js (brew install node), then run askai.js"; exit 0; fi
  if command -v brew >/dev/null 2>&1 && ask "Install Node.js with Homebrew now?"; then brew install node
  else echo "Install Node.js 24 LTS from https://nodejs.org or with nvm (https://github.com/nvm-sh/nvm), then re-run."; exit 1; fi
fi
VER="$(node -p 'process.versions.node')"; MAJOR="${VER%%.*}"; REST="${VER#*.}"; MINOR="${REST%%.*}"
if [ "$MAJOR" -lt 18 ]; then echo "Node.js $VER is too old for askai (needs 18+)."; exit 1; fi
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 5 ]; }; then
  echo "Node.js $VER found; Context Mode needs 22.5+ (the context-mode component will say so). Upgrade with brew or nvm when you can."
fi

set +e
node "$HERE/askai.js" "${ARGS[@]}"
CODE=$?
set -e

# askai puts its shim in ~/.claude/askai/bin. On Windows it edits the user PATH itself; here we offer the shell-profile line once.
BIN="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/askai/bin"
if [ "$CODE" -eq 0 ] && [ "${ARGS[0]}" = "install" ] && [ "$DRY" -eq 0 ] && ! has --no-path && ! has --claude-home && [ -x "$BIN/askai" ]; then
  case ":$PATH:" in *":$BIN:"*) ;; *)
    RC="$HOME/.bashrc"; [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = "zsh" ] && RC="$HOME/.zshrc"
    if ! grep -qF "$BIN" "$RC" 2>/dev/null && ask "Add $BIN to PATH in $RC so the \`askai\` command works?"; then
      printf '\n# askai\nexport PATH="%s:$PATH"\n' "$BIN" >> "$RC"
      echo "Added. Open a new terminal (or: source $RC)."
    fi;;
  esac
fi
if [ "$CODE" -eq 0 ] && [ "${ARGS[0]}" = install ] && [ "$SHELL_INTEGRATION" -eq 1 ] && [ "$DRY" -eq 0 ] && ! has --claude-home; then
  RC="$HOME/.bashrc"; SH_NAME=bash
  if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = zsh ]; then RC="$HOME/.zshrc"; SH_NAME=zsh; fi
  APP="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/askai/app/askai.js"
  node "$APP" shell install "$SH_NAME" --path "$RC"
  echo "Open a new terminal to use askai set project NAME."
fi
exit "$CODE"
