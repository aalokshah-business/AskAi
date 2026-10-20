# Preview runs: every OS and every tool

Generated 2026-10-20 by `bash scripts/preview-matrix.sh`: `askai install --dry-run --profile coding` and the standalone `token-setup.mjs --install-clis` preview, in throwaway config folders. Linux runs natively; `scripts/fake-platform.cjs` makes Node report `win32` or `darwin` for the Windows (winget) and macOS (Homebrew) code paths; dummy package managers are on PATH and a dry run never executes them. GitHub Actions runs the real PowerShell installer on Windows for every push (`scripts/windows-selftest.ps1`). The max profile is previewed by a separate test.

| OS | target | exit | components planned | failures | files written |
|:--|:--|--:|--:|--:|--:|
| linux | claude | 0 | 11 | 0 | 0 |
| linux | codex | 0 | 5 | 0 | 0 |
| linux | agy | 0 | 6 | 0 | 0 |
| linux | cursor | 0 | 4 | 0 | 0 |
| linux | all | 0 | 20 | 0 | 0 |
| darwin | claude | 0 | 11 | 0 | 0 |
| darwin | codex | 0 | 5 | 0 | 0 |
| darwin | agy | 0 | 6 | 0 | 0 |
| darwin | cursor | 0 | 4 | 0 | 0 |
| darwin | all | 0 | 20 | 0 | 0 |
| win32 | claude | 0 | 11 | 0 | 0 |
| win32 | codex | 0 | 5 | 0 | 0 |
| win32 | agy | 0 | 6 | 0 | 0 |
| win32 | cursor | 0 | 4 | 0 | 0 |
| win32 | all | 0 | 20 | 0 | 0 |
| linux | standalone:claude | 0 | 14 | 0 | 0 |
| linux | standalone:codex | 0 | 9 | 0 | 0 |
| linux | standalone:agy | 0 | 7 | 0 | 0 |
| linux | standalone:cursor | 0 | 4 | 0 | 0 |
| darwin | standalone:claude | 0 | 14 | 0 | 0 |
| darwin | standalone:codex | 0 | 9 | 0 | 0 |
| darwin | standalone:agy | 0 | 7 | 0 | 0 |
| darwin | standalone:cursor | 0 | 4 | 0 | 0 |
| win32 | standalone:claude | 0 | 14 | 0 | 0 |
| win32 | standalone:codex | 0 | 9 | 0 | 0 |
| win32 | standalone:agy | 0 | 7 | 0 | 0 |
| win32 | standalone:cursor | 0 | 4 | 0 | 0 |

Exit 0, no failures and no files written in every row.
