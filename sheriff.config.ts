import {
  anyTag,
  noDependencies,
  sameTag,
  SheriffConfig,
} from '@softarc/sheriff-core';

/**
 * Sheriff blueprint — vertical slices for apps in /apps and Nx libs in /libs.
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
 *   events  -> types, utils, events      (ngrx signal-store event definitions)
 *   api     -> types, utils, api         (+ events if ever needed — one-liner)
 *   data    -> types, utils, api, data, events   (stores, business services)
 *   ui      -> types, utils, ui, events  (dumb components; component-local
 *              stores live INSIDE the ui bucket and are unrestricted there —
 *              intra-module imports are never checked)
 *   feature -> every type:*              (smart containers, routes, shells)
 *
 * Scopes:
 *   domain:<name>  domains AND shared-features (auth, layout, …) — same
 *                  mechanism. Foreign domains only via their `port`.
 *   feat:<feat>    feats are private: own feat + everything outside feat-*
 *                  folders (domain-shared, shared, ports) + sibling feat-ports.
 *                  The `feat-` folder prefix is load-bearing for this rule.
 *   shared         dumb shared area (types/utils/ui/api — deliberately no
 *                  data). Importable by everyone within the same app.
 *   app:<app>      app shell (app.ts, app.config.ts, app.routes.ts) — reaches
 *                  slices only via `entry` (slice root) and `port`.
 *
 * App isolation is path-based (sameApp): a target inside apps/<x> must belong
 * to the same app; libs are app-free and may never import app code. Domain
 * tags are location-independent — extracting a domain to /libs is a pure
 * folder move with zero rule changes.
 */

/** One slice shape for domains and shared-features, app-internal or as lib. */
const slice = (path: string, scope: string) => ({
  [path]: [scope, 'type:feature', 'entry'], // <slice>.routes.ts, shell
  [`${path}/types`]: [scope, 'type:types'],
  [`${path}/utils`]: [scope, 'type:utils'],
  [`${path}/events`]: [scope, 'type:events'],
  [`${path}/api`]: [scope, 'type:api', 'port'], // the domain's PUBLIC PORT
  [`${path}/data`]: [scope, 'type:data'],
  [`${path}/ui`]: [scope, 'type:ui'],
  [`${path}/feat-<feat>`]: [scope, 'feat:<feat>', 'type:feature'],
  [`${path}/feat-<feat>/types`]: [scope, 'feat:<feat>', 'type:types'],
  [`${path}/feat-<feat>/utils`]: [scope, 'feat:<feat>', 'type:utils'],
  [`${path}/feat-<feat>/events`]: [scope, 'feat:<feat>', 'type:events'],
  [`${path}/feat-<feat>/api`]: [scope, 'feat:<feat>', 'type:api', 'feat-port'],
  [`${path}/feat-<feat>/data`]: [scope, 'feat:<feat>', 'type:data'],
  [`${path}/feat-<feat>/ui`]: [scope, 'feat:<feat>', 'type:ui'],
});

const appOf = (path: string) =>
  /(?:^|\/)apps\/([^/]+)\//.exec(path)?.[1] ?? null;

/**
 * Target inside an app => must be the same app. Libs are app-free; lib -> app
 * is blocked. The from-side uses the FILE path: files of the implicit root
 * module (e.g. main.ts) live in a module whose path is the workspace root,
 * which would never match any app.
 */
const sameApp = ({
  fromFilePath,
  toModulePath,
}: {
  fromFilePath: string;
  toModulePath: string;
}) => {
  const toApp = appOf(toModulePath);
  return toApp === null || toApp === appOf(fromFilePath);
};

const inAnyFeat = (path: string) => /\/feat-[^/]+(\/|$)/.test(path);

/**
 * Root-level shared features (deep modules with a port, e.g. auth, layout).
 * Listed explicitly instead of a placeholder: they live directly under app/
 * resp. libs/, where a placeholder would also swallow `domains` and `shared`.
 * One line per new shared feature.
 */
const sharedFeatures = ['auth', 'layout'];

const sharedFeatureSlices = (prefix: (sf: string) => string) =>
  Object.assign(
    {},
    ...sharedFeatures.map((sf) => slice(prefix(sf), `domain:${sf}`)),
  );

export const config: SheriffConfig = {
  enableBarrelLess: true,
  // encapsulationPattern: 'internal' is the default — every module gets a
  // private `internal/` folder for free; no dedicated bucket needed.
  entryPoints: {
    client: 'apps/client/src/main.ts',
    // add one entry per extracted lib for `npx sheriff verify` (CLI is a
    // reachability-based spot check; ESLint is the authoritative gate):
    'domain-booking': 'libs/domains/booking/src/booking.routes.ts',
  },

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
  },

  depRules: {
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
    'type:api': ['type:types', 'type:utils', 'type:api'], // add 'type:events' when api needs events
    'type:data': ['type:types', 'type:utils', 'type:api', 'type:data', 'type:events'],
    'type:ui': ['type:types', 'type:utils', 'type:ui', 'type:events'], // NOT api, NOT data
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
  },
};
