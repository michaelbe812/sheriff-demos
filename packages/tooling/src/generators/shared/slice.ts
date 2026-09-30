import { logger, type Tree } from '@nx/devkit';
import { aliasFor, LIBS_DIR } from '../../plugin/lib-conventions';
import { findExportedRoutes, findLazyRoutes, insertRoute, lazyRouteSource, updateFile } from './routes';
import { type LibFiles, SLICE_LAYER_REQUIRES, SLICE_LAYER_TEMPLATES, type SliceNames } from './slice-templates';
import { testingFiles } from './testing-templates';
import { addExport, APP_ROUTES_FILE, libExists, writeIfMissing } from './workspace';

/** Writes a new lib (sources + index.ts). An existing lib is left untouched (idempotent). */
export function writeLib(tree: Tree, libPath: string, lib: LibFiles): boolean {
  if (libExists(tree, libPath)) {
    logger.info(`${LIBS_DIR}/${libPath} exists — skipped`);
    return false;
  }
  for (const [file, content] of Object.entries(lib.files)) writeIfMissing(tree, `${LIBS_DIR}/${libPath}/src/${file}`, content);
  if (lib.exports.length === 0) tree.write(`${LIBS_DIR}/${libPath}/src/index.ts`, 'export {};\n');
  for (const file of lib.exports) addExport(tree, libPath, file);
  return true;
}

export function assertLayerDependencies(tree: Tree, scope: string, layer: string, alsoGenerated: string[] = []): void {
  const missing = (SLICE_LAYER_REQUIRES[layer] ?? []).filter(
    (required) => !alsoGenerated.includes(required) && !libExists(tree, `${scope}/${required}`),
  );
  if (missing.length) {
    throw new Error(
      `${LIBS_DIR}/${scope}/${layer} needs ${missing.map((m) => `${LIBS_DIR}/${scope}/${m}`).join(', ')} (its example imports them). Generate them first or together.`,
    );
  }
}

/** One slice-root lib (`libs/<scope>/<layer>`) with example sources. */
export function generateSliceLayer(tree: Tree, n: SliceNames, layer: string): boolean {
  if (layer === 'testing') return generateTestingLib(tree, n);
  const template = SLICE_LAYER_TEMPLATES[layer];
  if (!template) throw new Error(`No template for layer "${layer}"`);
  return writeLib(tree, `${n.scope}/${layer}`, template(n));
}

export function generateTestingLib(tree: Tree, n: SliceNames): boolean {
  return writeLib(tree, `${n.scope}/testing`, testingFiles(n, typesExportEntity(tree, n)));
}

/** true if libs/<scope>/types declares `export interface <Entity>` (then fixtures use it). */
function typesExportEntity(tree: Tree, n: SliceNames): boolean {
  const srcDir = `${LIBS_DIR}/${n.scope}/types/src`;
  if (!tree.exists(srcDir)) return false;
  const declaration = new RegExp(`export (interface|type) ${n.entity}\\b`);
  return tree
    .children(srcDir)
    .filter((file) => file.endsWith('.ts'))
    .some((file) => declaration.test(tree.read(`${srcDir}/${file}`, 'utf-8') ?? ''));
}

/** Registers `libs/<scope>/shell` lazily in the app routes (path = scope). No-op if already there. */
export function registerSliceRoute(tree: Tree, scope: string, appRoutesFile = APP_ROUTES_FILE): boolean {
  const shellPath = `${scope}/shell`;
  const routes = findExportedRoutes(tree, shellPath);
  if (!routes) {
    logger.warn(`${LIBS_DIR}/${shellPath} exports no Routes — not registered in ${appRoutesFile}`);
    return false;
  }
  const specifier = aliasFor(shellPath);
  return updateFile(tree, appRoutesFile, (content) =>
    findLazyRoutes(content, appRoutesFile).some((route) => route.specifier === specifier)
      ? content
      : insertRoute(content, lazyRouteSource({ path: scope, specifier, exportName: routes.name, kind: 'children' }), appRoutesFile),
  );
}
