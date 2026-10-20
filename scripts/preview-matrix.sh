#!/usr/bin/env bash
# Preview every OS x tool combination: `askai install --dry-run` on simulated Linux, macOS and Windows, for Claude Code, Codex,
# Antigravity, Cursor and all four together, then the standalone script for each tool, each in throwaway config folders. Prints a Markdown table; exit 1 if any run fails or writes.
#   bash scripts/preview-matrix.sh            table + the plan lines of each run
#   bash scripts/preview-matrix.sh --quiet    table only
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUIET=0; [ "${1:-}" = "--quiet" ] && QUIET=1
FAKE="$(mktemp -d)"; trap 'rm -rf "$FAKE"' EXIT
# Package managers present on each simulated OS (dummy executables: a dry-run never calls them).
for n in winget.EXE brew curl npm; do printf '#!/bin/sh\nexit 0\n' > "$FAKE/$n"; chmod +x "$FAKE/$n"; done
echo "| OS | target | exit | components planned | failures | files written |"
echo "|:--|:--|--:|--:|--:|--:|"
bad=0
for plat in linux darwin win32; do
  for target in claude codex agy cursor all; do
    H="$(mktemp -d)"
    out="$(ASKAI_FAKE_PLATFORM=$plat PATH="$FAKE:$PATH" node -r "$ROOT/scripts/fake-platform.cjs" "$ROOT/askai.js" install --dry-run --yes --profile coding \
      --target "$target" --claude-home "$H/claude" --cursor-home "$H/cursor" --codex-home "$H/codex" --agy-home "$H/gemini" 2>&1)"; code=$?
    planned=$(printf '%s\n' "$out" | grep -cE '^  [a-z-]+ +(missing|partial|ok|other) ')
    failed=$(printf '%s\n' "$out" | grep -cE ' failed( |$)')
    wrote=$(find "$H" -type f ! -name '.claude.json' ! -path '*/backups/*' | wc -l | tr -d ' ')
    echo "| $plat | $target | $code | $planned | $failed | $wrote |"
    [ "$code" = 0 ] && [ "$failed" = 0 ] && [ "$wrote" = 0 ] || bad=1
    if [ $QUIET = 0 ]; then printf '%s\n' "$out" | grep -E '^  [a-z-]+ +(missing|partial|ok|other) ' | sed "s/^/    [$plat\/$target] /" | cut -c1-170; fi
    rm -rf "$H"
  done
done
# The standalone settings script (standalone/token-setup.mjs), same columns: "failures" counts lines it skipped as invalid.
for plat in linux darwin win32; do
  for t in claude codex agy cursor; do
    H="$(mktemp -d)"
    out="$(ASKAI_FAKE_PLATFORM=$plat PATH="$FAKE:$PATH" node -r "$ROOT/scripts/fake-platform.cjs" "$ROOT/standalone/token-setup.mjs" --home "$H" --tools "$t" --install-clis 2>&1)"; code=$?
    planned=$(printf '%s\n' "$out" | grep -cE '\[preview\]|  > |PowerShell|download page')
    failed=$(printf '%s\n' "$out" | grep -cE 'not valid JSON|unknown tool')
    wrote=$(find "$H" -type f | wc -l | tr -d ' ')
    echo "| $plat | standalone:$t | $code | $planned | $failed | $wrote |"
    [ "$code" = 0 ] && [ "$failed" = 0 ] && [ "$wrote" = 0 ] || bad=1
    rm -rf "$H"
  done
done
exit $bad
