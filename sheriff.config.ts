import { anyTag, sameTag, SheriffConfig } from '@softarc/sheriff-core';

/**
 * Ports & Adapters (hexagonal) — one hexagon PER SLICE.
 *
 * Blueprint app: apps/hexagonal-demo (booking + customer).
 *
 * This lives at the repo root because Sheriff resolves exactly ONE config:
 * `findConfig()` looks only in `tsData.rootDir` — the `rootDir` of the nearest
 * tsconfig, which is `.` here. There is no "closest config wins" and no
 * per-app config. Verified against 0.19.6 before writing this.
 *
 * ---------------------------------------------------------------------------
 * TWO TAG AXES, combined with AND semantics (every source tag must allow the
 * import; a single source tag is satisfied if ANY target tag matches it):
 *
 *   scope:  core:<slice>   the domain core — sealed
 *           domain:<slice> the outer layers of a slice
 *           shared         dumb, app-wide
 *           app:<app>      composition root
 *   type:   domain | app | port-in | port-out | adapter-driving |
 *           adapter-driven | providers | ui | util | types
 *   marker: entry (routes/providers) | port (public, cross-slice reachable)
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO '*' CATCH-ALL RULE — load-bearing, not style:
 *
 * `isDependencyAllowed` (0.19.6) iterates EVERY depRules key whose wildcard
 * matches the source tag and OR's the results — there is no "most specific
 * wins". A permissive `'*': 'shared'` therefore grants clearance via the
 * *scope* tag and silently bypasses the type axis.
 *
 * Concretely: with a '*' rule, a module tagged ['domain:booking','type:domain']
 * could import `shared` even though `type:domain` forbids it — the
 * 'domain:booking' tag matched '*' and returned true first. `noDependencies`
 * on the core becomes a decoration. (Found empirically, by simulating these
 * rules against the real engine before any code existed.)
 *
 * Consequences, both deliberate:
 *   1. No '*' key. The `shared` permission rides on the TYPE axis, where
 *      `type:domain` can withhold it.
 *   2. The core carries its own scope tag `core:<slice>` so the permissive
 *      `domain:*` rule can never widen it.
 *
 * ---------------------------------------------------------------------------
 * THE HEXAGON (what each rule buys):
 *
 *   domain/      the core. Imports NOTHING but its own core. No Angular, no
 *                rxjs, no shared, no ports. Dependency inversion's heart.
 *   application/ use-cases + signal store. Sees domain + own ports. Never adapters.
 *   ports/in     public face of the slice (`port`) — the ONLY cross-slice surface.
 *   ports/out    what the core needs from the world. Private to the slice.
 *   adapters/driving  UI. Sees use-cases + ports/in. NEVER ports/out or HTTP.
 *   adapters/driven   HTTP etc. Implements ports/out. Never calls use-cases.
 *   ports/*.providers.ts  slice composition root — the only place allowed to
 *                wire an adapter onto a port.
 */

/** `domain:booking` -> `booking`, `core:booking` -> `booking` */
const slice = (tag: string) => tag.split(':')[1];
const isSliceScope = (tag: string) =>
  tag.startsWith('domain:') || tag.startsWith('core:');

const hexSlice = (path: string, name: string) => ({
  // slice root: <slice>.routes.ts — the only thing app.routes.ts may see
  [path]: [`domain:${name}`, 'entry'],
  [`${path}/domain`]: [`core:${name}`, 'type:domain'],
  [`${path}/application`]: [`domain:${name}`, 'type:app'],
  [`${path}/ports/in`]: [`domain:${name}`, 'type:port-in', 'port'],
  [`${path}/ports/out`]: [`domain:${name}`, 'type:port-out'],
  // ports/ root holds <slice>.providers.ts — MUST come after ports/in and
  // ports/out: module matching is first-match-wins.
  [`${path}/ports`]: [`domain:${name}`, 'type:providers', 'entry'],
  [`${path}/adapters/driving`]: [`domain:${name}`, 'type:adapter-driving'],
  [`${path}/adapters/driven`]: [`domain:${name}`, 'type:adapter-driven'],
});

export const config: SheriffConfig = {
  enableBarrelLess: true,
  entryPoints: {
    'hexagonal-demo': 'apps/hexagonal-demo/src/main.ts',
  },

  modules: {
    'apps/hexagonal-demo/src': {
      app: ['app:hexagonal-demo'],
      'app/shared/types': ['shared', 'type:types'],
      'app/shared/util': ['shared', 'type:util'],
      'app/shared/ui': ['shared', 'type:ui'],
      ...hexSlice('app/domains/booking', 'booking'),
      ...hexSlice('app/domains/customer', 'customer'),
    },

    // The untouched Nx starter app. Not part of the blueprint — tagged only so
    // its modules have a rule and do not trip NoDependencyRuleForTagError.
    'apps/client/src': ['app:client'],
  },

  depRules: {
    // main.ts bootstraps the shell only
    root: ({ to }) => to.startsWith('app:') || to === 'entry',

    // marker tags are transparent as SOURCE tags; the real constraints ride on
    // the type/scope axes via AND semantics
    entry: anyTag,
    port: anyTag,

    'app:*': [
      sameTag,
      ({ to }) => to === 'entry' || to === 'port' || to === 'shared',
    ],

    // ---- TYPE AXIS ------------------------------------------------------
    // Carries the `shared` permission so that `type:domain` can withhold it.
    'type:domain': ({ to }) => to === 'type:domain',
    'type:app': ({ to }) =>
      ['type:domain', 'type:port-in', 'type:port-out', 'type:util', 'type:types'].includes(to),
    'type:port-in': ({ to }) => ['type:domain', 'type:types'].includes(to),
    'type:port-out': ({ to }) => ['type:domain', 'type:types'].includes(to),
    // UI may use its OWN slice's store (signals in templates). It may never
    // reach ports/out or a driven adapter — no HTTP from a component.
    'type:adapter-driving': ({ to }) =>
      ['type:domain', 'type:app', 'type:port-in', 'type:ui', 'type:util', 'type:types'].includes(to),
    'type:adapter-driven': ({ to }) =>
      ['type:domain', 'type:port-out', 'type:util', 'type:types'].includes(to),
    // the slice's wiring file: allowed to see both sides of its own hexagon
    'type:providers': ({ to }) => to.startsWith('type:'),
    'type:ui': ({ to }) => ['type:ui', 'type:util', 'type:types'].includes(to),
    'type:util': ({ to }) => ['type:util', 'type:types'].includes(to),
    'type:types': ({ to }) => to === 'type:types',

    // ---- SCOPE AXIS -----------------------------------------------------
    shared: ({ to }) => to === 'shared',

    // outer layers: own slice (incl. its core), any public port, or shared
    'domain:*': [
      ({ from, to }) => isSliceScope(to) && slice(from) === slice(to),
      ({ to }) => to === 'port' || to === 'shared',
    ],

    // the core: ONLY its own slice's core. Not shared, not ports, nothing.
    'core:*': ({ from, to }) =>
      to.startsWith('core:') && slice(from) === slice(to),
  },
};
