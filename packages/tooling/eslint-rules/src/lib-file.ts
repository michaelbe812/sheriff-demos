/**
 * Where a linted file sits in the blueprint: lib (scope/layer/feat from @blueprint/tooling-conventions —
 * the same parser the crystal plugin derives the tags with) and its name parts below `src/`.
 */
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { GENERATED_FOLDER, LIBS_DIR, type LibPath, parseLibPath } from '@blueprint/tooling-conventions';

export interface LibFile {
  /** path below libs/, e.g. `booking/feat-check-booking/data` */
  libPath: string;
  lib: LibPath;
  /** folders between `src/` and the file */
  folders: string[];
  fileName: string;
  /** file name without `.ts` and `.spec`, e.g. `booking-card.store` */
  base: string;
  /** part before the first dot, e.g. `booking-card` */
  name: string;
  /** part after the first dot, e.g. `store`; undefined for a plain file */
  kind?: string;
  spec: boolean;
  /** `src/index.ts` — the public API */
  publicApi: boolean;
}

/** Settings key: `settings: { blueprint: { workspaceRoot } }` (tests); default: the dir holding nx.json. */
export interface BlueprintSettings {
  blueprint?: { workspaceRoot?: string };
}

const rootCache = new Map<string, string | undefined>();

function findWorkspaceRoot(dir: string): string | undefined {
  if (rootCache.has(dir)) return rootCache.get(dir);
  const parent = dirname(dir);
  const root = existsSync(join(dir, 'nx.json')) ? dir : parent === dir ? undefined : findWorkspaceRoot(parent);
  rootCache.set(dir, root);
  return root;
}

/**
 * The lib file behind an ESLint filename, or undefined when the rules do not apply: outside a lib's
 * `src/`, a path the plugin rejects anyway (graph error), a generated client lib or `src/generated/**`.
 */
export function parseLibFile(filename: string, settings: BlueprintSettings = {}): LibFile | undefined {
  const workspaceRoot = settings.blueprint?.workspaceRoot ?? findWorkspaceRoot(dirname(filename));
  if (!workspaceRoot) return undefined;
  const segments = relative(workspaceRoot, filename).split(sep);
  const srcIndex = segments.indexOf('src');
  if (segments[0] !== LIBS_DIR || srcIndex < 2) return undefined;
  const libPath = segments.slice(1, srcIndex).join('/');
  const lib = parseLibPath(libPath);
  const folders = segments.slice(srcIndex + 1, -1);
  if (!lib || lib.client || folders[0] === GENERATED_FOLDER) return undefined;
  const fileName = segments.at(-1) as string;
  const withoutTs = fileName.replace(/\.[cm]?tsx?$/, '');
  const spec = /\.(spec|test)$/.test(withoutTs);
  const base = withoutTs.replace(/\.(spec|test)$/, '');
  const [name, ...kindParts] = base.split('.');
  return {
    libPath,
    lib,
    folders,
    fileName,
    base,
    name,
    kind: kindParts.length ? kindParts.join('.') : undefined,
    spec,
    publicApi: folders.length === 0 && fileName === 'index.ts',
  };
}

/** `booking-card.store` → `BookingCardStore` (same result as `names().className` of @nx/devkit). */
export const pascalCase = (value: string): string =>
  value
    .split(/[-._]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');

/** `car-rental` → `carRental` */
export const camelCase = (value: string): string => {
  const pascal = pascalCase(value);
  return pascal[0].toLowerCase() + pascal.slice(1);
};
