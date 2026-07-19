import { anyTag, sameTag, SheriffConfig } from '@softarc/sheriff-core';

/**
 * Ports & Adapters (hexagonal), FRAMEWORK-AWARE CORE variant — one hexagon
 * per slice, but the core is allowed to know Angular.
 *
 * Blueprint app: apps/hexagonal-demo (booking + customer).
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED vs the strict variant, and why:
 *
 * The strict hexagon kept the domain core framework-free: no Angular, no DI,
 * no signals. That forced a separate `application/` layer to hold anything
 * that needed `inject()` (use-cases, the signal store), and it sealed the core
 * with its own `core:<slice>` scope so nothing could leak in.
 *
 * Here we drop the framework-free rule. The core MAY use `@angular/core` — DI,
 * signals, InjectionToken. Two consequences:
 *
 *   1. `application/` collapses into `domain/`. The only reason it existed was
 *      that the core couldn't `inject()`. Now use-cases and the signal store
 *      live in `domain/` alongside the models and rules — domain logic and the
 *      state that serves it, together.
 *
 *   2. The `core:<slice>` scope and its sealing rule are gone. The core is a
 *      normal `domain:<slice>` module. No `denyRules`, no separate scope axis.
 *
 * WHAT STAYS — this is still Ports & Adapters, not a plain layered app:
 *   I/O is still behind ports. The core may name `ports/out` tokens but MUST
 *   NOT reach a driven adapter (HTTP, the clock) directly. That boundary is
 *   about *I/O*, not framework — so `new Date()` and `fetch` still live in
 *   adapters, and the core stays testable by injecting fakes for its ports.
 *
 * ---------------------------------------------------------------------------
 * TWO TAG AXES, combined with AND semantics (every source tag must allow the
 * import; a single source tag is satisfied if ANY target tag matches it):
 *
 *   scope:  domain:<slice>  a slice
 *           shared          dumb, app-wide
 *           app:<app>       composition root
 *   type:   domain | port-in | port-out | adapter-driving |
 *           adapter-driven | providers | ui | util | types
 *   marker: entry (routes/providers) | port (public, cross-slice reachable)
 *
 * Note there is no `type:app` anymore — the application layer merged into
 * `type:domain`.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO '*' CATCH-ALL RULE — load-bearing, not style:
 *
 * `isDependencyAllowed` (0.19.6) evaluates EVERY depRules key whose wildcard
 * matches the source tag and OR's the results — a permissive `'*'` would grant
 * clearance via the scope tag and bypass the type axis. So `shared` clearance
 * rides on the TYPE axis, where each type rule decides for itself.
 *
 * ---------------------------------------------------------------------------
 * THE HEXAGON (what each rule buys):
 *
 *   domain/      the core: models, rules, use-cases AND the signal store.
 *                MAY use Angular DI/signals. MAY name its own ports. MUST NOT
 *                reach an adapter (no direct I/O) or another slice's internals.
 *   ports/in     public face of the slice (`port`) — the ONLY cross-slice surface.
 *   ports/out    what the core needs from the world (repo, clock). Private.
 *   adapters/driving  UI. Sees the domain (store) + ports/in. NEVER ports/out or HTTP.
 *   adapters/driven   HTTP, clock, SDKs. Implements ports/out. The impure edge.
 *   ports/*.providers.ts  slice composition root — wires an adapter onto a port.
 */

/** `domain:booking` -> `booking` */
const slice = (tag: string) => tag.split(':')[1];

const hexSlice = (path: string, name: string) => ({
  // slice root: <slice>.routes.ts — the only thing app.routes.ts may see
  [path]: [`domain:${name}`, 'entry'],
  // the core: models + rules + use-cases + store. A normal domain:<slice>
  // module now — it may know Angular, it just can't reach an adapter.
  [`${path}/domain`]: [`domain:${name}`, 'type:domain'],
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

    entry: anyTag,
    port: anyTag,

    'app:*': [
      sameTag,
      ({ to }) => to === 'entry' || to === 'port' || to === 'shared',
    ],

    // ---- TYPE AXIS ------------------------------------------------------
    // The core now holds use-cases + store, so it may reach its own ports
    // (in and out), shared helpers, and pure types. It may NOT reach an
    // adapter — that is the I/O boundary the hexagon still enforces.
    'type:domain': ({ to }) =>
      ['type:domain', 'type:port-in', 'type:port-out', 'type:util', 'type:types'].includes(to),
    'type:port-in': ({ to }) => ['type:domain', 'type:types'].includes(to),
    'type:port-out': ({ to }) => ['type:domain', 'type:types'].includes(to),
    // UI may use its OWN slice's domain (the store lives there now) and
    // ports/in. It may never reach ports/out or a driven adapter — no HTTP
    // from a component.
    'type:adapter-driving': ({ to }) =>
      ['type:domain', 'type:port-in', 'type:ui', 'type:util', 'type:types'].includes(to),
    'type:adapter-driven': ({ to }) =>
      ['type:domain', 'type:port-out', 'type:util', 'type:types'].includes(to),
    // the slice's wiring file: allowed to see both sides of its own hexagon
    'type:providers': ({ to }) => to.startsWith('type:'),
    'type:ui': ({ to }) => ['type:ui', 'type:util', 'type:types'].includes(to),
    'type:util': ({ to }) => ['type:util', 'type:types'].includes(to),
    'type:types': ({ to }) => to === 'type:types',

    // ---- SCOPE AXIS -----------------------------------------------------
    shared: ({ to }) => to === 'shared',

    // a slice reaches its own scope, any public port, or shared.
    'domain:*': [
      ({ from, to }) => to.startsWith('domain:') && slice(from) === slice(to),
      ({ to }) => to === 'port' || to === 'shared',
    ],
  },
};
