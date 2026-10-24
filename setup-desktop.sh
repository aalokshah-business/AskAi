#!/usr/bin/env bash
# Separate Ask AI desktop setup; graphical Linux hosts only, Docker/headless skipped.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/askai.js" desktop install "$@"
