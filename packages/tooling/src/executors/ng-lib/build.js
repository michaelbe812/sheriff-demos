// Lib-Build ohne Build-Config-Dateien in der Lib.
//
// Erzeugt pro Lauf in tmp/ng-lib/<projectRoot>/<target>/:
//   ng-package.json  dest + entryFile (absolut), ng-packagr verlangt die Datei
//   package.json     name/private/sideEffects/peerDependencies, ng-packagr verlangt sie neben ng-package.json
//   tsconfig.json    extends gemeinsame libs/tsconfig.lib.json + dist-Paths der Abhängigkeiten
// und delegiert dann unverändert an @nx/angular:ng-packagr-lite.
const { readdirSync, readFileSync } = require('fs');
const { join, relative, resolve } = require('path');
const ts = require('typescript');
const ngPackagrLite = require('@nx/angular/src/executors/ng-packagr-lite/ng-packagr-lite.impl').default;
const { aliasForProject, readBasePaths, tmpDirFor, toPosix, writeJson, writeRemappedTsConfig } = require('./lib');

const EXCLUDED_PEER_DEPENDENCIES = new Set(['tslib']);

const isTestFile = (file) => /\.(spec|test)\.ts$/.test(file);
const packageNameOf = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/**
 * npm-Pakete, die der Produktionscode (src/ ohne Specs) importiert. Der Projekt-Graph allein reicht
 * nicht: seine Kanten enthalten auch Imports aus Specs (vitest, msw), die gehören nicht in die dist-package.json.
 */
function productionPackageImports(sourceRoot) {
  const packages = new Set();
  const files = readdirSync(sourceRoot, { recursive: true }).filter((f) => f.endsWith('.ts') && !isTestFile(f));
  for (const file of files) {
    const { importedFiles } = ts.preProcessFile(readFileSync(join(sourceRoot, file), 'utf-8'), true, true);
    for (const { fileName } of importedFiles) {
      if (!fileName.startsWith('.') && !fileName.startsWith('/')) packages.add(packageNameOf(fileName));
    }
  }
  return packages;
}

/** peerDependencies = vom Produktionscode direkt importierte npm-Pakete laut Projekt-Graph, als ^<major>.0.0. */
function peerDependenciesFromGraph(context, projectRoot) {
  const { projectGraph, projectName } = context;
  const productionImports = productionPackageImports(join(context.root, projectRoot, 'src'));
  const peerDependencies = {};
  for (const { target } of projectGraph.dependencies[projectName] ?? []) {
    const node = projectGraph.externalNodes?.[target];
    if (!node || EXCLUDED_PEER_DEPENDENCIES.has(node.data.packageName)) continue;
    if (!productionImports.has(node.data.packageName)) continue;
    peerDependencies[node.data.packageName] = `^${node.data.version.split('.')[0]}.0.0`;
  }
  return Object.keys(peerDependencies).length
    ? Object.fromEntries(Object.entries(peerDependencies).sort(([a], [b]) => a.localeCompare(b)))
    : undefined;
}

function importPathFor(options, context, project) {
  const importPath = options.importPath ?? aliasForProject(readBasePaths(context.root), project.root, project.metadata);
  if (!importPath) {
    throw new Error(`ng-lib:build: kein Alias für ${project.root} in tsconfig.base.json paths und keine Option importPath.`);
  }
  return importPath;
}

async function* ngLibBuildExecutor(options, context) {
  const project = context.projectsConfigurations.projects[context.projectName];
  const projectRoot = project.root;
  const dir = tmpDirFor(context);

  writeJson(join(dir, 'package.json'), {
    name: importPathFor(options, context, project),
    version: '0.0.1',
    private: true,
    peerDependencies: peerDependenciesFromGraph(context, projectRoot),
    sideEffects: false,
  });
  const ngPackageFile = writeJson(join(dir, 'ng-package.json'), {
    dest: toPosix(resolve(context.root, options.outputPath ?? join('dist', projectRoot))),
    lib: { entryFile: toPosix(resolve(context.root, options.entryFile ?? join(projectRoot, 'src/index.ts'))) },
  });
  const tsConfigFile = writeRemappedTsConfig(context, dir, options.tsConfig, options.compilerOptions);

  // tsConfig muss workspace-relativ sein: Nx macht join(root, tsConfig).
  return yield* ngPackagrLite(
    { project: ngPackageFile, tsConfig: relative(context.root, tsConfigFile), watch: options.watch },
    context,
  );
}

module.exports = ngLibBuildExecutor;
module.exports.default = ngLibBuildExecutor;
