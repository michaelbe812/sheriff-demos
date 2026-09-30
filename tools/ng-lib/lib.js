// Gemeinsame Helfer der ng-lib-Executoren.
//
// Warum es sie gibt: Nx mappt beim Build gegen dist den Import einer Lib nur dann
// auf dist/, wenn die Lib eine package.json mit `name` = Import-Alias hat
// (@nx/js calculateProjectBuildableDependencies: sonst Projektname "booking-data").
// Ohne lib-package.json würde die Lib still aus den Quellen kompiliert.
// Hier kommt der Alias stattdessen aus tsconfig.base.json `paths`.
const { dirname, join, relative, resolve, sep } = require('path');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const { calculateProjectBuildableDependencies } = require('@nx/js/internal');

const BASE_TSCONFIG = 'tsconfig.base.json';

function readBasePaths(workspaceRoot) {
  const tsconfig = JSON.parse(readFileSync(join(workspaceRoot, BASE_TSCONFIG), 'utf-8'));
  return tsconfig.compilerOptions.paths ?? {};
}

const DEFAULT_ENTRY = 'src/index.ts';

/**
 * Import-Alias einer Lib. Reihenfolge:
 *   1. project metadata.js.packageName (kann ein Crystal-Plugin setzen)
 *   2. exakter paths-Eintrag, dessen Ziel im Projekt-Root liegt
 *   3. Wildcard-Eintrag (z.B. "@blueprint/*": ["libs/*\/src/index.ts"]) per Einsetzen
 */
function aliasForProject(basePaths, projectRoot, metadata) {
  if (metadata?.js?.packageName) return metadata.js.packageName;
  const root = projectRoot.replace(/\/$/, '');
  const normalize = (target) => target.replace(/^\.\//, '');
  const exact = Object.entries(basePaths).filter(
    ([alias, targets]) => !alias.includes('*') && targets.some((t) => normalize(t).startsWith(root + '/')),
  );
  if (exact.length === 1) return exact[0][0];
  const entry = `${root}/${DEFAULT_ENTRY}`;
  for (const [alias, targets] of Object.entries(basePaths)) {
    if (!alias.includes('*')) continue;
    for (const target of targets.map(normalize)) {
      const [prefix, suffix] = target.split('*');
      if (suffix !== undefined && entry.startsWith(prefix) && entry.endsWith(suffix)) {
        return alias.replace('*', entry.slice(prefix.length, entry.length - suffix.length));
      }
    }
  }
  return undefined;
}

/**
 * Kopie der base-paths, in der jede gebaute Abhängigkeit (transitiv) auf ihr dist zeigt.
 * Nicht gebaute Libs bleiben auf den Quellen, genau wie bei Nx selbst.
 */
function pathsWithDistForDependencies(context) {
  const { root: workspaceRoot, projectName, targetName, configurationName } = context;
  const basePaths = readBasePaths(workspaceRoot);
  const { dependencies } = calculateProjectBuildableDependencies(
    context.taskGraph,
    context.projectGraph,
    workspaceRoot,
    projectName,
    targetName,
    configurationName,
  );
  const paths = Object.fromEntries(
    Object.entries(basePaths).map(([alias, targets]) => [alias, targets.map((t) => resolve(workspaceRoot, t))]),
  );
  for (const dependency of dependencies) {
    if (dependency.node.type !== 'lib' || !dependency.outputs?.length) continue;
    const alias = aliasForProject(basePaths, dependency.node.data.root, dependency.node.data.metadata);
    if (!alias) continue;
    paths[alias] = dependency.outputs.map((output) => resolve(workspaceRoot, output));
  }
  return paths;
}

/** Temp-Verzeichnis pro Projekt+Target, liegt im gitignored tmp/ (wie Nx' eigene tsconfig.generated.*). */
function tmpDirFor(context) {
  const projectRoot = context.projectsConfigurations.projects[context.projectName].root;
  const dir = join(context.root, 'tmp', 'ng-lib', projectRoot, context.targetName);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, content) {
  writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
  return file;
}

/** tsconfig, die `baseTsConfig` erweitert und die dist-Paths setzt. */
function writeRemappedTsConfig(context, dir, baseTsConfig, compilerOptions = {}) {
  return writeJson(join(dir, 'tsconfig.json'), {
    extends: toPosix(relative(dir, resolve(context.root, baseTsConfig))),
    compilerOptions: { ...compilerOptions, paths: pathsWithDistForDependencies(context) },
  });
}

function toPosix(path) {
  return path.split(sep).join('/');
}

module.exports = {
  aliasForProject,
  readBasePaths,
  tmpDirFor,
  toPosix,
  writeJson,
  writeRemappedTsConfig,
};
