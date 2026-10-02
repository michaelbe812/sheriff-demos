import {
  anyTag,
  noDependencies,
  sameTag,
  SheriffConfig,
} from '@softarc/sheriff-core';

type Modules = NonNullable<SheriffConfig['modules']>;
type DepRules = SheriffConfig['depRules'];

/**
 * Berger Engineering sheriff blueprint — vertical slices for apps in /apps
 * and Nx libs in /libs.
 *
 * Principle: EVERYTHING is a slice with the same internal layer matrix;
 * access from outside only through a port.
 *   - domain `api/`      -> tag `port`      (public API towards other domains)
 *   - feat `api/`        -> tag `feat-port` (public API towards sibling feats,
 *                                            never visible outside the domain)
 *
 * Two rule axes are combined with AND semantics: every tag of the importing
 * module must independently allow the import (one tag's rule is satisfied if
 * ANY of the target's tags matches it). Marker tags (`entry`, `port`,
 * `feat-port`) therefore get a transparent `anyTag` rule — the type/domain/
 * feat axes carry the actual constraints.
 *
 * Layer matrix (X may import Y):
 *   types   -> (nothing)
 *   utils   -> types, utils
 *   events  -> types, utils, events      (signal-store event definitions)
 *   api     -> types, utils, api
 *   state   -> types, utils, api, state, events  (stores, business services)
 *   ui      -> types, utils, ui, events  (dumb components; component-local
 *              stores live INSIDE the ui bucket — intra-module imports are
 *              never checked)
 *   feature -> every type:*              (smart containers, routes, shells)
 *
 * Naming conventions are load-bearing:
 *   - `feat-<name>/` folders drive the path-based feat isolation
 *   - domains live under `domains/`, shared features directly at the root
 *     (listed explicitly via `sharedFeatures`)
 *   - a top-level `internal/` folder inside a module is module-private
 *     (sheriff's default `encapsulationPattern`)
 *   - libs: flat under src/, NO index.ts barrel
 */

/** One slice shape for domains and shared-features, app-internal or as lib. */
export const slice = (path: string, scope: string): Modules => ({
  [path]: [scope, 'type:feature', 'entry'], // <slice>.routes.ts, shell
  [`${path}/types`]: [scope, 'type:types'],
  [`${path}/utils`]: [scope, 'type:utils'],
  [`${path}/events`]: [scope, 'type:events'],
  [`${path}/api`]: [scope, 'type:api', 'port'], // the domain's PUBLIC PORT
  [`${path}/state`]: [scope, 'type:state'],
  [`${path}/ui`]: [scope, 'type:ui'],
  [`${path}/feat-<feat>`]: [scope, 'feat:<feat>', 'type:feature'],
  [`${path}/feat-<feat>/types`]: [scope, 'feat:<feat>', 'type:types'],
  [`${path}/feat-<feat>/utils`]: [scope, 'feat:<feat>', 'type:utils'],
  [`${path}/feat-<feat>/events`]: [scope, 'feat:<feat>', 'type:events'],
  [`${path}/feat-<feat>/api`]: [scope, 'feat:<feat>', 'type:api', 'feat-port'],
  [`${path}/feat-<feat>/state`]: [scope, 'feat:<feat>', 'type:state'],
  [`${path}/feat-<feat>/ui`]: [scope, 'feat:<feat>', 'type:ui'],
});

export const appOf = (path: string): string | null =>
  /(?:^|\/)apps\/([^/]+)\//.exec(path)?.[1] ?? null;

/**
 * Target inside an app => must be the same app. Libs are app-free; lib -> app
 * is blocked. The from-side uses the FILE path: files of the implicit root
 * module (e.g. main.ts) live in a module whose path is the workspace root,
 * which would never match any app.
 */
export const sameApp = ({
  fromFilePath,
  toModulePath,
}: {
  fromFilePath: string;
  toModulePath: string;
}): boolean => {
  const toApp = appOf(toModulePath);
  return toApp === null || toApp === appOf(fromFilePath);
};

export const inAnyFeat = (path: string): boolean =>
  /\/feat-[^/]+(\/|$)/.test(path);

export interface SheriffBlueprintOptions {
  /**
   * Root-level shared features (deep modules with a port, e.g. auth, layout).
   * Listed explicitly instead of a placeholder: they live directly under app/
   * resp. libs/, where a placeholder would also swallow `domains` and
   * `shared`. One entry per shared feature.
   */
  sharedFeatures?: string[];
  /** One entry per app / verified lib for `npx sheriff verify`. */
  entryPoints?: Record<string, string>;
  /** Project-specific extra modules, merged AFTER the blueprint modules. */
  extraModules?: Modules;
  /** Project-specific extra dep rules, merged AFTER the blueprint rules. */
  extraDepRules?: DepRules;
}

export const blueprintDepRules = (): DepRules => ({
  // bootstrap (main.ts) wires the shell and lazy slices of ITS OWN app
  root: (ctx) =>
    sameApp(ctx) &&
    (ctx.to.startsWith('app:') ||
      ctx.to === 'entry' ||
      ctx.to === 'port' ||
      ctx.to === 'shared'),

  // NO '*' catch-all: a `'*': 'shared'` rule would give EVERY from tag
  // clearance towards shared-tagged modules and thereby bypass the type
  // axis inside the shared area (utils -> api, ui -> api, ...). Instead the
  // scope rules below grant `shared` explicitly — the type axis keeps
  // applying because shared buckets carry type:* tags too.
  shared: (ctx) => ctx.to === 'shared' && sameApp(ctx),
  noTag: noDependencies, // unconfigured modules: surfaced, never a silent pass

  // marker tags are transparent as FROM tags — constraints come from the
  // other axes (AND semantics)
  entry: anyTag,
  port: anyTag,
  'feat-port': anyTag,

  // app shell composes slices via their entry (routes/shell) and ports
  'app:*': [
    sameTag,
    (ctx) =>
      sameApp(ctx) &&
      (ctx.to === 'entry' || ctx.to === 'port' || ctx.to === 'shared'),
  ],

  // type axis — the layer matrix within a slice
  'type:types': noDependencies,
  'type:utils': ['type:types', 'type:utils'],
  'type:events': ['type:types', 'type:utils', 'type:events'],
  'type:api': ['type:types', 'type:utils', 'type:api'],
  'type:state': ['type:types', 'type:utils', 'type:api', 'type:state', 'type:events'],
  'type:ui': ['type:types', 'type:utils', 'type:ui', 'type:events'], // NOT api, NOT state
  'type:feature': ({ to }) => to.startsWith('type:'),

  // scope axis — own domain freely, foreign domains/shared-features only
  // via port, plus the shared area (type axis still applies on top)
  'domain:*': [
    (ctx) =>
      sameApp(ctx) &&
      ctx.to.startsWith('domain:') &&
      ctx.from.split(':')[1] === ctx.to.split(':')[1],
    (ctx) => sameApp(ctx) && (ctx.to === 'port' || ctx.to === 'shared'),
  ],

  // feat axis — feats are private towards their siblings
  'feat:*': [
    sameTag, // own feat
    ({ toModulePath }) => !inAnyFeat(toModulePath), // domain-shared, shared, ports
    ({ to }) => to === 'feat-port', // sibling feats only via their api
  ],
});

export function createSheriffConfig(
  options: SheriffBlueprintOptions = {},
): SheriffConfig {
  const { sharedFeatures = [], entryPoints, extraModules, extraDepRules } =
    options;

  const sharedFeatureSlices = (prefix: (sf: string) => string): Modules =>
    Object.assign(
      {},
      ...sharedFeatures.map((sf) => slice(prefix(sf), `domain:${sf}`)),
    );

  return {
    enableBarrelLess: true,
    // encapsulationPattern: 'internal' is the default — every module gets a
    // private `internal/` folder for free; no dedicated bucket needed.
    ...(entryPoints ? { entryPoints } : {}),

    modules: {
      'apps/<app>/src': {
        environments: ['shared'],
        app: ['app:<app>'],
        // literal keys before placeholder keys — matching is first-match-wins
        'app/shared/types': ['shared', 'type:types'],
        'app/shared/utils': ['shared', 'type:utils'],
        'app/shared/api': ['shared', 'type:api'],
        'app/shared/ui': ['shared', 'type:ui'],
        ...sharedFeatureSlices((sf) => `app/${sf}`),
        ...slice('app/domains/<domain>', 'domain:<domain>'),
      },
      // Phase 2 — identical tags, so rules stay the same after extraction.
      'libs/shared/<bucket>/src': ['shared', 'type:<bucket>'],
      ...sharedFeatureSlices((sf) => `libs/${sf}/src`),
      ...slice('libs/domains/<domain>/src', 'domain:<domain>'),
      ...extraModules,
    },

    depRules: {
      ...blueprintDepRules(),
      ...extraDepRules,
    },
  };
}

/**
 * Options for `@nx/enforce-module-boundaries` that play well with the
 * blueprint: static port imports into lazy-loaded domain libs are a
 * deliberate, sheriff-governed pattern.
 */
export const nxModuleBoundariesOptions = (libAliasPrefix = '@blueprint') => ({
  enforceBuildableLibDependency: true,
  checkDynamicDependenciesExceptions: [`${libAliasPrefix}/**`],
  allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
  depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }],
});
