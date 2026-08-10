import {
  anyTag,
  noDependencies,
  sameTag,
  SheriffConfig,
} from './sheriff-types';

type Modules = NonNullable<SheriffConfig['modules']>;
type DepRules = SheriffConfig['depRules'];

/**
 * Vertical-slice blueprint — the shared engine behind the `blueprint` and
 * `inverted` presets. Both share ONE parametrised factory; `inverted` is
 * `blueprint` plus an `infra/` bucket that holds the port's implementation and
 * stays invisible to everyone except the port itself and the slice root.
 *
 * Principle: EVERYTHING is a slice with the same internal layer matrix; access
 * from outside only through a port.
 *   - domain `api/`  -> tag `port`      (public API towards other domains)
 *   - feat  `api/`   -> tag `feat-port` (public API towards sibling feats)
 *
 * Two rule axes are combined with AND semantics: every tag of the importing
 * module must independently allow the import. Marker tags (`entry`, `port`,
 * `feat-port`) therefore get a transparent `anyTag` rule.
 *
 * Layer matrix (X may import Y):
 *   types   -> (nothing)
 *   utils   -> types, utils
 *   events  -> types, utils, events
 *   api     -> types, utils, api (+ infra in `inverted`: the port declares its
 *              own DEFAULT impl — layered, not inverted; see the rule below)
 *   infra   -> types, utils, api, infra          (inverted preset only)
 *   data    -> types, utils, api, data, events   (binds to the token, not infra)
 *   ui      -> types, utils, ui, events          (NOT api, NOT data)
 *   feature -> every type:* (inverted: EXCEPT infra outside the slice root)
 */

export type VerticalPreset = 'blueprint' | 'inverted';

/** One slice shape for domains and shared-features, app-internal or as lib. */
export const slice = (
  path: string,
  scope: string,
  preset: VerticalPreset,
): Modules => ({
  [path]: [scope, 'type:feature', 'entry'], // <slice>.routes.ts, shell
  [`${path}/types`]: [scope, 'type:types'],
  [`${path}/utils`]: [scope, 'type:utils'],
  [`${path}/events`]: [scope, 'type:events'],
  [`${path}/api`]: [scope, 'type:api', 'port'], // the domain's PUBLIC PORT
  // inverted only: the port's implementation, invisible outside the slice
  ...(preset === 'inverted'
    ? { [`${path}/infra`]: [scope, 'type:infra'] }
    : {}),
  [`${path}/data`]: [scope, 'type:data'],
  [`${path}/ui`]: [scope, 'type:ui'],
  [`${path}/feat-<feat>`]: [scope, 'feat:<feat>', 'type:feature'],
  [`${path}/feat-<feat>/types`]: [scope, 'feat:<feat>', 'type:types'],
  [`${path}/feat-<feat>/utils`]: [scope, 'feat:<feat>', 'type:utils'],
  [`${path}/feat-<feat>/events`]: [scope, 'feat:<feat>', 'type:events'],
  [`${path}/feat-<feat>/api`]: [scope, 'feat:<feat>', 'type:api', 'feat-port'],
  ...(preset === 'inverted'
    ? { [`${path}/feat-<feat>/infra`]: [scope, 'feat:<feat>', 'type:infra'] }
    : {}),
  [`${path}/feat-<feat>/data`]: [scope, 'feat:<feat>', 'type:data'],
  [`${path}/feat-<feat>/ui`]: [scope, 'feat:<feat>', 'type:ui'],
});

export const appOf = (path: string): string | null =>
  /(?:^|\/)apps\/([^/]+)\//.exec(path)?.[1] ?? null;

/**
 * Target inside an app => must be the same app. Libs are app-free; lib -> app
 * is blocked. The from-side uses the FILE path.
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

export const blueprintDepRules = (preset: VerticalPreset): DepRules => ({
  // bootstrap (main.ts) wires the shell and lazy slices of ITS OWN app
  root: (ctx) =>
    sameApp(ctx) &&
    (ctx.to.startsWith('app:') ||
      ctx.to === 'entry' ||
      ctx.to === 'port' ||
      ctx.to === 'shared'),

  // NO '*' catch-all: a `'*': 'shared'` rule would give EVERY from tag
  // clearance towards shared-tagged modules and thereby bypass the type axis.
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
  // In the inverted preset the port is a SELF-PROVIDING contract: it may name
  // its own impl to declare a DEFAULT via
  // `@Injectable({providedIn:'root', useFactory: () => inject(HttpXApi)})`,
  // so a slice needs no providers file and no provideX() call.
  //
  // The trade, stated plainly: this arrow points back at infrastructure, so
  // the relation is LAYERED, not inverted. Substitutability survives —
  // consumers name only the token and an explicit provider still wins — but
  // the contract knows one impl by name and api/ <-> infra/ is a real import
  // cycle (fine at runtime, classes hoist). Encapsulation towards OTHER slices
  // is untouched: infra/ carries no `port` tag, so the scope axis blocks it.
  // In the `blueprint` preset there is no infra/ bucket at all.
  'type:api':
    preset === 'inverted'
      ? ['type:types', 'type:utils', 'type:api', 'type:infra']
      : ['type:types', 'type:utils', 'type:api'],
  ...(preset === 'inverted'
    ? {
        // The impl side: implements the contract, talks to shared/api (http)
        // and its own types/utils. It may NOT reach data/ or ui/.
        'type:infra': ['type:types', 'type:utils', 'type:api', 'type:infra'],
      }
    : {}),
  // Stores bind to the TOKEN in api/, never to a class in infra/.
  'type:data': [
    'type:types',
    'type:utils',
    'type:api',
    'type:data',
    'type:events',
  ],
  'type:ui': ['type:types', 'type:utils', 'type:ui', 'type:events'], // NOT api, NOT data
  // Smart containers: routes, shells, feat roots. Broad by design.
  //
  // Inverted preset: NOT towards `type:infra`, which is the impl behind the
  // port. `type:feature` is carried by BOTH the slice root and every
  // `feat-<x>/`, and only the slice root may wire a token onto its impl:
  //   slice root -> infra   ALLOWED (the wiring)
  //   feat-x     -> infra   BLOCKED (must go through api/)
  // Told apart by the FILE PATH, not tags — upstream 0.19.6 does not put
  // `fromTags` in the rule context; only the fork does.
  'type:feature':
    preset === 'inverted'
      ? ({ to, fromFilePath }) =>
          to.startsWith('type:') &&
          (to !== 'type:infra' || !inAnyFeat(fromFilePath))
      : ({ to }) => to.startsWith('type:'),

  // scope axis — own domain freely, foreign domains/shared-features only via
  // port, plus the shared area (type axis still applies on top)
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

export interface VerticalSliceOptions {
  /** Root-level shared features (deep modules with a port, e.g. auth, layout). */
  sharedFeatures?: string[];
  /** One entry per app / verified lib for `sheriff verify`. */
  entryPoints?: Record<string, string>;
  /** Project-specific extra modules, merged AFTER the blueprint modules. */
  extraModules?: Modules;
  /** Project-specific extra dep rules, merged AFTER the blueprint rules. */
  extraDepRules?: DepRules;
}

export function verticalSliceConfig(
  preset: VerticalPreset,
  options: VerticalSliceOptions = {},
): SheriffConfig {
  const { sharedFeatures = [], entryPoints, extraModules, extraDepRules } =
    options;

  const sharedFeatureSlices = (prefix: (sf: string) => string): Modules =>
    Object.assign(
      {},
      ...sharedFeatures.map((sf) => slice(prefix(sf), `domain:${sf}`, preset)),
    );

  return {
    enableBarrelLess: true,
    ...(entryPoints ? { entryPoints } : {}),

    modules: {
      'apps/<app>/src': {
        environments: ['shared'],
        app: ['app:<app>'],
        'app/shared/types': ['shared', 'type:types'],
        'app/shared/utils': ['shared', 'type:utils'],
        'app/shared/api': ['shared', 'type:api'],
        'app/shared/ui': ['shared', 'type:ui'],
        ...sharedFeatureSlices((sf) => `app/${sf}`),
        ...slice('app/domains/<domain>', 'domain:<domain>', preset),
      },
      'libs/shared/<bucket>/src': ['shared', 'type:<bucket>'],
      ...sharedFeatureSlices((sf) => `libs/${sf}/src`),
      ...slice('libs/domains/<domain>/src', 'domain:<domain>', preset),
      ...extraModules,
    },

    depRules: {
      ...blueprintDepRules(preset),
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
