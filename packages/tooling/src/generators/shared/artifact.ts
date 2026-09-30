/**
 * Thin wrappers for Angular artifacts inside a lib. `@nx/angular:component` & co. cannot be used:
 * they look up the project in the Tree (project.json), and libs here have none — the plugin infers
 * them (tested: "does not exist under any project root" / 'project' is not found).
 */
import { formatFiles, names, type Tree } from '@nx/devkit';
import { LIBS_DIR, parseLibPath } from '../../plugin/lib-conventions';
import { addExport, assertKebabCase, libExists, normalizeLibsPath, writeIfMissing } from './workspace';

export interface ArtifactSchema {
  /** `libs/<lib>/src/<optional dirs>/<name>` (or without `libs/` / `src/`) */
  path: string;
  /** re-export from the lib's index.ts */
  export?: boolean;
  skipFormat?: boolean;
}

export interface ArtifactTarget {
  libPath: string;
  /** file path below src/ without extension, e.g. `badges/booking-badge` */
  relative: string;
  /** kebab-case name (last segment) */
  name: string;
  className: string;
}

export function resolveArtifact(tree: Tree, path: string, kind: string, allowedLayers: string[]): ArtifactTarget {
  const normalized = normalizeLibsPath(path);
  const [libPart, below] = normalized.includes('/src/')
    ? normalized.split('/src/')
    : [normalized.split('/').slice(0, -1).join('/'), normalized.split('/').at(-1) as string];
  const lib = parseLibPath(libPart);
  if (!lib || !libExists(tree, libPart)) {
    throw new Error(`${LIBS_DIR}/${libPart} is no lib — path must look like libs/<scope>/<layer>/src/<name>`);
  }
  if (lib.client) {
    throw new Error(
      `${LIBS_DIR}/${libPart} is generated from ${lib.client.path}'s spec — wrap it in a port instead of adding a ${kind}.`,
    );
  }
  if (!allowedLayers.includes(lib.layer)) {
    throw new Error(
      `A ${kind} belongs into a ${allowedLayers.join('/')} lib, not into "${lib.layer}" (${LIBS_DIR}/${libPart}).`,
    );
  }
  const name = below.split('/').at(-1) as string;
  assertKebabCase(name, `${kind} name`);
  return { libPath: libPart, relative: below, name, className: names(name).className };
}

export async function writeArtifact(
  tree: Tree,
  target: ArtifactTarget,
  file: string,
  content: string,
  options: ArtifactSchema,
): Promise<void> {
  const created = writeIfMissing(tree, `${LIBS_DIR}/${target.libPath}/src/${file}`, content);
  if (!created) throw new Error(`${LIBS_DIR}/${target.libPath}/src/${file} exists already`);
  if (options.export !== false) addExport(tree, target.libPath, file);
  if (!options.skipFormat) await formatFiles(tree);
}
