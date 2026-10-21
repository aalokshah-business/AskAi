#!/usr/bin/env bash
# Install AskAI straight from GitHub, then run install.sh with your options (macOS, Linux, WSL).
#   curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --project ~/code/myapp --yes
# The source stays in ~/.claude/askai/src (a git checkout when git is installed, else GitHub's archive), so `askai upgrade` can
# refresh it. It always installs the latest AskAI (the repository's default branch, main). Environment: ASKAI_REPO (owner/name)
# and ASKAI_REPO_URL (a full git URL or path) point at a fork or a test copy; ASKAI_DIR is where the source goes.
set -euo pipefail
REPO="${ASKAI_REPO:-aalokshah-business/AskAi}"
URL="${ASKAI_REPO_URL:-https://github.com/$REPO.git}"
DIR="${ASKAI_DIR:-$HOME/.claude/askai/src}"
mkdir -p "$(dirname "$DIR")"
if command -v git >/dev/null 2>&1; then
  if [ -d "$DIR/.git" ]; then
    echo "==> updating $DIR to the latest AskAI"; git -C "$DIR" fetch --quiet --depth 1 origin HEAD; git -C "$DIR" checkout --quiet FETCH_HEAD
  else
    echo "==> fetching the latest AskAI into $DIR"; rm -rf "$DIR"; git clone --quiet --depth 1 "$URL" "$DIR"
  fi
else
  command -v curl >/dev/null 2>&1 || { echo "AskAI needs git or curl to download itself" >&2; exit 1; }
  echo "==> downloading the latest AskAI into $DIR (no git: GitHub archive of main)"
  tmp="$(mktemp -d)"; curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$tmp"
  rm -rf "$DIR"; mv "$tmp"/*/ "$DIR"; rm -rf "$tmp"
fi
# Prompts read from the terminal even when this script arrives through a pipe; without a terminal (an agent) pass --yes.
if ( : </dev/tty ) 2>/dev/null; then exec bash "$DIR/install.sh" "$@" </dev/tty; else exec bash "$DIR/install.sh" "$@"; fi
