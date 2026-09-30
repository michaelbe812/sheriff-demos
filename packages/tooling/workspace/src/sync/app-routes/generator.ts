/**
 * Global sync generator (`nx sync` / `nx sync:check`, nx.json → sync.globalGenerators):
 * - every slice shell (libs/<scope>/shell exporting Routes) is lazily registered in the app routes
 * - no lazy route (app routes or slice shell routes) points at a lib that does not exist
 */
import { formatFiles, type Tree } from '@nx/devkit';
import type { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import { LIBS_DIR } from '@blueprint/tooling-conventions';
import { findExportedRoutes, findLazyRoutes, libPathOfSpecifier, removeRoutes, updateFile } from '../../generators/shared/routes';
import { registerSliceRoute } from '../../generators/shared/slice';
import { APP_ROUTES_FILE, libExists, listLibPaths } from '../../generators/shared/workspace';

export interface AppRoutesSyncOptions {
  appRoutesFile?: string;
}

/** Lazy route target that is no lib (anymore). Non-`@blueprint` specifiers are not ours to judge. */
const pointsNowhere = (tree: Tree) => (specifier: string) => {
  const libPath = libPathOfSpecifier(specifier);
  return libPath !== undefined && !libExists(tree, libPath);
};

export async function appRoutesSyncGenerator(tree: Tree, options: AppRoutesSyncOptions = {}): Promise<SyncGeneratorResult> {
  const appRoutesFile = options.appRoutesFile ?? APP_ROUTES_FILE;
  if (!tree.exists(appRoutesFile)) return { outOfSyncMessage: `${appRoutesFile} is missing` };
  const details: string[] = [];

  const shells = listLibPaths(tree).filter((libPath) => /^[^/]+\/shell$/.test(libPath) && findExportedRoutes(tree, libPath));
  const routeFiles = [appRoutesFile, ...shells.map((shell) => findExportedRoutes(tree, shell)?.file as string)];
  for (const file of routeFiles) {
    updateFile(tree, file, (content) => {
      const { content: cleaned, removed } = removeRoutes(content, pointsNowhere(tree), file);
      removed.forEach((route) => details.push(`${file}: route "${route.path ?? '?'}" → ${route.specifier} (no such lib) removed`));
      return cleaned;
    });
  }

  const registered = new Set(findLazyRoutes(tree.read(appRoutesFile, 'utf-8') ?? '', appRoutesFile).map((route) => route.specifier));
  for (const shell of shells) {
    const scope = shell.split('/')[0];
    if (registered.has(`@blueprint/${shell}`)) continue;
    registerSliceRoute(tree, scope, appRoutesFile);
    details.push(`${appRoutesFile}: ${LIBS_DIR}/${shell} was not registered — added route "${scope}"`);
  }

  if (details.length === 0) return;
  await formatFiles(tree);
  return {
    outOfSyncMessage: 'Slice shells and app routes are out of sync (run `nx sync`).',
    outOfSyncDetails: details,
  };
}

export default appRoutesSyncGenerator;
