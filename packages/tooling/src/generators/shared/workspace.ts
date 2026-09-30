import {
  type ExpandedPluginConfiguration,
  type PluginConfiguration,
  readNxJson,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { LIBS_DIR, parseLibPath, SHARED_SCOPE } from '../../plugin/lib-conventions';

/** Name of this plugin in nx.json → plugins. */
export const PLUGIN_NAME = '@blueprint/tooling';
/** Default app shell routes (lazy domain routes are registered here). */
export const APP_ROUTES_FILE = 'apps/client/src/app/app.routes.ts';

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

/** Libs whose path is `path` itself or below it (a lib, a feat or a whole slice). */
export const libsAt = (tree: Tree, path: string): string[] =>
  listLibPaths(tree).filter((libPath) => libPath === path || libPath.startsWith(`${path}/`));

/** Writes a file only if it does not exist yet (generators are idempotent). Returns true if written. */
export function writeIfMissing(tree: Tree, path: string, content: string): boolean {
  if (tree.exists(path)) return false;
  tree.write(path, content);
  return true;
}

/** Adds `export * from './<file>';` to a lib's index.ts, unless it is already there. */
export function addExport(tree: Tree, libPath: string, relativeFile: string): void {
  const indexFile = `${LIBS_DIR}/${libPath}/src/index.ts`;
  const line = `export * from './${relativeFile.replace(/\.ts$/, '')}';`;
  const content = tree.exists(indexFile) ? tree.read(indexFile, 'utf-8') ?? '' : '';
  if (content.includes(line)) return;
  // a fresh lib may carry the placeholder `export {};`
  const kept = content.replace(/^export \{\};\s*$/m, '').trimEnd();
  tree.write(indexFile, `${kept ? `${kept}\n` : ''}${line}\n`);
}

function findPluginEntry(plugins: PluginConfiguration[]): number {
  return plugins.findIndex((plugin) => (typeof plugin === 'string' ? plugin : plugin.plugin) === PLUGIN_NAME);
}

/** Scope list from nx.json (plugin options). Undefined if the plugin has no list. */
export function readScopes(tree: Tree): string[] | undefined {
  const plugins = readNxJson(tree)?.plugins ?? [];
  const entry = plugins[findPluginEntry(plugins)];
  return typeof entry === 'object' ? (entry.options as { scopes?: string[] } | undefined)?.scopes : undefined;
}

function writeScopes(tree: Tree, update: (scopes: string[]) => string[]): void {
  const nxJson = readNxJson(tree) ?? {};
  const plugins = nxJson.plugins ?? [];
  let index = findPluginEntry(plugins);
  if (index === -1) index = plugins.push(PLUGIN_NAME) - 1;
  const current = plugins[index];
  const entry: ExpandedPluginConfiguration<{ scopes?: string[] }> =
    typeof current === 'string' ? { plugin: current } : (current as ExpandedPluginConfiguration<{ scopes?: string[] }>);
  const scopes = update(entry.options?.scopes ?? []);
  plugins[index] = { ...entry, options: { ...entry.options, scopes: [...new Set(scopes)].sort() } };
  updateNxJson(tree, { ...nxJson, plugins });
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
    throw new Error(`Unknown scope "${scope}" (nx.json scopes: ${scopes.join(', ')}). Create it first: nx g ${PLUGIN_NAME}:domain ${scope}`);
  }
  if (listLibPaths(tree, scope).length === 0) {
    throw new Error(`Slice "${scope}" has no libs below ${LIBS_DIR}/${scope}. Create it first: nx g ${PLUGIN_NAME}:domain ${scope}`);
  }
}

/** Scope list after libs moved/were removed: every scope with libs listed, no scope without libs (except shared). */
export function syncScopesWithLibs(tree: Tree, touchedScopes: string[]): void {
  if (!readScopes(tree)) return;
  for (const scope of new Set(touchedScopes)) {
    const hasLibs = listLibPaths(tree, scope).length > 0;
    if (hasLibs) addScope(tree, scope);
    else if (scope !== SHARED_SCOPE) removeScope(tree, scope);
  }
}

export const scopeOf = (libPath: string): string => libPath.split('/')[0];

export function assertValidLibPath(libPath: string): void {
  if (!parseLibPath(libPath)) {
    throw new Error(`${LIBS_DIR}/${libPath}: not a blueprint lib path (libs/<scope>/<layer> or libs/<scope>/feat-<feat>/<layer>).`);
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

/** Every file below `dir` (recursive, tree paths). */
export function filesBelow(tree: Tree, dir: string): string[] {
  if (!tree.exists(dir)) return [];
  if (tree.isFile(dir)) return [dir];
  return tree.children(dir).flatMap((child) => filesBelow(tree, `${dir}/${child}`));
}

/** `libs/booking/` → `booking`, `booking` → `booking`. */
export const normalizeLibsPath = (path: string): string =>
  path
    .trim()
    .replace(/^\.?\/?/, '')
    .replace(new RegExp(`^${LIBS_DIR}/`), '')
    .replace(/\/+$/, '');

/** Files outside apps/ and libs/ that mention `text` (docs, scripts) — worth a manual look after a move. */
export function mentionsOutsideSources(tree: Tree, text: string): string[] {
  const hits: string[] = [];
  const visit = (dir: string): void => {
    for (const child of tree.children(dir)) {
      const path = dir ? `${dir}/${child}` : child;
      if (['node_modules', 'dist', 'tmp', '.git', '.nx', '.angular', 'apps', LIBS_DIR].includes(path)) continue;
      if (tree.isFile(path)) {
        // specs of this package use aliases as fixtures — not worth a hint
        const relevant = /\.(ts|mts|js|mjs|cjs|json|md)$/.test(child) && !child.endsWith('.spec.ts');
        if (relevant && (tree.read(path, 'utf-8') ?? '').includes(text)) hits.push(path);
      } else visit(path);
    }
  };
  visit('');
  return hits;
}
