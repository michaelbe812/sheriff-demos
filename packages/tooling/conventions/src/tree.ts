/**
 * Conventions on the Nx Tree (generators only — the plugins must not load @nx/devkit at runtime):
 * lib folders, the scope list in nx.json, kebab-case names, the source files of apps/ + libs/.
 * Shared by @blueprint/tooling-workspace and @blueprint/tooling-openapi.
 */
import {
  type ExpandedPluginConfiguration,
  type PluginConfiguration,
  readNxJson,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { LIBS_DIR, WORKSPACE_PLUGIN } from './lib-conventions';

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

function findPluginEntry(plugins: PluginConfiguration[]): number {
  return plugins.findIndex((plugin) => (typeof plugin === 'string' ? plugin : plugin.plugin) === WORKSPACE_PLUGIN);
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
  if (index === -1) index = plugins.push(WORKSPACE_PLUGIN) - 1;
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
    throw new Error(
      `Unknown scope "${scope}" (nx.json scopes: ${scopes.join(', ')}). Create it first: nx g ${WORKSPACE_PLUGIN}:domain ${scope}`,
    );
  }
  if (listLibPaths(tree, scope).length === 0) {
    throw new Error(
      `Slice "${scope}" has no libs below ${LIBS_DIR}/${scope}. Create it first: nx g ${WORKSPACE_PLUGIN}:domain ${scope}`,
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
