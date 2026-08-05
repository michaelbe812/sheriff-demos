import { anyTag, sameTag, SheriffConfig } from './sheriff-types';

/**
 * Ports & Adapters (hexagonal) — one hexagon PER SLICE. Shared engine behind
 * the `hexagonal-fwcore` and `hexagonal-strict` presets.
 *
 *   fwcore  — the core MAY know Angular (DI, signals). `application/` collapses
 *             into `domain/` (3 layers). Runs on upstream @softarc; no fork.
 *   strict  — the core is framework-free. A dedicated `application/` layer holds
 *             everything with `inject()`, and a `denyRules` entry seals the core
 *             so it imports nothing but its own `domain/`. Requires the
 *             @lambda-solutions fork (v1+) for `denyRules`.
 *
 * TWO TAG AXES, AND-combined:
 *   scope:  domain:<slice> | shared | app:<app>
 *   type:   domain | app (strict only) | port-in | port-out |
 *           adapter-driving | adapter-driven | providers | ui | util | types
 *   marker: entry | port
 */

export type HexPreset = 'hexagonal-fwcore' | 'hexagonal-strict';

/** `domain:booking` -> `booking` */
const sliceName = (tag: string) => tag.split(':')[1];

type Modules = NonNullable<SheriffConfig['modules']>;
// SheriffConfig here already types denyRules (fork-only at runtime, ignored by
// upstream). No widening needed.
type HexConfig = SheriffConfig;

/** One hexagon below `path`, scoped to slice `name`. */
export const hexSlice = (
  path: string,
  name: string,
  preset: HexPreset,
): Modules => ({
  [path]: [`domain:${name}`, 'entry'], // <slice>.routes.ts
  [`${path}/domain`]: [`domain:${name}`, 'type:domain'],
  // strict keeps a separate application layer for everything with inject()
  ...(preset === 'hexagonal-strict'
    ? { [`${path}/application`]: [`domain:${name}`, 'type:app'] }
    : {}),
  [`${path}/ports/in`]: [`domain:${name}`, 'type:port-in', 'port'],
  [`${path}/ports/out`]: [`domain:${name}`, 'type:port-out'],
  // ports/ root holds <slice>.providers.ts — MUST come after ports/in and
  // ports/out: module matching is first-match-wins.
  [`${path}/ports`]: [`domain:${name}`, 'type:providers', 'entry'],
  [`${path}/adapters/driving`]: [`domain:${name}`, 'type:adapter-driving'],
  [`${path}/adapters/driven`]: [`domain:${name}`, 'type:adapter-driven'],
});

export interface HexagonalOptions {
  /** Map app name -> list of slice names inside apps/<app>/src/app/domains. */
  apps?: Record<string, string[]>;
  /**
   * Hexagon slices extracted into Nx libs under libs/domains/<slice>/src.
   * The `hexagon` generator writes a lib when run without --app; list those
   * slices here so their modules are governed the same way as app-internal ones.
   */
  libDomains?: string[];
  entryPoints?: Record<string, string>;
  extraModules?: Modules;
}

export function hexagonalConfig(
  preset: HexPreset,
  options: HexagonalOptions = {},
): HexConfig {
  const { apps = {}, libDomains = [], entryPoints, extraModules } = options;

  const appModules = Object.fromEntries(
    Object.entries(apps).map(([app, slices]) => [
      `apps/${app}/src`,
      {
        app: [`app:${app}`],
        'app/shared/types': ['shared', 'type:types'],
        'app/shared/util': ['shared', 'type:util'],
        'app/shared/ui': ['shared', 'type:ui'],
        ...Object.assign(
          {},
          ...slices.map((s) => hexSlice(`app/domains/${s}`, s, preset)),
        ),
      },
    ]),
  );

  // Phase 2 — extracted hexagon libs. Same tags as the app-internal shape, so
  // the rules stay identical after extraction (mirrors the vertical preset).
  const libModules: Modules = Object.assign(
    {},
    ...libDomains.map((s) => hexSlice(`libs/domains/${s}/src`, s, preset)),
  );

  const typeAxis: HexConfig['depRules'] =
    preset === 'hexagonal-strict'
      ? {
          // strict: the core withholds `shared`; a denyRule seals it fully
          'type:domain': ({ to }) => to === 'type:domain',
          'type:app': ({ to }) =>
            [
              'type:domain',
              'type:port-in',
              'type:port-out',
              'type:util',
              'type:types',
            ].includes(to),
          'type:adapter-driving': ({ to }) =>
            [
              'type:domain',
              'type:app',
              'type:port-in',
              'type:ui',
              'type:util',
              'type:types',
            ].includes(to),
        }
      : {
          // fwcore: use-cases + store live in the core; it may reach its ports
          'type:domain': ({ to }) =>
            [
              'type:domain',
              'type:port-in',
              'type:port-out',
              'type:util',
              'type:types',
            ].includes(to),
          'type:adapter-driving': ({ to }) =>
            [
              'type:domain',
              'type:port-in',
              'type:ui',
              'type:util',
              'type:types',
            ].includes(to),
        };

  return {
    enableBarrelLess: true,
    ...(entryPoints ? { entryPoints } : {}),

    modules: {
      ...appModules,
      ...libModules,
      ...extraModules,
    },

    depRules: {
      root: ({ to }) => to.startsWith('app:') || to === 'entry',
      entry: anyTag,
      port: anyTag,
      'app:*': [
        sameTag,
        ({ to }) => to === 'entry' || to === 'port' || to === 'shared',
      ],

      // ---- TYPE AXIS ----
      ...typeAxis,
      'type:port-in': ({ to }) => ['type:domain', 'type:types'].includes(to),
      'type:port-out': ({ to }) => ['type:domain', 'type:types'].includes(to),
      'type:adapter-driven': ({ to }) =>
        ['type:domain', 'type:port-out', 'type:util', 'type:types'].includes(
          to,
        ),
      'type:providers': ({ to }) => to.startsWith('type:'),
      'type:ui': ({ to }) => ['type:ui', 'type:util', 'type:types'].includes(to),
      'type:util': ({ to }) => ['type:util', 'type:types'].includes(to),
      'type:types': ({ to }) => to === 'type:types',

      // ---- SCOPE AXIS ----
      shared: ({ to }) => to === 'shared',
      'domain:*': [
        ({ from, to }) =>
          to.startsWith('domain:') && sliceName(from) === sliceName(to),
        ({ to }) => to === 'port' || to === 'shared',
      ],
    },

    // strict only: seal the core. Deny beats allow, per source tag — fires on
    // `type:domain` no matter what the `domain:<slice>` scope granted.
    ...(preset === 'hexagonal-strict'
      ? { denyRules: { 'type:domain': ({ to }) => to !== 'type:domain' } }
      : {}),
  };
}
