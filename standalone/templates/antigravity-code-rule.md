---
trigger: glob
globs: "**/*.ts, **/*.tsx, **/*.js, **/*.jsx, **/*.py, **/*.go, **/*.rs, **/*.java, **/*.kt, **/*.swift, **/*.cs, **/*.rb, **/*.php, **/*.c, **/*.cpp, **/*.h"
description: "Token-saving rules for code files"
---

<!-- token-kit:managed -->
# Code files
- Run the narrowest test first and read only the failing lines.
- Search for the symbol, then read only its line range; do not re-read a file you just edited.
