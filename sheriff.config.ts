import { noDependencies, sameTag, SheriffConfig } from '@softarc/sheriff-core';

/**
 * Vertical-slice architecture for Confora SPAs (confora-portal + admin-console).
 *
 * Two independent tag axes are assigned to every module, and a dependency is
 * only legal when BOTH axes allow it (Sheriff treats multiple source tags with
 * AND semantics — every `fromTag` must independently permit the import, while a
 * single tag is satisfied if ANY of the target's tags matches it):
 *
 *  - `type:<layer>`        governs LAYERING inside a slice (ui/data/api/utils/types/feature)
 *  - `feature:<feature>`   governs the FEATURE BOUNDARY (no cross-feature imports)
 *
 * Layer matrix (X may import Y):
 *   types   -> (nothing)
 *   utils   -> types, utils
 *   api     -> types, utils, api
 *   data    -> types, utils, api, data        (state / signal stores live here)
 *   ui      -> types, utils, api, ui           (NOT data — dumb components only)
 *   feature -> every type:*                    (smart containers wire data into ui)
 *
 * Feature boundary:
 *   A `feature:<feature>` module may only import from the SAME feature domain
 *   (its own feature-shared buckets and its own `feat-<feat>` code) plus the
 *   app-level `shared` area. It can never import another feature — EXCEPT through
 *   that feature's PUBLIC API PORT (see below).
 *
 *   `shared` is importable by everyone via the global `'*': 'shared'` rule, and
 *   `shared` itself carries only `type:*` tags, so the layer matrix keeps the
 *   shared area internally layered while allowing any feature to consume it.
 *
 * Public API port (controlled cross-feature reuse):
 *   The feature-shared `api/` bucket is the ONLY thing a feature exposes to other
 *   features. It is tagged with an extra `port` marker; the `feature:*` rule lets
 *   any feature import a `port` target. Everything else (ui/data/types/utils and
 *   all `feat-<feat>` code) stays private to the feature. `feat-<feat>` private
 *   buckets carry `feature:<feature>-internal` so they are NEVER a cross-feature
 *   port, even though they are `type:api`.
 *
 * Cross-cutting infra:
 *   Cross-cutting infrastructure (auth, convex, user-context, guards,
 *   interceptors) folds into `app/shared/*`: backend clients + query refs →
 *   `shared/api`; stateful services, guards and interceptors → `shared/data`.
 *   Both apps now follow this layout — there is no transitional `app/core`.
 */
export const config: SheriffConfig = {
  enableBarrelLess: true,
  // Surface accidental name collisions across barrel-less slices in lint/CI.
  showWarningOnBarrelCollision: true,

  modules: {
    'apps/<app>/src': {
      // Build-time environment config — app-wide, consumable everywhere.
      environments: ['shared'],

      app: ['app:<app>'],
      // App shell: bootstrap config, routes, layout chrome, and the routing
      // hosts that compose features via lazy imports. Sits above the feature
      // boundary — may orchestrate features and consume `shared`.
      'app/layout': ['app:<app>'],
      'app/routing': ['app:<app>'],

      // App-wide shared area — consumable by any feature, internally layered.
      'app/shared/types': ['shared', 'type:types'],
      'app/shared/utils': ['shared', 'type:utils'],
      'app/shared/api': ['shared', 'type:api'],
      'app/shared/data': ['shared', 'type:data'],
      'app/shared/ui': ['shared', 'type:ui'],

      // Auth infrastructure — a cross-cutting area (NOT a feature slice) holding
      // the singleton AuthService, route guard, and HTTP interceptor wired
      // app-wide. Tagged `shared` so any feature (e.g. the auth screens) may
      // consume it, and internally layered like `shared` so its pure helpers
      // stay `type:utils`. See ADR 0006.
      'app/auth-infrastructure': ['shared', 'type:data'],
      'app/auth-infrastructure/utils': ['shared', 'type:utils'],

      // Feature slices. Sibling matchers (most specific wins); the feature root
      // itself is a leaf module so loose root files (routes, guards, the smart
      // container) are tagged `feature:<feature>, type:feature`.
      'app/features/<feature>': ['feature:<feature>', 'type:feature'],

      // Feature-shared buckets (shared within the feature). The `api` bucket is
      // additionally tagged `port` — the feature's PUBLIC face other features
      // may import.
      'app/features/<feature>/types': ['feature:<feature>', 'type:types'],
      'app/features/<feature>/utils': ['feature:<feature>', 'type:utils'],
      'app/features/<feature>/api': ['feature:<feature>', 'type:api', 'port'],
      'app/features/<feature>/data': ['feature:<feature>', 'type:data'],
      'app/features/<feature>/ui': ['feature:<feature>', 'type:ui'],

      // Concrete feat implementations, each with its own private buckets. These
      // carry `feature:<feature>-internal` so they share the feature domain with
      // their siblings but are NEVER exposed as a cross-feature port.
      'app/features/<feature>/feat-<feat>': [
        'feature:<feature>-internal',
        'type:feature',
      ],
      'app/features/<feature>/feat-<feat>/types': [
        'feature:<feature>-internal',
        'type:types',
      ],
      'app/features/<feature>/feat-<feat>/utils': [
        'feature:<feature>-internal',
        'type:utils',
      ],
      'app/features/<feature>/feat-<feat>/api': [
        'feature:<feature>-internal',
        'type:api',
      ],
      'app/features/<feature>/feat-<feat>/data': [
        'feature:<feature>-internal',
        'type:data',
      ],
      'app/features/<feature>/feat-<feat>/ui': [
        'feature:<feature>-internal',
        'type:ui',
      ],
    },

    // Workspace libraries consumed by the apps. Out of scope for the
    // vertical-slice rules — tagged `shared` so apps may depend on their
    // public entrypoints. (Their own internal architecture is not governed
    // here; verification is scoped to each app's main.ts.)
    'packages/<pkg>/src': ['shared'],
    'packages/<pkg>/src/<dir>': ['shared'],
    'packages-internal/<pkg>/src': ['shared'],
    'packages-internal/<pkg>/src/<dir>': ['shared'],
  },

  depRules: {
    // Bootstrap (main.ts / app config) may pull in feature entry points.
    root: ['type:feature', 'app:*', 'shared'],

    // Everyone may consume the app-level shared area.
    '*': 'shared',

    // App shell wires routes/providers to features and shared infrastructure.
    'app:*': [sameTag, 'type:feature', 'shared'],

    // Layer matrix (the "type" axis) — governs what may import what WITHIN a slice.
    'type:types': noDependencies,
    'type:utils': ['type:types', 'type:utils'],
    'type:api': ['type:types', 'type:utils', 'type:api'],
    'type:data': ['type:types', 'type:utils', 'type:api', 'type:data'],
    'type:ui': ['type:types', 'type:utils', 'type:api', 'type:ui'],
    'type:feature': ({ to }) => to.startsWith('type:'),

    // Feature boundary (the "feature" axis). A feature may import:
    //   - its own domain: `feature:<f>` <-> `feature:<f>` and `feature:<f>-internal`
    //     (feature-shared <-> feat-private, both directions, same domain only);
    //   - any other feature's PUBLIC API PORT (the `port` tag), and nothing else
    //     of that feature. The `shared` area is reached through the '*' rule.
    'feature:*': [
      sameTag,
      ({ from, to }) =>
        to.startsWith('feature:') &&
        from.split(':')[1].replace(/-internal$/, '') ===
          to.split(':')[1].replace(/-internal$/, ''),
      // Public API port: any feature may import another feature's `api` bucket.
      ({ to }) => to === 'port',
    ],
  },
};
