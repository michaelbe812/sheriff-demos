/**
 * Conventions on the Nx Tree (generators only): lib folders, the scope list (lib-scopes.json),
 * kebab-case names, the source files of apps/ + libs/, and the explicit config of every lib
 * (project.json, package.json, ng-package.json, tsconfig*.json, tsconfig.base.json paths).
 * Shared by @blueprint/tooling-workspace and @blueprint/tooling-openapi.
 */
import type { Tree } from '@nx/devkit';
import * as ts from 'typescript';
import { LIBS_DIR, SCOPES_FILE, scopesOfFile, WORKSPACE_PACKAGE } from './lib-conventions';
import {
  type JsonObject,
  LIB_CONFIG_FILES,
  libConfigFiles,
  type LibConfigOptions,
  libPathsEntry,
  type Moved,
  relocateConfig,
  sortKeys,
} from './lib-files';

export * from './lib-files';

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function assertKebabCase(value: string, what: string): void {
  if (!KEBAB_CASE.test(value)) throw new Error(`${what} "${value}" must be kebab-case (e.g. "check-booking").`);
}

/** Path below libs/ of every lib (folder with src/index.ts) in the tree, sorted. */
export function listLibPaths(tree: Tree, below = ''): string[] {
  const libPaths: string[] = [];
  const visit = (dir: string): void => {
    if (tree.exists(`${dir}/src/index.ts`)) libPaths.push(dir.slice(`${LIBS_DIR}/`.length));
    for (const child of tree.children(dir)) {
      if (child !== 'src' && !tree.isFile(`${dir}/${child}`)) visit(`${dir}/${child}`);
    }
  };
  const root = below ? `${LIBS_DIR}/${below}` : LIBS_DIR;
  if (tree.exists(root)) visit(root);
  return libPaths.sort();
}

export const libExists = (tree: Tree, libPath: string): boolean => tree.exists(`${LIBS_DIR}/${libPath}/src/index.ts`);

export const readJsonFile = <T = JsonObject>(tree: Tree, path: string): T =>
  JSON.parse(tree.read(path, 'utf-8') ?? '{}');
/** 2 spaces + newline; formatFiles (prettier) normalizes the layout afterwards. */
export const writeJsonFile = (tree: Tree, path: string, json: unknown): void =>
  tree.write(path, `${JSON.stringify(json, null, 2)}\n`);

/** Scope list from lib-scopes.json. Undefined if there is none. */
export function readScopes(tree: Tree): string[] | undefined {
  return tree.exists(SCOPES_FILE) ? scopesOfFile(readJsonFile(tree, SCOPES_FILE)) : undefined;
}

function writeScopes(tree: Tree, update: (scopes: string[]) => string[]): void {
  const current = tree.exists(SCOPES_FILE) ? readJsonFile(tree, SCOPES_FILE) : {};
  writeJsonFile(tree, SCOPES_FILE, { ...current, scopes: [...new Set(update(readScopes(tree) ?? []))].sort() });
}

export function addScope(tree: Tree, scope: string): void {
  if (readScopes(tree)?.includes(scope)) return;
  writeScopes(tree, (scopes) => [...scopes, scope]);
}

export function removeScope(tree: Tree, scope: string): void {
  if (!readScopes(tree)?.includes(scope)) return;
  writeScopes(tree, (scopes) => scopes.filter((known) => known !== scope));
}

/** A domain (slice) exists when its scope is listed and it has at least one lib. */
export function assertSliceExists(tree: Tree, scope: string): void {
  const scopes = readScopes(tree);
  if (scopes && !scopes.includes(scope)) {
    throw new Error(
      `Unknown scope "${scope}" (${SCOPES_FILE}: ${scopes.join(', ')}). Create it first: nx g ${WORKSPACE_PACKAGE}:domain ${scope}`,
    );
  }
  if (listLibPaths(tree, scope).length === 0) {
    throw new Error(
      `Slice "${scope}" has no libs below ${LIBS_DIR}/${scope}. Create it first: nx g ${WORKSPACE_PACKAGE}:domain ${scope}`,
    );
  }
}

/** Source files of the app + libs (where `@blueprint/…` imports live). */
export function forEachSourceFile(tree: Tree, callback: (path: string, content: string) => void): void {
  const visit = (dir: string): void => {
    if (!tree.exists(dir)) return;
    for (const child of tree.children(dir)) {
      const path = `${dir}/${child}`;
      if (tree.isFile(path)) {
        if (/\.(ts|mts|cts|js|mjs|cjs|html)$/.test(child)) callback(path, tree.read(path, 'utf-8') ?? '');
      } else if (!['node_modules', 'dist', 'tmp'].includes(child)) {
        visit(path);
      }
    }
  };
  visit('apps');
  visit(LIBS_DIR);
}

/* ---------- explicit lib config: files + tsconfig.base.json paths ---------- */

export const BASE_TSCONFIG = 'tsconfig.base.json';

function updateBasePaths(tree: Tree, update: (paths: Record<string, string[]>) => Record<string, string[]>): void {
  const tsconfig = readJsonFile<{ compilerOptions?: { paths?: Record<string, string[]> } }>(tree, BASE_TSCONFIG);
  const compilerOptions = tsconfig.compilerOptions ?? {};
  writeJsonFile(tree, BASE_TSCONFIG, {
    ...tsconfig,
    compilerOptions: { ...compilerOptions, paths: sortKeys(update({ ...compilerOptions.paths })) },
  });
}

/** Exact `paths` entry per lib (no wildcard): alias → libs/<path>/src/index.ts. */
export function addLibPaths(tree: Tree, libPaths: string[]): void {
  updateBasePaths(tree, (paths) => ({ ...paths, ...Object.fromEntries(libPaths.map(libPathsEntry)) }));
}

export function removeLibPaths(tree: Tree, libPaths: string[]): void {
  const aliases = new Set(libPaths.map((libPath) => libPathsEntry(libPath)[0]));
  updateBasePaths(tree, (paths) => Object.fromEntries(Object.entries(paths).filter(([alias]) => !aliases.has(alias))));
}

/** true if src/ holds a spec (→ tsconfig.spec.json + `test` target). */
export function libHasSpecs(tree: Tree, libPath: string): boolean {
  const visit = (dir: string): boolean =>
    tree.exists(dir) &&
    tree
      .children(dir)
      .some((child) => (tree.isFile(`${dir}/${child}`) ? child.endsWith('.spec.ts') : visit(`${dir}/${child}`)));
  return visit(`${LIBS_DIR}/${libPath}/src`);
}

const isSpecFile = (file: string): boolean => /\.(spec|test)\.ts$/.test(file);
const packageNameOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

/**
 * peerDependencies of a buildable lib: npm packages its production code (src/ without specs) imports,
 * as `^<major>.0.0` of the version in the root package.json (tslib excluded, ng-packagr adds it).
 * Written once by the generators — like any package.json, it is maintained by hand afterwards.
 */
export function productionPeerDependencies(tree: Tree, libPath: string): Record<string, string> {
  const rootPackage = readJsonFile<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    tree,
    'package.json',
  );
  const versions = { ...rootPackage.devDependencies, ...rootPackage.dependencies };
  const peers: Record<string, string> = {};
  const visit = (dir: string): void => {
    for (const child of tree.exists(dir) ? tree.children(dir) : []) {
      const path = `${dir}/${child}`;
      if (!tree.isFile(path)) visit(path);
      else if (path.endsWith('.ts') && !isSpecFile(path)) {
        for (const { fileName } of ts.preProcessFile(tree.read(path, 'utf-8') ?? '', true, true).importedFiles) {
          const name = packageNameOf(fileName);
          const major = /\d+/.exec(versions[name] ?? '')?.[0];
          if (!fileName.startsWith('.') && !fileName.startsWith('@blueprint/') && name !== 'tslib' && major) {
            peers[name] = `^${major}.0.0`;
          }
        }
      }
    }
  };
  visit(`${LIBS_DIR}/${libPath}/src`);
  return sortKeys(peers);
}

/**
 * Writes the config files of a lib (lib-files.ts) + its paths entry. Existing files are overwritten:
 * call it for new libs only. `hasSpecs` / `peerDependencies` default to what src/ contains.
 */
export function writeLibConfig(tree: Tree, libPath: string, options: LibConfigOptions = {}): void {
  const files = libConfigFiles(libPath, {
    scopes: readScopes(tree),
    hasSpecs: libHasSpecs(tree, libPath),
    peerDependencies: productionPeerDependencies(tree, libPath),
    ...options,
  });
  for (const [file, json] of Object.entries(files)) writeJsonFile(tree, `${LIBS_DIR}/${libPath}/${file}`, json);
  addLibPaths(tree, [libPath]);
}

/**
 * A lib got its first spec: tsconfig.spec.json + `test` target (no-op if it has both).
 * Returns true if something was written.
 */
export function addSpecConfig(tree: Tree, libPath: string): boolean {
  const root = `${LIBS_DIR}/${libPath}`;
  const project = readJsonFile<{ targets?: Record<string, unknown> }>(tree, `${root}/project.json`);
  const hasTest = Boolean(project.targets?.['test']);
  if (hasTest && tree.exists(`${root}/tsconfig.spec.json`)) return false;
  const files = libConfigFiles(libPath, { scopes: readScopes(tree), hasSpecs: true });
  writeJsonFile(tree, `${root}/tsconfig.spec.json`, files['tsconfig.spec.json']);
  if (!hasTest) writeJsonFile(tree, `${root}/project.json`, { ...project, targets: { ...project.targets, test: {} } });
  return true;
}

/**
 * Keeps the config of a lib in step once its files are under libs/<to> already (move/rename):
 * path-dependent fields of every config file and the paths entry. implicitDependencies naming a
 * moved project: updateImplicitDependencies.
 */
export function relocateLibConfig(tree: Tree, from: string, to: string, moved: Moved = { from, to }): void {
  const scopes = readScopes(tree);
  for (const file of LIB_CONFIG_FILES) {
    const path = `${LIBS_DIR}/${to}/${file}`;
    if (tree.exists(path))
      writeJsonFile(tree, path, relocateConfig(file, readJsonFile(tree, path), from, to, { scopes }, moved));
  }
  removeLibPaths(tree, [from]);
  addLibPaths(tree, [to]);
}

/** Every project.json below libs/ (lib and OpenAPI client projects). */
export function listProjectJsons(tree: Tree): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const child of tree.exists(dir) ? tree.children(dir) : []) {
      const path = `${dir}/${child}`;
      if (child === 'project.json') found.push(path);
      else if (child !== 'src' && !tree.isFile(path)) visit(path);
    }
  };
  visit(LIBS_DIR);
  return found.sort();
}

/** Renames (new name) or drops (undefined) project names in every implicitDependencies below libs/. */
export function updateImplicitDependencies(tree: Tree, rename: Map<string, string | undefined>): void {
  for (const file of listProjectJsons(tree)) {
    const project = readJsonFile<{ implicitDependencies?: string[] }>(tree, file);
    if (!project.implicitDependencies?.some((name) => rename.has(name))) continue;
    const implicitDependencies = project.implicitDependencies.flatMap((name) => {
      if (!rename.has(name)) return [name];
      const renamed = rename.get(name);
      return renamed === undefined ? [] : [renamed];
    });
    writeJsonFile(tree, file, { ...project, implicitDependencies });
  }
}
