/**
 * DELIBERATE VIOLATIONS — every ACTIVE import below is illegal by design.
 *
 * This file is excluded from tsconfig.app.json and imported by nobody, so it
 * never reaches the bundle. ESLint still sees it, which is the point.
 *
 * Uncomment ONE line, run `pnpm nx lint hexagonal-demo`, watch it fail, then
 * comment it back. `npx sheriff verify` will NOT catch these — the CLI walks
 * reachable imports from main.ts and this file is unreachable. ESLint is the
 * authoritative gate.
 *
 * FRAMEWORK-AWARE CORE variant: the core is `type:domain` and holds the store
 * and use-cases. It MAY know Angular. What stays illegal is reaching an
 * adapter (direct I/O) or another slice's internals.
 */

// ---------------------------------------------------------------------------
// 1. CROSS-SLICE INTERNALS — the flagship violation.
//    This module is ['domain:booking','type:domain']; the target is
//    ['domain:customer','type:domain']. The scope axis kills it: not the same
//    slice, and the target carries no `port` tag.
//    Expected: "from tag domain:booking to tags domain:customer, type:domain"
//
// import { CustomerStore } from '../../customer/domain/customer.store';

// ---------------------------------------------------------------------------
// 2. REACHING PAST A PORT into a foreign adapter.
//    Same axis, same reason — the port is the only door.
//
// import { InMemoryCustomerRepository } from '../../customer/adapters/driven/in-memory-customer.repository';

// ---------------------------------------------------------------------------
// 3. THE CORE REACHING ITS OWN DRIVEN ADAPTER — the boundary that survives.
//    Legal on the scope axis (same slice) but illegal on the type axis:
//    `type:domain` has no clearance towards `type:adapter-driven`. This is the
//    hexagon's remaining rule: the core names the PORT, never the impl. I/O
//    stays behind ports even though the core may now know Angular.
//    Expected: "from tag type:domain to tags domain:booking, type:adapter-driven"
//
// import { InMemoryBookingRepository } from '../adapters/driven/in-memory-booking.repository';

// ---------------------------------------------------------------------------
// NOT a violation anymore — the point of this variant:
//
//   import { InjectionToken, inject, signal } from '@angular/core';
//
// The strict hexagon forbade this in the core. Here it is allowed: the store
// and use-cases live in `domain/` and use Angular DI/signals freely. Only
// direct I/O (an adapter) is out of bounds. If you kept a no-restricted-imports
// rule against @angular/* on the core, DROP it for this variant — it would
// contradict the whole premise.

export {};
