/**
 * Folder convention of the blueprint libs — the single source of truth for
 * the crystal plugin (blueprint-libs.ts), the generators and the sync generator.
 * No runtime imports: the plugin loads it in every graph computation.
 *
 *   libs/<scope>/<layer>                  scope:<scope> type:<layer> feat:none
 *   libs/<scope>/feat-<feat>/<layer>      scope:<scope> type:<layer> feat:<feat>
 */

export const LIBS_DIR = 'libs';
export const ALIAS_PREFIX = '@blueprint/';
export const FEAT_PREFIX = 'feat-';
export const SHARED_SCOPE = 'shared';

/** Layer folders that are a `type:feature` lib (slice root shell + feat container). */
export const FEATURE_LAYERS = ['shell', 'feature'];
/** Test-only libs (MSW handlers, fixtures): never built, never shipped. */
export const TESTING_LAYER = 'testing';
/** Every layer folder the depConstraints know. Anything else would get an unconstrained `type:` tag. */
export const KNOWN_LAYERS = ['types', 'utils', 'events', 'api', 'data', 'ui', ...FEATURE_LAYERS, TESTING_LAYER];
/** Layers of a slice root (`libs/<scope>/<layer>`): `feature` only exists inside a feat. */
export const SLICE_LAYERS = KNOWN_LAYERS.filter((layer) => layer !== 'feature');
/** Layers inside a feat (`libs/<scope>/feat-<feat>/<layer>`): no shell, no testing. */
export const FEAT_LAYERS = KNOWN_LAYERS.filter((layer) => layer !== 'shell' && layer !== TESTING_LAYER);

/** Options of the plugin entry in nx.json (`plugins[] → { plugin: '@blueprint/tooling', options }`). */
export interface BlueprintLibsOptions {
  /** Allowed `libs/<scope>` folders. Unknown scope = graph error (folder typo guard). */
  scopes?: string[];
}

export interface LibPath {
  scope: string;
  /** feat name without `feat-`, undefined outside a feat */
  feat?: string;
  layer: string;
}

/** `booking/feat-check-booking/api` → { scope, feat, layer }; undefined if the shape is wrong. */
export function parseLibPath(libPath: string): LibPath | undefined {
  const [scope, ...rest] = libPath.split('/');
  const layer = rest.at(-1) ?? '';
  const featFolder = rest.find((segment) => segment.startsWith(FEAT_PREFIX));
  const validShape = rest.length === 1 || (rest.length === 2 && featFolder === rest[0]);
  if (!scope || !validShape || !KNOWN_LAYERS.includes(layer)) return undefined;
  return { scope, layer, feat: featFolder?.slice(FEAT_PREFIX.length) };
}

/** Why a lib path is not allowed, or undefined if it is (shape, layer, scope list). */
export function libPathError(libPath: string, options: BlueprintLibsOptions = {}): string | undefined {
  const parsed = parseLibPath(libPath);
  if (!parsed) {
    return `${LIBS_DIR}/${libPath}: not a blueprint lib path — expected ${LIBS_DIR}/<scope>/<layer> or ${LIBS_DIR}/<scope>/feat-<feat>/<layer>, layer one of ${KNOWN_LAYERS.join(', ')}`;
  }
  const { scopes } = options;
  if (scopes && !scopes.includes(parsed.scope)) {
    const suggestion = closestScope(parsed.scope, scopes);
    return (
      `${LIBS_DIR}/${libPath}: unknown scope "${parsed.scope}"${suggestion ? ` (did you mean "${suggestion}"?)` : ''}. ` +
      `Allowed scopes (nx.json → plugins → @blueprint/tooling → options.scopes): ${scopes.join(', ')}. ` +
      `New slice: nx g @blueprint/tooling:domain ${parsed.scope}`
    );
  }
  return undefined;
}

/** Tags of a lib, derived purely from its path below `libs/` (e.g. `booking/feat-check-booking/api`). */
export function deriveTags(libPath: string, options: BlueprintLibsOptions = {}): string[] {
  const error = libPathError(libPath, options);
  // fail the graph instead of silently creating an unconstrained lib (the old tag-typo problem)
  if (error) throw new Error(error);
  const { scope, feat, layer } = parseLibPath(libPath) as LibPath;
  const tags = [
    `scope:${scope}`,
    `type:${FEATURE_LAYERS.includes(layer) ? 'feature' : layer}`,
    feat ? `feat:${feat}` : 'feat:none',
  ];
  if (layer === 'shell') tags.push('entry');
  if (layer === 'api' && scope !== SHARED_SCOPE) tags.push(feat ? 'feat-port' : 'port');
  return tags;
}

/** Project name: path below libs/ joined with "-". */
export const projectNameFor = (libPath: string): string => libPath.replaceAll('/', '-');
/** Import alias: resolved by the single `@blueprint/*` wildcard in tsconfig.base.json. */
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
