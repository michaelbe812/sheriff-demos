/**
 * Blueprint model for the ArchUnitTS spike (REDUCED blueprint, no ports).
 *
 * ArchUnitTS knows no Nx tags — it sees files and folders only. So the "tags" are derived from the
 * path here (the same derivation as `expectedTags` in verify-boundaries.mjs), and the depConstraints
 * of eslint.config.mjs are ported 1:1 as data. architecture.spec.ts turns every constraint into an
 * ArchUnitTS rule `files of the source libs shouldNot dependOn files of the forbidden libs`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const WORKSPACE_ROOT = join(import.meta.dirname, '../..');
/** Must live in the workspace root: ArchUnitTS labels files relative to the tsconfig dir (issue #109). */
export const TSCONFIG = join(WORKSPACE_ROOT, 'tsconfig.archunit.json');

export interface Lib {
  /** workspace-relative folder, e.g. `libs/booking/feat-check-booking/data` */
  root: string;
  /** derived from the path; undefined = unknown folder shape (Nx: "untagged lib") */
  tags?: string[];
}

export interface Constraint {
  sourceTag: string;
  onlyDependOnLibsWithTags?: string[];
  bannedExternalImports?: string[];
}

export const LAYERS = ['types', 'utils', 'data', 'ui', 'shell', 'feature', 'testing'];
/** generated client part → layer: services + core are data (HTTP), models types */
export const CLIENT_PARTS: Record<string, string> = { types: 'types', api: 'data', core: 'data', testing: 'testing' };

/** File kind (`<name>.<kind>.ts`) → layer folders it may live in (FILE_KINDS of tooling-conventions). */
export const FILE_KINDS: Record<string, string[]> = {
  model: ['types'],
  dto: ['types'],
  utils: ['utils'],
  events: ['data'],
  mapper: ['data'],
  store: ['data', 'ui', 'feature'],
  routes: ['shell'],
  providers: ['shell'],
  shell: ['shell'],
  fixture: ['testing'],
  handlers: ['testing'],
};

/** Tags from the path below libs/ — mirrors `expectedTags` of verify-boundaries.mjs. */
export function tagsOfLibPath(libPath: string): string[] | undefined {
  const segments = libPath.split('/');
  const generatedAt = segments.indexOf('generated');
  if (generatedAt !== -1) {
    const validShape = (generatedAt === 0 && segments.length === 3) || (generatedAt === 1 && segments.length === 4);
    const type = CLIENT_PARTS[segments.at(-1) ?? ''];
    if (!validShape || !type) return undefined;
    return [`scope:${generatedAt === 0 ? 'shared' : segments[0]}`, `type:${type}`, 'feat:none', 'generated'];
  }
  const [scope, ...rest] = segments;
  const layer = rest.at(-1) ?? '';
  const featFolder = rest.find((segment) => segment.startsWith('feat-'));
  const validShape = rest.length === 1 || (rest.length === 2 && rest[0] === featFolder);
  if (!scope || !validShape || !LAYERS.includes(layer)) return undefined;
  const tags = [
    `scope:${scope}`,
    `type:${['shell', 'feature'].includes(layer) ? 'feature' : layer}`,
    featFolder ? `feat:${featFolder.slice('feat-'.length)}` : 'feat:none',
  ];
  if (layer === 'shell') tags.push('entry');
  return tags;
}

const isDir = (path: string) => statSync(path).isDirectory();
const subDirs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir).filter((name) => isDir(join(dir, name)) && !['node_modules', 'src', 'dist'].includes(name))
    : [];

/** Every folder below libs/ with src/index.ts is a lib (same as isLibRoot in verify-boundaries.mjs). */
function libRoots(dir = 'libs'): string[] {
  const abs = join(WORKSPACE_ROOT, dir);
  const own = existsSync(join(abs, 'src/index.ts')) ? [dir] : [];
  return [...own, ...subDirs(abs).flatMap((name) => libRoots(`${dir}/${name}`))];
}

export function discoverLibs(): Lib[] {
  const libs: Lib[] = libRoots().map((root) => ({ root, tags: tagsOfLibPath(root.slice('libs/'.length)) }));
  const apps = subDirs(join(WORKSPACE_ROOT, 'apps')).map((name) => ({ root: `apps/${name}`, tags: ['type:app'] }));
  const tooling = subDirs(join(WORKSPACE_ROOT, 'packages/tooling')).map((name) => ({
    root: `packages/tooling/${name}`,
    tags: ['type:tooling', `tooling:${name}`],
  }));
  return [...libs, ...apps, ...tooling];
}

// ---------------------------------------------------------------------------------------------
// depConstraints — ported from eslint.config.mjs (same names, same content)
// ---------------------------------------------------------------------------------------------

const productionLayers = ['type:types', 'type:utils', 'type:data', 'type:ui', 'type:feature'];

const layerConstraints: Constraint[] = [
  { sourceTag: 'type:types', onlyDependOnLibsWithTags: ['type:types'], bannedExternalImports: ['*'] },
  { sourceTag: 'type:utils', onlyDependOnLibsWithTags: ['type:types', 'type:utils'] },
  { sourceTag: 'type:data', onlyDependOnLibsWithTags: ['type:types', 'type:utils', 'type:data'] },
  { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:types', 'type:utils', 'type:ui'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: productionLayers },
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['entry', 'scope:shared'] },
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: productionLayers },
  { sourceTag: 'type:testing', onlyDependOnLibsWithTags: ['type:types', 'type:testing', 'scope:shared'] },
];

const testOnlyPackages = [
  'msw', 'msw/*', 'vitest', 'vitest/*', '@vitest/*', '@testing-library/*', 'playwright', 'playwright/*',
  'openapi-msw', '@faker-js/*',
];
const noTestPackagesInProduction: Constraint[] = [...productionLayers, 'type:app'].map((sourceTag) => ({
  sourceTag,
  bannedExternalImports: testOnlyPackages,
}));

const httpOnlyInData: Constraint[] = ['type:utils', 'type:ui', 'type:feature'].map((sourceTag) => ({
  sourceTag,
  bannedExternalImports: ['@angular/common/http'],
}));

const tagsWithPrefix = (tags: string[], prefix: string, ...excluded: string[]) =>
  [...new Set(tags)].filter((tag) => tag.startsWith(prefix) && !excluded.includes(tag)).sort();

function sameTagConstraints(tags: string[]): Constraint[] {
  const slices = tagsWithPrefix(tags, 'scope:', 'scope:shared');
  const feats = tagsWithPrefix(tags, 'feat:', 'feat:none');
  return [
    { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
    ...slices.map((scope) => ({ sourceTag: scope, onlyDependOnLibsWithTags: [scope, 'scope:shared'] })),
    ...feats.map((feat) => ({ sourceTag: feat, onlyDependOnLibsWithTags: [feat, 'feat:none'] })),
  ];
}

const toolingConstraints: Constraint[] = [
  { sourceTag: 'tooling:conventions', onlyDependOnLibsWithTags: [] },
  { sourceTag: 'tooling:openapi', onlyDependOnLibsWithTags: ['tooling:conventions'] },
  { sourceTag: 'tooling:workspace', onlyDependOnLibsWithTags: ['tooling:conventions', 'tooling:openapi'] },
  { sourceTag: 'tooling:ng-lib', onlyDependOnLibsWithTags: [] },
  { sourceTag: 'tooling:verify', onlyDependOnLibsWithTags: [] },
  { sourceTag: 'tooling:eslint-rules', onlyDependOnLibsWithTags: ['tooling:conventions'] },
];

export function blueprintDepConstraints(libs: Lib[]): Constraint[] {
  return [
    ...layerConstraints,
    ...httpOnlyInData,
    ...noTestPackagesInProduction,
    ...sameTagConstraints(libs.flatMap((lib) => lib.tags ?? [])),
    { sourceTag: 'type:tooling', onlyDependOnLibsWithTags: ['type:tooling'] },
    ...toolingConstraints,
  ];
}

/** Spec override of eslint.config.mjs: + type:testing, except for the listed source tags. */
const keepsItsTargetsInSpecs = ['type:types', 'type:testing', 'type:tooling'];
export function specDepConstraints(libs: Lib[]): Constraint[] {
  return blueprintDepConstraints(libs)
    .filter((constraint) => constraint.bannedExternalImports !== testOnlyPackages)
    .map((constraint) =>
      constraint.onlyDependOnLibsWithTags &&
      !keepsItsTargetsInSpecs.includes(constraint.sourceTag) &&
      !constraint.sourceTag.startsWith('scope:') &&
      !constraint.sourceTag.startsWith('feat:') &&
      !constraint.sourceTag.startsWith('tooling:')
        ? { ...constraint, onlyDependOnLibsWithTags: [...constraint.onlyDependOnLibsWithTags, 'type:testing'] }
        : constraint,
    );
}

/** Spec files (eslint.config.mjs `specFiles`). */
export const SPEC_FILE_NAMES = ['*.spec.ts', '*.test.ts', 'test-setup.ts'];

/** Public entry files per alias (tsconfig.base.json paths) — the only files importable from outside a lib. */
export function publicEntries(): { alias: string; file: string }[] {
  const { paths } = JSON.parse(readFileSync(join(WORKSPACE_ROOT, 'tsconfig.base.json'), 'utf-8')).compilerOptions;
  return Object.entries(paths as Record<string, string[]>).flatMap(([alias, targets]) =>
    targets.map((target) => ({ alias, file: target.replace(/^\.\//, '') })),
  );
}

/** Lib aliases (target below libs/) — deep imports below them are banned. */
export const libAliases = () =>
  publicEntries()
    .filter(({ file }) => file.startsWith('libs/'))
    .map(({ alias }) => alias);
