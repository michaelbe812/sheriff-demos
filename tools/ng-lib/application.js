// @nx/angular:application gegen dist der Libs, ohne lib-package.json.
// Nx findet den Import-Alias einer Lib nur über deren package.json; fehlt sie, bleibt der
// Alias auf den Quellen und die App baut still aus Source. Deshalb: tsconfig mit dist-Paths
// erzeugen (Alias aus tsconfig.base.json) und damit an das Original delegieren.
const { relative } = require('path');
const applicationExecutor = require('@nx/angular/src/executors/application/application.impl').default;
const { tmpDirFor, writeRemappedTsConfig } = require('./lib');

async function* ngLibApplicationExecutor(options, context) {
  if (options.buildLibsFromSource !== false) {
    return yield* applicationExecutor(options, context);
  }
  const tsConfigFile = writeRemappedTsConfig(context, tmpDirFor(context), options.tsConfig);
  return yield* applicationExecutor({ ...options, tsConfig: relative(context.root, tsConfigFile) }, context);
}

module.exports = ngLibApplicationExecutor;
module.exports.default = ngLibApplicationExecutor;
