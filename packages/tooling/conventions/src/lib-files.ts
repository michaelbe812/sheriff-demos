/**
 * Config files of a blueprint lib — every lib carries them explicitly (no crystal plugin infers anything):
 *
 *   project.json            name, tags (derived from the path), targets (bodies from nx.json targetDefaults)
 *   tsconfig.json           IDE + `typecheck` (`tsc -p`)
 *   package.json            buildable libs: name = import alias (ng-packagr + Nx' dist remap of the app build)
 *   ng-package.json         buildable libs: dest dist/<root>, entry src/index.ts
 *   tsconfig.lib.json       buildable libs: build (no specs)
 *   tsconfig.lib.prod.json  buildable libs: production build (no declaration maps)
 *   tsconfig.spec.json      libs with specs: `test`
 *
 * Testing libs (`type:testing`) are never built: only project.json + tsconfig(.spec).json.
 * Pure (no @nx/devkit): the generators write these files through tree.ts, verify checks the same shape.
 */
import { aliasFor, type BlueprintLibsOptions, deriveTags, LIBS_DIR, projectNameFor } from './lib-conventions';

export type JsonObject = Record<string, unknown>;

/** Every config file a lib may carry (outside src/). */
export const LIB_CONFIG_FILES = [
  'project.json',
  'package.json',
  'ng-package.json',
  'tsconfig.json',
  'tsconfig.lib.json',
  'tsconfig.lib.prod.json',
  'tsconfig.spec.json',
];
/** Only buildable libs have them. */
export const BUILD_CONFIG_FILES = ['package.json', 'ng-package.json', 'tsconfig.lib.json', 'tsconfig.lib.prod.json'];

export interface LibConfigOptions extends BlueprintLibsOptions {
  /** the lib has specs: tsconfig.spec.json + `test` target */
  hasSpecs?: boolean;
  /** npm packages the production code imports (package.json → peerDependencies) */
  peerDependencies?: Record<string, string>;
  /** project.json implicitDependencies (generated client parts: → client, → sibling parts) */
  implicitDependencies?: string[];
  /** extra or overriding targets (generated client testing part: its own `generate`, dependsOn) */
  targets?: Record<string, JsonObject>;
}

/** `libs/booking/state` → `../../../` (from the lib folder to the workspace root). */
export const offsetFromRoot = (dir: string): string => '../'.repeat(dir.split('/').filter(Boolean).length);

/** A lib is buildable unless it is a testing lib. */
export const isBuildable = (tags: string[]): boolean => !tags.includes('type:testing');

/** tsconfig.base.json `paths` entry of a lib: exact alias → its src/index.ts. */
export const libPathsEntry = (libPath: string): [string, string[]] => [
  aliasFor(libPath),
  [`./${LIBS_DIR}/${libPath}/src/index.ts`],
];

/** All config files of a lib (file name → JSON), see header. Throws for a path outside the convention. */
export function libConfigFiles(libPath: string, options: LibConfigOptions = {}): Record<string, JsonObject> {
  const root = `${LIBS_DIR}/${libPath}`;
  const offset = offsetFromRoot(root);
  const tags = deriveTags(libPath, options);
  const buildable = isBuildable(tags);
  const files: Record<string, JsonObject> = {
    'project.json': {
      name: projectNameFor(libPath),
      $schema: `${offset}node_modules/nx/schemas/project-schema.json`,
      projectType: 'library',
      sourceRoot: `${root}/src`,
      tags,
      ...(options.implicitDependencies?.length ? { implicitDependencies: options.implicitDependencies } : {}),
      // bodies: nx.json → targetDefaults (build, lint, typecheck, test)
      targets: {
        ...(buildable ? { build: {} } : {}),
        lint: {},
        typecheck: {},
        ...(options.hasSpecs ? { test: {} } : {}),
        ...options.targets,
      },
    },
    'tsconfig.json': {
      extends: `${offset}tsconfig.base.json`,
      compilerOptions: { strict: true, target: 'es2022', module: 'preserve', noEmit: true },
      include: ['src/**/*.ts'],
    },
  };
  if (buildable) {
    files['package.json'] = {
      name: aliasFor(libPath),
      version: '0.0.1',
      private: true,
      ...(options.peerDependencies && Object.keys(options.peerDependencies).length
        ? { peerDependencies: sortKeys(options.peerDependencies) }
        : {}),
      sideEffects: false,
    };
    files['ng-package.json'] = {
      $schema: `${offset}node_modules/ng-packagr/ng-package.schema.json`,
      dest: `${offset}dist/${root}`,
      lib: { entryFile: 'src/index.ts' },
    };
    files['tsconfig.lib.json'] = {
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        outDir: `${offset}dist/out-tsc`,
        declaration: true,
        declarationMap: true,
        inlineSources: true,
        types: [],
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    };
    files['tsconfig.lib.prod.json'] = {
      extends: './tsconfig.lib.json',
      compilerOptions: { declarationMap: false },
    };
  }
  if (options.hasSpecs) {
    files['tsconfig.spec.json'] = {
      extends: './tsconfig.json',
      compilerOptions: { outDir: `${offset}dist/out-tsc/spec`, noEmit: false },
      include: ['src/**/*.spec.ts', 'src/**/*.d.ts'],
    };
  }
  return files;
}

/** What moved (paths below libs/): a lib, a feat, a client or a whole slice. */
export interface Moved {
  from: string;
  to: string;
}

/**
 * Path-dependent fields of the config files after a lib moved from `from` to `to` (paths below libs/):
 * relative offsets, dist folder, name, alias, sourceRoot, tags, and every string naming the moved path
 * (`moved`, default the lib itself — a whole slice moves the client paths of its generated clients, too).
 * Everything else a lib added by hand (extra targets, compiler options, peerDependencies) is kept.
 */
export function relocateConfig(
  file: string,
  json: JsonObject,
  from: string,
  to: string,
  options: BlueprintLibsOptions = {},
  moved: Moved = { from, to },
): JsonObject {
  const offset = offsetFromRoot(`${LIBS_DIR}/${to}`);
  const replaced = replacePaths(json, moved.from, moved.to) as JsonObject;
  switch (file) {
    case 'project.json':
      return {
        ...replaced,
        name: projectNameFor(to),
        $schema: `${offset}node_modules/nx/schemas/project-schema.json`,
        sourceRoot: `${LIBS_DIR}/${to}/src`,
        tags: deriveTags(to, options),
      };
    case 'package.json':
      return { ...replaced, name: aliasFor(to) };
    case 'ng-package.json':
      return {
        ...replaced,
        $schema: `${offset}node_modules/ng-packagr/ng-package.schema.json`,
        dest: `${offset}dist/${LIBS_DIR}/${to}`,
      };
    case 'tsconfig.json':
      return { ...replaced, extends: `${offset}tsconfig.base.json` };
    case 'tsconfig.lib.json':
      return withCompilerOption(replaced, 'outDir', `${offset}dist/out-tsc`);
    case 'tsconfig.spec.json':
      return withCompilerOption(replaced, 'outDir', `${offset}dist/out-tsc/spec`);
    default:
      return replaced;
  }
}

/**
 * Every string that names the moved path: `libs/<from>…` (inputs, outputs), `<from>…` (the `client`
 * option of the OpenAPI targets) and `clients.<from>…` (json input fields of openapi-clients.json).
 */
export function replacePaths(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') {
    const below = (text: string, prefix: string): boolean =>
      text === `${prefix}${from}` || text.startsWith(`${prefix}${from}/`);
    const inLibs = value.replace(
      new RegExp(`(^|/)${LIBS_DIR}/${escapeRegExp(from)}(?=$|/)`, 'g'),
      `$1${LIBS_DIR}/${to}`,
    );
    if (below(inLibs, '')) return `${to}${inLibs.slice(from.length)}`;
    if (below(inLibs, 'clients.')) return `clients.${to}${inLibs.slice(`clients.${from}`.length)}`;
    return inLibs;
  }
  if (Array.isArray(value)) return value.map((item) => replacePaths(item, from, to));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePaths(item, from, to)]));
  }
  return value;
}

function withCompilerOption(json: JsonObject, key: string, value: unknown): JsonObject {
  const compilerOptions = (json['compilerOptions'] ?? {}) as JsonObject;
  return { ...json, compilerOptions: { ...compilerOptions, [key]: value } };
}

export const sortKeys = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
