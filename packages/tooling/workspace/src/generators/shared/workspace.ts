import type { Tree } from '@nx/devkit';
import { GENERATED_FOLDER, LIBS_DIR, parseLibPath, SHARED_SCOPE } from '@blueprint/tooling-conventions';
import { addScope, listLibPaths, readScopes, removeScope } from '@blueprint/tooling-conventions/tree';

export {
  addScope,
  assertKebabCase,
  assertSliceExists,
  forEachSourceFile,
  libExists,
  listLibPaths,
  readScopes,
  removeScope,
} from '@blueprint/tooling-conventions/tree';

/** Default app shell routes (lazy domain routes are registered here). */
export const APP_ROUTES_FILE = 'apps/client/src/app/app.routes.ts';

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
  const content = tree.exists(indexFile) ? (tree.read(indexFile, 'utf-8') ?? '') : '';
  if (content.includes(line)) return;
  // a fresh lib may carry the placeholder `export {};`
  const kept = content.replace(/^export \{\};\s*$/m, '').trimEnd();
  tree.write(indexFile, `${kept ? `${kept}\n` : ''}${line}\n`);
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

/** Scope of a path below libs/ — `generated/…` (shared OpenAPI clients) belongs to `shared`, it is no scope. */
export const scopeOf = (libPath: string): string => {
  const first = libPath.split('/')[0];
  return first === GENERATED_FOLDER ? SHARED_SCOPE : first;
};

export function assertValidLibPath(libPath: string): void {
  if (!parseLibPath(libPath)) {
    throw new Error(
      `${LIBS_DIR}/${libPath}: not a blueprint lib path (libs/<scope>/<layer> or libs/<scope>/feat-<feat>/<layer>).`,
    );
  }
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
