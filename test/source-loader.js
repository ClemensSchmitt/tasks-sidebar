// Run source-level tests without compiling or writing out/ artifacts.
// Usage: node --require ./test/source-loader.js --test test/runtime.test.js
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  const absolute = parent && path.resolve(path.dirname(parent.filename), request);
  if (['runtime', 'extension', 'globalTasks'].some(name => absolute === path.join(root, 'out', name + '.js'))) {
    return absolute.replace(path.sep + 'out' + path.sep, path.sep + 'src' + path.sep).replace(/\.js$/, '.ts');
  }
  return resolve.call(this, request, parent, ...rest);
};
require.extensions['.ts'] = function(module, filename) {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename
  });
  module._compile(result.outputText, filename);
};
