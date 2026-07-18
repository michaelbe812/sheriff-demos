import { anyTag, sameTag, SheriffConfig } from '@lambda-solutions/sheriff-core';

/**
 * Ports & Adapters (hexagonal) — one hexagon PER SLICE.
 *
 * Blueprint app: apps/hexagonal-demo (booking + customer).
 *
 * Requires the @lambda-solutions Sheriff fork (v1+) for `denyRules`. Against
 * upstream @softarc 0.19.x this config would need the `core:<slice>` scope
 * workaround instead — see the git history of this file for that version.
 *
 * ---------------------------------------------------------------------------
 * TWO TAG AXES, combined with AND semantics (every source tag must allow the
 * import; a single source tag is satisfied if ANY target tag matches it):
 *
 *   scope:  domain:<slice>  a slice (core AND outer layers share one scope)
 *           shared          dumb, app-wide
 *           app:<app>       composition root
 *   type:   domain | app | port-in | port-out | adapter-driving |
 *           adapter-driven | providers | ui | util | types
 *   marker: entry (routes/providers) | port (public, cross-slice reachable)
 *
 * ---------------------------------------------------------------------------
 * WHY THE CORE IS SEALED WITH A denyRule (not a scope trick):
 *
 * The domain core must import NOTHING but its own core. Two engine facts make
 * that hard to express with allow-rules alone:
 *
 *   1. `depRules` keys are OR-combined — every key whose wildcard matches the
 *      source tag is evaluated, and any one returning true allows the import.
 *      A permissive key therefore only ever WIDENS; it can never restrict.
 *   2. The core carries two tags (`domain:<slice>` + `type:domain`). The
 *      `type:domain` allow-rule can be made strict, but the `domain:*` rule —
 *      which the outer layers need — would still grant the core `shared` and
 *      any `port`. `type:domain` cannot veto what `domain:*` grants.
 *
 * The previous version dodged this by giving the core its OWN scope tag
 * `core:<slice>`, so `domain:*` never matched it. That cost a whole extra
 * axis: an `isSliceScope()` helper, a `core:*` rule, and every "reach the
 * core" rule had to name `core:` explicitly.
 *
 * `denyRules` removes all of that. The core is now a normal `domain:<slice>`
 * module; a single deny seals it. A denyRule is checked AFTER depRules and
 * wins over any allow — deny beats allow — and it is evaluated per source tag,
 * so the `type:domain` deny fires no matter what `domain:<slice>` permits.
 * That is exactly the veto the allow-only model lacked.
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

/** `domain:booking` -> `booking` */
const slice = (tag: string) => tag.split(':')[1];

const hexSlice = (path: string, name: string) => ({
  // slice root: <slice>.routes.ts — the only thing app.routes.ts may see
  [path]: [`domain:${name}`, 'entry'],
  // the core is a normal domain:<slice> module now — the denyRule seals it
  [`${path}/domain`]: [`domain:${name}`, 'type:domain'],
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

    // a slice reaches: its own scope (core + outer layers), any public port,
    // or shared. The core lives in this scope too now — the denyRule below is
    // what keeps it from using the `port`/`shared` clearance this rule grants.
    'domain:*': [
      ({ from, to }) => to.startsWith('domain:') && slice(from) === slice(to),
      ({ to }) => to === 'port' || to === 'shared',
    ],
  },

  // ---- DENY: the core imports nothing but its own domain layer ----------
  // Checked after depRules; a match always wins. Evaluated per source tag, so
  // this fires on the `type:domain` tag regardless of what the `domain:<slice>`
  // tag was granted above. This single rule replaces the entire `core:*` axis.
  denyRules: {
    'type:domain': ({ to }) => to !== 'type:domain',
  },
};
