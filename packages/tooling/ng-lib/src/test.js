// @nx/angular:unit-test (Vitest) für Libs ohne ng-package.json und ohne tsconfig.spec.json pro Lib.
//
// Problem 1: Der Angular-Builder liest die Optionen des buildTarget. Nx mappt nur ng-packagr-lite/package
//   auf @angular/build:ng-packagr, und dieser Pfad liest <root>/ng-package.json (nur für Styles/Assets).
//   @blueprint/tooling-ng-lib:build kennt er nicht. Lösung: Nx' Builder-Context liest Executor und Optionen aus
//   context.projectGraph. Der Wrapper reicht eine Kopie des Kontexts weiter, in der das buildTarget
//   @angular/build:ng-packagr mit einer temporären ng-package.json ist. Kein Monkeypatching.
// Problem 2: Eine gemeinsame spec-tsconfig mit **/*.spec.ts würde pro Lib alle Specs des Workspaces
//   kompilieren. Der Wrapper erzeugt eine tsconfig, die die gemeinsame erweitert und `include` auf die
//   Specs dieser Lib setzt (wie ng-lib:build für den Build).
// Vitest UI: `nx run <lib>:test --ui` (kein eigenes Target). Mit `ui` schaltet der Wrapper watch ein und
//   die Browser auf headed (`chromiumHeadless` → `chromium`, Angular zeigt dann die Vorschau in der UI);
//   `--headless` erzwingt weiter headless. Ohne `ui` gehen die Optionen unverändert durch.
const { join, relative, resolve } = require('path');
const unitTestExecutor = require('@nx/angular/src/executors/unit-test/unit-test.impl').default;
const { tmpDirFor, toPosix, writeJson } = require('./lib');

const NG_LIB_BUILD_EXECUTOR = '@blueprint/tooling-ng-lib:build';
const NG_PACKAGR_BUILDER = '@angular/build:ng-packagr';

/** Gleiche Auflösung wie @nx/angular:unit-test: Default `::development` → <projekt>:build:development. */
function parseBuildTarget(buildTarget, projectName) {
  const [project, target, configuration] = (buildTarget ?? '::development').split(':');
  return { project: project || projectName, target: target || 'build', configuration };
}

/** tsconfig = gemeinsame spec-tsconfig, aber nur mit den Specs (+ .d.ts) dieser Lib. */
function writeSpecTsConfig(context, dir, sharedTsConfig) {
  const projectRoot = context.projectsConfigurations.projects[context.projectName].root;
  const fromDir = (path) => toPosix(relative(dir, resolve(context.root, path)));
  return writeJson(join(dir, 'tsconfig.json'), {
    extends: fromDir(sharedTsConfig),
    include: [fromDir(join(projectRoot, 'src/**/*.spec.ts')), fromDir(join(projectRoot, 'src/**/*.d.ts'))],
  });
}

/** Kopie des Kontexts, in der ein ng-lib:build-Target als ng-packagr-Target mit temporärer ng-package.json erscheint. */
function withNgPackagrBuildTarget(context, dir, buildTarget) {
  const node = context.projectGraph.nodes[buildTarget.project];
  const target = node?.data.targets?.[buildTarget.target];
  if (target?.executor !== NG_LIB_BUILD_EXECUTOR) return context;

  // der Builder liest daraus nur lib.styleIncludePaths, assets, inlineStyleLanguage
  const ngPackageFile = writeJson(join(dir, 'ng-package.json'), {
    lib: { entryFile: toPosix(resolve(context.root, node.data.root, 'src/index.ts')) },
  });
  const ngPackagrTarget = {
    ...target,
    executor: NG_PACKAGR_BUILDER,
    options: { project: relative(context.root, ngPackageFile) },
    configurations: Object.fromEntries(Object.keys(target.configurations ?? {}).map((name) => [name, {}])),
  };
  const patchedNode = { ...node, data: { ...node.data, targets: { ...node.data.targets, [buildTarget.target]: ngPackagrTarget } } };
  return {
    ...context,
    projectGraph: { ...context.projectGraph, nodes: { ...context.projectGraph.nodes, [buildTarget.project]: patchedNode } },
  };
}

/** `ui` → watch + headed Browser; sonst unverändert. */
function withUiDefaults(options) {
  if (!options.ui) return options;
  const browsers = options.browsers?.map((browser) => browser.replace(/Headless$/, ''));
  return { ...options, watch: true, ...(browsers && { browsers }) };
}

async function* ngLibTestExecutor(rawOptions, context) {
  const options = withUiDefaults(rawOptions);
  const dir = tmpDirFor(context);
  const tsConfigFile = writeSpecTsConfig(context, dir, options.tsConfig);
  const buildTarget = parseBuildTarget(options.buildTarget, context.projectName);
  return yield* unitTestExecutor(
    { ...options, tsConfig: relative(context.root, tsConfigFile) },
    withNgPackagrBuildTarget(context, dir, buildTarget),
  );
}

module.exports = ngLibTestExecutor;
module.exports.default = ngLibTestExecutor;
