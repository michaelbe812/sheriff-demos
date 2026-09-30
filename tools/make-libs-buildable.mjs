#!/usr/bin/env node
/**
 * Makes every lib under libs/ buildable (idempotent, re-run after adding libs).
 *
 * Writes per lib what `nx g @nx/angular:library --buildable` would generate:
 * ng-package.json, package.json (name = import alias from tsconfig.base.json),
 * tsconfig.json / tsconfig.lib.json / tsconfig.lib.prod.json and a slim
 * `build` target. Executor options live in nx.json `targetDefaults.build`.
 *
 *   node tools/make-libs-buildable.mjs
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '..');
const BUILD_EXECUTOR = '@nx/angular:ng-packagr-lite';
const ANGULAR_PEER = '^22.0.0';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf-8'));
const writeJson = (file, data) =>
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

function findLibRoots(dir) {
  const own = existsSync(join(dir, 'project.json')) ? [dir] : [];
  const nested = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'src')
    .flatMap((entry) => findLibRoots(join(dir, entry.name)));
  return [...own, ...nested];
}

function listTsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** npm packages imported by the lib -> peerDependencies of its package.json. */
function peerDependencies(libRoot) {
  const rootDeps = readJson(join(workspaceRoot, 'package.json')).dependencies;
  const packages = new Set();
  for (const file of listTsFiles(join(libRoot, 'src'))) {
    for (const [, specifier] of readFileSync(file, 'utf-8').matchAll(
      /from\s+['"]([^'".][^'"]*)['"]/g,
    )) {
      if (specifier.startsWith('@blueprint/')) continue;
      const parts = specifier.split('/');
      packages.add(
        specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0],
      );
    }
  }
  return Object.fromEntries(
    [...packages]
      .sort()
      .map((name) => [
        name,
        name.startsWith('@angular/') ? ANGULAR_PEER : rootDeps[name],
      ]),
  );
}

const paths = readJson(join(workspaceRoot, 'tsconfig.base.json'))
  .compilerOptions.paths;
const aliasOf = (projectRoot) =>
  Object.entries(paths).find(
    ([, [target]]) => target === `./${projectRoot}/src/index.ts`,
  )?.[0];

for (const libDir of findLibRoots(join(workspaceRoot, 'libs'))) {
  const projectRoot = relative(workspaceRoot, libDir);
  const toRoot = relative(libDir, workspaceRoot);
  const alias = aliasOf(projectRoot);
  if (!alias) throw new Error(`no tsconfig path for ${projectRoot}`);

  const projectFile = join(libDir, 'project.json');
  const project = readJson(projectFile);
  project.targets = { build: { executor: BUILD_EXECUTOR }, ...project.targets };
  writeJson(projectFile, project);

  writeJson(join(libDir, 'ng-package.json'), {
    $schema: `${toRoot}/node_modules/ng-packagr/ng-package.schema.json`,
    dest: `${toRoot}/dist/${projectRoot}`,
    lib: { entryFile: 'src/index.ts' },
  });

  writeJson(join(libDir, 'package.json'), {
    name: alias,
    version: '0.0.1',
    // internal lib, never published -> Nx tags it npm:private
    private: true,
    peerDependencies: peerDependencies(libDir),
    sideEffects: false,
  });

  writeJson(join(libDir, 'tsconfig.json'), {
    extends: `${toRoot}/tsconfig.base.json`,
    compilerOptions: {
      isolatedModules: true,
      target: 'es2022',
      strict: true,
      noImplicitOverride: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      emitDecoratorMetadata: false,
      module: 'preserve',
    },
    angularCompilerOptions: {
      enableI18nLegacyMessageIdFormat: false,
      strictInjectionParameters: true,
      strictInputAccessModifiers: true,
      strictTemplates: true,
    },
    files: [],
    include: [],
    references: [{ path: './tsconfig.lib.json' }],
  });

  writeJson(join(libDir, 'tsconfig.lib.json'), {
    extends: './tsconfig.json',
    compilerOptions: {
      outDir: `${toRoot}/dist/out-tsc`,
      declaration: true,
      declarationMap: true,
      inlineSources: true,
      types: [],
    },
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  });

  writeJson(join(libDir, 'tsconfig.lib.prod.json'), {
    extends: './tsconfig.lib.json',
    compilerOptions: { declarationMap: false },
    angularCompilerOptions: {},
  });

  console.log(`buildable: ${projectRoot} (${alias})`);
}
