#!/usr/bin/env bash
# Install AskAI straight from GitHub, then run install.sh with your options (macOS, Linux, WSL).
#   curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --project ~/code/myapp --yes
# The source stays in ~/.askai/src (a git checkout when git is installed, else GitHub's archive), so `askai update` can
# refresh it. It always installs the latest AskAI (the repository's default branch, main). Environment: ASKAI_REPO (owner/name)
# and ASKAI_REPO_URL (a full git URL or path) point at a fork or a test copy; ASKAI_DIR is where the source goes.
set -euo pipefail
REPO="${ASKAI_REPO:-aalokshah-business/AskAi}"
URL="${ASKAI_REPO_URL:-https://github.com/$REPO.git}"
DIR="${ASKAI_DIR:-$HOME/.askai/src}"
replace_source() {
  case "$DIR" in /|"$HOME"|"$HOME/.askai"|"$HOME/.claude"|"$HOME/.claude/askai") echo "Refusing to replace unsafe source folder: $DIR" >&2; exit 1;; esac
  if [ -e "$DIR" ]; then
    [ -f "$DIR/askai.js" ] && [ -f "$DIR/install.sh" ] && [ -f "$DIR/package.json" ] && grep -Eq '"name"[[:space:]]*:[[:space:]]*"askai"' "$DIR/package.json" || {
      echo "Source folder already exists and is not an AskAI checkout: $DIR. Choose another ASKAI_DIR." >&2; exit 1;
    }
    rm -rf "$DIR"
  fi
}
mkdir -p "$(dirname "$DIR")"
if command -v git >/dev/null 2>&1; then
  if [ -d "$DIR/.git" ]; then
    [ -f "$DIR/askai.js" ] && [ -f "$DIR/install.sh" ] && grep -Eq '"name"[[:space:]]*:[[:space:]]*"askai"' "$DIR/package.json" || { echo "Not an AskAI checkout: $DIR" >&2; exit 1; }
    echo "==> updating $DIR to the latest AskAI"; git -C "$DIR" fetch --quiet --depth 1 origin HEAD; git -C "$DIR" checkout --quiet FETCH_HEAD
  else
    echo "==> fetching the latest AskAI into $DIR"; replace_source; git clone --quiet --depth 1 "$URL" "$DIR"
  fi
else
  command -v curl >/dev/null 2>&1 || { echo "AskAI needs git or curl to download itself" >&2; exit 1; }
  echo "==> downloading the latest AskAI into $DIR (no git: GitHub archive of main)"
  tmp="$(mktemp -d)"; curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$tmp"
  archive_dirs=( "$tmp"/*/ ); archive_dir="${archive_dirs[0]}"
  [ -f "$archive_dir/askai.js" ] && [ -f "$archive_dir/install.sh" ] && grep -Eq '"name"[[:space:]]*:[[:space:]]*"askai"' "$archive_dir/package.json" || { echo 'Downloaded archive does not contain AskAI.' >&2; exit 1; }
  replace_source; mv "$archive_dir" "$DIR"; rm -rf "$tmp"
fi
# Prompts read from the terminal even when this script arrives through a pipe; without a terminal (an agent) pass --yes.
if ( : </dev/tty ) 2>/dev/null; then exec bash "$DIR/install.sh" "$@" </dev/tty; else exec bash "$DIR/install.sh" "$@"; fi
