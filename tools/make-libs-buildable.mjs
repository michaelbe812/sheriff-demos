#!/usr/bin/env node
/**
 * Makes every lib under libs/ buildable (idempotent — rerun after adding a lib).
 *
 *   node tools/make-libs-buildable.mjs
 *
 * Writes per lib what `nx g @nx/angular:library --buildable` would generate:
 *   ng-package.json, package.json (name = import alias), tsconfig.lib.json,
 *   tsconfig.lib.prod.json and a `build` target (@nx/angular:ng-packagr-lite).
 * cache / dependsOn / inputs come from `targetDefaults.build` in nx.json.
 *
 * Alias comes from tsconfig.base.json (paths stay source aliases); peer
 * dependencies are the external packages the lib's sources import.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = join(WORKSPACE_ROOT, 'libs');
const rootPackage = readJson(join(WORKSPACE_ROOT, 'package.json'));
const tsPaths = readJson(join(WORKSPACE_ROOT, 'tsconfig.base.json')).compilerOptions.paths;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** All dirs below libs/ that contain a project.json. */
function findLibRoots(directory = LIBS) {
  if (existsSync(join(directory, 'project.json'))) return [directory];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .flatMap((entry) => findLibRoots(join(directory, entry.name)));
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** '@angular/core/rxjs-interop' -> '@angular/core', 'rxjs/operators' -> 'rxjs'. */
const packageName = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

function peerDependencies(libRoot) {
  const imported = new Set();
  for (const file of sourceFiles(join(libRoot, 'src'))) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const [, specifier] of code.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('@hex/')) imported.add(packageName(specifier));
    }
  }
  const versionOf = (name) => rootPackage.dependencies?.[name] ?? rootPackage.devDependencies?.[name];
  return Object.fromEntries(
    [...imported].sort().map((name) => {
      const version = versionOf(name);
      if (!version) throw new Error(`${relative(WORKSPACE_ROOT, libRoot)} imports ${name}, not in root package.json`);
      // ~22.0.4 -> ^22.0.0: libs accept any Angular 22
      return [name, name.startsWith('@angular/') ? `^${version.replace(/^[~^]/, '').split('.')[0]}.0.0` : version];
    }),
  );
}

function makeBuildable(libRoot) {
  const projectRoot = relative(WORKSPACE_ROOT, libRoot);
  const toWorkspace = relative(libRoot, WORKSPACE_ROOT);
  const alias = Object.keys(tsPaths).find((key) => tsPaths[key][0] === `./${projectRoot}/src/index.ts`);
  if (!alias) throw new Error(`${projectRoot}: no path alias in tsconfig.base.json`);

  writeJson(join(libRoot, 'ng-package.json'), {
    $schema: `${toWorkspace}/node_modules/ng-packagr/ng-package.schema.json`,
    dest: `${toWorkspace}/dist/${projectRoot}`,
    lib: { entryFile: 'src/index.ts' },
  });

  const peers = peerDependencies(libRoot);
  writeJson(join(libRoot, 'package.json'), {
    name: alias,
    version: '0.0.1',
    private: true,
    ...(Object.keys(peers).length > 0 && { peerDependencies: peers }),
    sideEffects: false,
  });

  writeJson(join(libRoot, 'tsconfig.lib.json'), {
    extends: './tsconfig.json',
    compilerOptions: {
      outDir: `${toWorkspace}/dist/out-tsc`,
      noEmit: false,
      declaration: true,
      declarationMap: true,
      inlineSources: true,
      types: [],
    },
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  });

  writeJson(join(libRoot, 'tsconfig.lib.prod.json'), {
    extends: './tsconfig.lib.json',
    compilerOptions: { declarationMap: false },
    angularCompilerOptions: {},
  });

  const projectFile = join(libRoot, 'project.json');
  const project = readJson(projectFile);
  const { build: _previous, ...otherTargets } = project.targets ?? {};
  project.targets = {
    build: {
      executor: '@nx/angular:ng-packagr-lite',
      outputs: ['{workspaceRoot}/dist/{projectRoot}'],
      defaultConfiguration: 'production',
      options: {
        project: `${projectRoot}/ng-package.json`,
        tsConfig: `${projectRoot}/tsconfig.lib.json`,
      },
      configurations: {
        production: { tsConfig: `${projectRoot}/tsconfig.lib.prod.json` },
        development: {},
      },
    },
    ...otherTargets,
  };
  writeJson(projectFile, project);
  return `${project.name} -> ${alias}`;
}

findLibRoots().sort().forEach((libRoot) => console.log(makeBuildable(libRoot)));
