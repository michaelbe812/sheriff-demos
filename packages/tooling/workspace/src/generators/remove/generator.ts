import { formatFiles, logger, type Tree } from '@nx/devkit';
import { aliasFor, LIBS_DIR, projectNameFor } from '@blueprint/tooling-conventions';
import { updateClientEntries } from '@blueprint/tooling-openapi/clients';
import { referencesAlias } from '../shared/imports';
import { removeRoutes } from '../shared/routes';
import {
  filesBelow,
  forEachSourceFile,
  libsAt,
  mentionsOutsideSources,
  normalizeLibsPath,
  removeLibPaths,
  scopeOf,
  syncScopesWithLibs,
  updateImplicitDependencies,
} from '../shared/workspace';

export interface RemoveGeneratorSchema {
  /** lib, feat or domain below libs/ */
  path: string;
  /** delete even if other code still imports it */
  force?: boolean;
  skipFormat?: boolean;
}

/**
 * Deletes a lib, feat, domain or OpenAPI client (all files incl. config); takes its lazy routes, paths
 * entries, implicitDependencies on it, (for a domain) its scope and its client entries out.
 */
export async function removeGenerator(tree: Tree, options: RemoveGeneratorSchema): Promise<void> {
  const path = normalizeLibsPath(options.path);
  const libs = libsAt(tree, path);
  if (libs.length === 0) throw new Error(`Nothing to remove: no lib at or below ${LIBS_DIR}/${path}`);
  const ownDir = `${LIBS_DIR}/${path}/`;
  const alias = aliasFor(path);
  const pointsHere = (specifier: string): boolean => specifier === alias || specifier.startsWith(`${alias}/`);

  // lazy routes to it are not imports that block the removal — they go with it
  const withoutRoutes = new Map<string, string>();
  forEachSourceFile(tree, (file, content) => {
    if (!file.startsWith(ownDir) && content.includes(alias))
      withoutRoutes.set(file, removeRoutes(content, pointsHere, file).content);
  });
  const references = [...withoutRoutes].filter(([, content]) => referencesAlias(content, path)).map(([file]) => file);
  if (references.length && !options.force) {
    throw new Error(
      `${alias} is still imported by:\n  ${references.join('\n  ')}\nRemove these imports first or pass --force.`,
    );
  }
  if (references.length) logger.warn(`--force: these files keep broken imports of ${alias}: ${references.join(', ')}`);

  for (const [file, content] of withoutRoutes) tree.write(file, content);
  for (const file of filesBelow(tree, `${LIBS_DIR}/${path}`)) tree.delete(file);
  removeLibPaths(tree, libs);
  // an OpenAPI client at or below `path` leaves openapi-clients.json, too
  const removedClients = updateClientEntries(tree, path).map(([client]) => client);
  updateImplicitDependencies(
    tree,
    new Map([...libs, ...removedClients].map((removed) => [projectNameFor(removed), undefined])),
  );
  syncScopesWithLibs(tree, [scopeOf(path)]);

  const leftovers = mentionsOutsideSources(tree, alias);
  if (leftovers.length) logger.warn(`Still mention ${alias} (outside apps/libs): ${leftovers.join(', ')}`);
  if (!options.skipFormat) await formatFiles(tree);
}

export default removeGenerator;
