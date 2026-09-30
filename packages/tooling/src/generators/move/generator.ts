import { formatFiles, logger, type Tree } from '@nx/devkit';
import { aliasFor, FEAT_PREFIX, LIBS_DIR, libPathError } from '@blueprint/tooling-conventions';
import { registerFeatRoute } from '../feat/generator';
import { renameClientExports, updateClientEntries } from '../shared/clients';
import { rewriteAliases } from '../shared/imports';
import { findExportedRoutes, removeRoutes, renameRoutePath, updateFile } from '../shared/routes';
import {
  APP_ROUTES_FILE,
  filesBelow,
  forEachSourceFile,
  libsAt,
  mentionsOutsideSources,
  normalizeLibsPath,
  scopeOf,
  syncScopesWithLibs,
} from '../shared/workspace';

export interface MoveGeneratorSchema {
  /** lib, feat or domain below libs/, e.g. `booking/ui`, `booking/feat-rebook`, `booking` */
  from: string;
  /** new path below libs/ */
  to: string;
  appRoutesFile?: string;
  skipFormat?: boolean;
}

/**
 * Moves a lib, a feat or a whole domain below libs/ and rewrites every `@blueprint/…` specifier in
 * apps/ and libs/ (static imports, `export … from`, dynamic `import()` in routes). Keeps route paths,
 * the scope list and openapi-clients.json in step.
 */
export async function moveGenerator(tree: Tree, options: MoveGeneratorSchema): Promise<void> {
  const from = normalizeLibsPath(options.from);
  const to = normalizeLibsPath(options.to);
  const libs = libsAt(tree, from);
  if (libs.length === 0) throw new Error(`Nothing to move: no lib at or below ${LIBS_DIR}/${from}`);
  if (from === to) throw new Error('from and to are the same');
  if (tree.exists(`${LIBS_DIR}/${to}`)) throw new Error(`${LIBS_DIR}/${to} exists already`);
  for (const lib of libs) {
    const error = libPathError(`${to}${lib.slice(from.length)}`);
    if (error) throw new Error(`Move would break the lib convention: ${error}`);
  }

  for (const file of filesBelow(tree, `${LIBS_DIR}/${from}`)) {
    tree.write(`${LIBS_DIR}/${to}${file.slice(`${LIBS_DIR}/${from}`.length)}`, tree.read(file) as Buffer);
    tree.delete(file);
  }
  rewriteAliases(tree, from, to);
  // OpenAPI clients at or below `from`: entry in openapi-clients.json + their generated testing exports
  for (const [fromClient, toClient] of updateClientEntries(tree, from, to)) renameClientExports(tree, fromClient, toClient as string);
  updateRoutePaths(tree, from, to, options.appRoutesFile ?? APP_ROUTES_FILE);
  syncScopesWithLibs(tree, [scopeOf(from), scopeOf(to)]);

  const leftovers = mentionsOutsideSources(tree, aliasFor(from));
  if (leftovers.length) logger.warn(`Still mention ${aliasFor(from)} (outside apps/libs, not rewritten): ${leftovers.join(', ')}`);
  if (!options.skipFormat) await formatFiles(tree);
}

const isFeatPath = (path: string): boolean => path.split('/').length === 2 && path.split('/')[1].startsWith(FEAT_PREFIX);

/** Route `path`s follow a renamed domain (app routes) or feat (shell routes). */
function updateRoutePaths(tree: Tree, from: string, to: string, appRoutesFile: string): void {
  if (!from.includes('/') && !to.includes('/')) {
    updateFile(tree, appRoutesFile, (content) => renameRoutePath(content, aliasFor(`${to}/shell`), from, to, appRoutesFile));
    return;
  }
  if (!isFeatPath(from) || !isFeatPath(to)) return;
  const fromFeat = from.split('/')[1].slice(FEAT_PREFIX.length);
  const toScope = scopeOf(to);
  const toFeat = to.split('/')[1].slice(FEAT_PREFIX.length);
  const specifier = aliasFor(`${to}/feature`);
  if (scopeOf(from) === toScope) {
    const shellRoutes = findExportedRoutes(tree, `${toScope}/shell`);
    if (shellRoutes) {
      updateFile(tree, shellRoutes.file, (content) => renameRoutePath(content, specifier, fromFeat, toFeat, shellRoutes.file));
    }
    return;
  }
  // feat moved to another domain: its route moves from the old shell to the new one
  forEachSourceFile(tree, (file) =>
    updateFile(tree, file, (content) =>
      content.includes(specifier) ? removeRoutes(content, (candidate) => candidate === specifier, file).content : content,
    ),
  );
  const container = findExportedClass(tree, `${to}/feature`);
  if (container) registerFeatRoute(tree, toScope, toFeat, container);
}

/** First exported class of a lib (the feat container `FeatX` of a feature lib). */
function findExportedClass(tree: Tree, libPath: string): string | undefined {
  for (const file of filesBelow(tree, `${LIBS_DIR}/${libPath}/src`)) {
    const match = /export class (\w+)/.exec(tree.read(file, 'utf-8') ?? '');
    if (match) return match[1];
  }
  return undefined;
}

export default moveGenerator;
