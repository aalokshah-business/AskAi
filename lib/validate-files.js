'use strict';
// The project-pack check shared by askai check and scripts/validate-install.js.
const fs = require('fs');
const path = require('path');

const NEED = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorignore', 'docs/ai/PROJECT_MAP.md', 'docs/ai/ARCHITECTURE.md', 'docs/ai/FEATURES.md', 'docs/ai/WORK_ORDER.md', 'docs/ai/MODELS.md'];

function validateFiles(dir) {
  const missing = NEED.filter(rel => !fs.existsSync(path.join(dir, rel)));
  const text = missing.length ? `Files: missing ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}` : 'Files: project pack present';
  return { missing, text };
}

module.exports = { NEED, validateFiles };
