/**
 * Folder convention of the blueprint libs — the single source of truth for the generators
 * (they write project.json tags, tsconfig paths, config files) and the sync generator.
 * No runtime imports (pure path logic, also used by lib-files.ts).
 *
 *   libs/<scope>/<layer>                  scope:<scope> type:<layer> feat:none
 *   libs/<scope>/feat-<feat>/<layer>      scope:<scope> type:<layer> feat:<feat>
 *
 * Reduced blueprint: layers types, utils, data-access, state, ui, feature (+ testing); no port markers. A slice is
 * closed towards every other slice — shared code lives in `shared`, the app composes slices via their shell (`entry`).
 * data-access = HTTP (the only layer with @angular/common/http), state = signal stores + domain events on top of it.
 *
 * Generated OpenAPI clients (`generated` is a reserved folder, never a scope or layer):
 *   libs/generated/<client>/<part>          scope:shared   ┐ type:types | type:data-access (api, core) | type:testing,
 *   libs/<domain>/generated/<client>/<part> scope:<domain> ┘ feat:none, marker `generated` (never entry)
 *   The client folder itself holds the committed spec (openapi.yaml|json); its options live in
 *   openapi-clients.json (workspace root), see packages/tooling/openapi.
 */

/** Package of the workspace generators (domain, layer, feat, …) — named in hints. */
export const WORKSPACE_PACKAGE = '@blueprint/tooling-workspace';
/**
 * Scope list (workspace root): allowed `libs/<scope>` folders, `{ "scopes": [...] }`. Folder typo guard,
 * checked by tooling-verify:verify, maintained by the generators. Own file instead of nx.json: an nx.json
 * change invalidates the whole cache.
 */
export const SCOPES_FILE = 'lib-scopes.json';

export const LIBS_DIR = 'libs';
export const ALIAS_PREFIX = '@blueprint/';
export const FEAT_PREFIX = 'feat-';
export const SHARED_SCOPE = 'shared';

/** Layer folders that are a `type:feature` lib (slice root shell + feat container). */
export const FEATURE_LAYERS = ['shell', 'feature'];
/** Test-only libs (MSW handlers, fixtures): never built, never shipped. */
export const TESTING_LAYER = 'testing';
/** Every layer folder the depConstraints know. Anything else would get an unconstrained `type:` tag. */
export const KNOWN_LAYERS = ['types', 'utils', 'data-access', 'state', 'ui', ...FEATURE_LAYERS, TESTING_LAYER];
/** Layers of a slice root (`libs/<scope>/<layer>`): `feature` only exists inside a feat. */
export const SLICE_LAYERS = KNOWN_LAYERS.filter((layer) => layer !== 'feature');
/**
 * Layers inside a feat (`libs/<scope>/feat-<feat>/<layer>`): no shell, no testing. Generic on purpose: a feat may
 * own a data-access lib (feat-only endpoints), the feat generator only offers state + ui.
 */
export const FEAT_LAYERS = KNOWN_LAYERS.filter((layer) => layer !== 'shell' && layer !== TESTING_LAYER);

/** Reserved folder of generated OpenAPI clients: `libs/generated/<client>`, `libs/<domain>/generated/<client>`. */
export const GENERATED_FOLDER = 'generated';
/** Marker tag of every generated client lib (and the client project). */
export const GENERATED_TAG = 'generated';
/** Client options, one entry per client (key = client path below libs/). Read by the OpenAPI executors. */
export const CLIENTS_CONFIG_FILE = 'openapi-clients.json';
/** Committed spec in the client folder — exactly one of them. */
export const CLIENT_SPEC_FILES = ['openapi.yaml', 'openapi.json'];
/**
 * Parts of a client = libs below its folder, part → layer. `api` and `core` are `data-access` (HTTP is the
 * data-access layer's job), not `utils`: the generated runtime (Configuration, encoder, client) imports
 * @angular/common/http. The folder names stay `api`/`core` — `api` is no layer.
 * `testing`: MSW handlers, faker factories and the typed `<client>Http` — generated from the spec only.
 */
export const CLIENT_PARTS: Record<string, string> = {
  types: 'types',
  api: 'data-access',
  core: 'data-access',
  testing: TESTING_LAYER,
};
/** Parts written by the code generator adapter (the facade); `testing` has its own generate target. */
export const CLIENT_CODE_PARTS = ['types', 'api', 'core'];

/** kebab-case: scope, feat, client, folder and file names (`check-booking`). */
export const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * File names inside a lib (below `src/`, checked by the ESLint rule `blueprint/lib-file-naming`):
 *   `<name>.ts`           plain file: component, service, class — named after its main symbol
 *   `<name>.<kind>.ts`    kind file, the kind belongs to the listed layers only
 *   `<name>[.<kind>].spec.ts`  spec of such a file
 * `<name>` is kebab-case. `src/index.ts` is the public API, `src/generated/**` is excluded.
 */
export const FILE_KINDS: Record<string, string[]> = {
  model: ['types'],
  dto: ['types'],
  utils: ['utils'],
  events: ['state'],
  mapper: ['state'],
  store: ['state', 'ui', 'feature'],
  routes: ['shell'],
  providers: ['shell'],
  shell: ['shell'],
  fixture: ['testing'],
  handlers: ['testing'],
};
/**
 * Layers of a slice whose files all carry a kind (`booking.model.ts`, no plain `booking.ts`).
 * Shared buckets are exempt: one helper per file, named after it (`shared/utils/src/format-date.ts`).
 */
export const KIND_ONLY_LAYERS = ['types', 'utils'];
/** Folder below `src/` a kind lives in (testing libs: `fixtures/booking.fixture.ts`, `handlers/booking.handlers.ts`). */
export const KIND_FOLDERS: Record<string, string> = { fixture: 'fixtures', handlers: 'handlers' };
/** Lib-private folder below `src/`: never exported from `index.ts`. */
export const INTERNAL_FOLDER = 'internal';
/** The only public API of a lib: `src/index.ts`. */
export const PUBLIC_API_FILE = 'index.ts';

/** Scope list (lib-scopes.json). */
export interface BlueprintLibsOptions {
  /** Allowed `libs/<scope>` folders. Unknown scope = error (folder typo guard). */
  scopes?: string[];
}

export interface LibPath {
  scope: string;
  /** feat name without `feat-`, undefined outside a feat */
  feat?: string;
  layer: string;
  /** generated client part: the client path below libs/ (e.g. `booking/generated/booking-client`) and its part */
  client?: { path: string; name: string; part: string };
}

export interface ClientPath {
  /** path below libs/, e.g. `generated/pet-client` or `booking/generated/booking-client` */
  path: string;
  name: string;
  /** `shared` for libs/generated/<client>, else the domain */
  scope: string;
  placement: 'shared' | { domain: string };
}

/** `generated/pet-client` or `<domain>/generated/<client>` → client; undefined for any other shape. */
export function parseClientPath(clientPath: string): ClientPath | undefined {
  const segments = clientPath.split('/');
  const shared = segments.length === 2 && segments[0] === GENERATED_FOLDER;
  const domain = segments.length === 3 && segments[1] === GENERATED_FOLDER && segments[0] !== GENERATED_FOLDER;
  const name = segments.at(-1) ?? '';
  if ((!shared && !domain) || !name || name === GENERATED_FOLDER) return undefined;
  return shared
    ? { path: clientPath, name, scope: SHARED_SCOPE, placement: 'shared' }
    : { path: clientPath, name, scope: segments[0], placement: { domain: segments[0] } };
}

/** `booking/feat-check-booking/state` → { scope, feat, layer }; undefined if the shape is wrong. */
export function parseLibPath(libPath: string): LibPath | undefined {
  if (libPath.split('/').includes(GENERATED_FOLDER)) return parseGeneratedLibPath(libPath);
  const [scope, ...rest] = libPath.split('/');
  const layer = rest.at(-1) ?? '';
  const featFolder = rest.find((segment) => segment.startsWith(FEAT_PREFIX));
  const validShape = rest.length === 1 || (rest.length === 2 && featFolder === rest[0]);
  if (!scope || !validShape || !KNOWN_LAYERS.includes(layer)) return undefined;
  return { scope, layer, feat: featFolder?.slice(FEAT_PREFIX.length) };
}

/** `generated/pet-client/api` → part `api` (layer data-access) of the shared client; undefined if the shape is wrong. */
function parseGeneratedLibPath(libPath: string): LibPath | undefined {
  const segments = libPath.split('/');
  const part = segments.pop() as string;
  const client = parseClientPath(segments.join('/'));
  if (!client || !(part in CLIENT_PARTS)) return undefined;
  return { scope: client.scope, layer: CLIENT_PARTS[part], client: { path: client.path, name: client.name, part } };
}

/** Why a lib path is not allowed, or undefined if it is (shape, layer, scope list). */
export function libPathError(libPath: string, options: BlueprintLibsOptions = {}): string | undefined {
  const parsed = parseLibPath(libPath);
  if (!parsed && libPath.split('/').includes(GENERATED_FOLDER)) {
    return `${LIBS_DIR}/${libPath}: not a generated client lib — expected ${LIBS_DIR}/${GENERATED_FOLDER}/<client>/<part> or ${LIBS_DIR}/<domain>/${GENERATED_FOLDER}/<client>/<part>, part one of ${Object.keys(CLIENT_PARTS).join(', ')} ("${GENERATED_FOLDER}" is reserved, no scope or layer)`;
  }
  if (!parsed) {
    return `${LIBS_DIR}/${libPath}: not a blueprint lib path — expected ${LIBS_DIR}/<scope>/<layer> or ${LIBS_DIR}/<scope>/feat-<feat>/<layer>, layer one of ${KNOWN_LAYERS.join(', ')}`;
  }
  const { scopes } = options;
  if (scopes && !scopes.includes(parsed.scope)) {
    const suggestion = closestScope(parsed.scope, scopes);
    return (
      `${LIBS_DIR}/${libPath}: unknown scope "${parsed.scope}"${suggestion ? ` (did you mean "${suggestion}"?)` : ''}. ` +
      `Allowed scopes (${SCOPES_FILE}): ${scopes.join(', ')}. ` +
      `New slice: nx g ${WORKSPACE_PACKAGE}:domain ${parsed.scope}`
    );
  }
  // folder names become project names, aliases and tags: a feat/client `CheckIn` or `check_in` would slip through
  const notKebab = [parsed.scope, parsed.feat, parsed.client?.name].find(
    (name) => name !== undefined && !KEBAB_CASE.test(name),
  );
  if (notKebab !== undefined) {
    return `${LIBS_DIR}/${libPath}: folder "${notKebab}" must be kebab-case (e.g. "check-booking")`;
  }
  return undefined;
}

/** Scope list of a parsed lib-scopes.json; undefined without list. */
export function scopesOfFile(content: unknown): string[] | undefined {
  const scopes = (content as BlueprintLibsOptions | undefined)?.scopes;
  return Array.isArray(scopes) ? scopes : undefined;
}

/** Tags of a lib, derived purely from its path below `libs/` (e.g. `booking/feat-check-booking/state`). */
export function deriveTags(libPath: string, options: BlueprintLibsOptions = {}): string[] {
  const error = libPathError(libPath, options);
  // fail instead of silently creating an unconstrained lib (the old tag-typo problem)
  if (error) throw new Error(error);
  const { scope, feat, layer, client } = parseLibPath(libPath) as LibPath;
  if (client) return [`scope:${scope}`, `type:${layer}`, 'feat:none', GENERATED_TAG];
  const tags = [
    `scope:${scope}`,
    `type:${FEATURE_LAYERS.includes(layer) ? 'feature' : layer}`,
    feat ? `feat:${feat}` : 'feat:none',
  ];
  // the only marker: the slice root the app shell composes (no ports — slices never import each other)
  if (layer === 'shell') tags.push('entry');
  return tags;
}

/** Project name: path below libs/ joined with "-". */
export const projectNameFor = (libPath: string): string => libPath.replaceAll('/', '-');
/** Import alias: one exact `paths` entry per lib in tsconfig.base.json. */
export const aliasFor = (libPath: string): string => `${ALIAS_PREFIX}${libPath}`;

/** Known scope with edit distance ≤ 2 (typo hint), if any. */
function closestScope(scope: string, scopes: string[]): string | undefined {
  const ranked = scopes
    .map((candidate) => ({ candidate, distance: editDistance(scope, candidate) }))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0] && ranked[0].distance <= 2 ? ranked[0].candidate : undefined;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
