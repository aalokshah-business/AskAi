#!/usr/bin/env bash
# macOS, Linux, WSL: runs token-setup.mjs (preview unless --apply). Needs Node.js 18+.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 18+ is required: https://nodejs.org (or brew install node)."; exit 1; fi
exec node "$HERE/token-setup.mjs" "$@"
