'use strict';
const fs = require('fs');
const path = require('path');

function autoCpp(ctx, dir) {
  const clangd = !!(ctx.which && ctx.which('clangd'));
  const commands = !!(dir && fs.existsSync(path.join(dir, 'compile_commands.json')));
  return clangd && commands;
}

module.exports = { autoCpp };
