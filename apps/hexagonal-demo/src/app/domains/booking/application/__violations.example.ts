/**
 * DELIBERATE VIOLATIONS — every import below is illegal by design.
 *
 * This file is excluded from tsconfig.app.json and imported by nobody, so it
 * never reaches the bundle. ESLint still sees it, which is the point.
 *
 * Uncomment ONE line, run `pnpm nx lint hexagonal-demo`, watch it fail, then
 * comment it back. `npx sheriff verify` will NOT catch these — the CLI walks
 * reachable imports from main.ts and this file is unreachable. ESLint is the
 * authoritative gate.
 */

// ---------------------------------------------------------------------------
// 1. CROSS-SLICE INTERNALS — the flagship violation.
//    This module is ['domain:booking','type:app']; the target is
//    ['domain:customer','type:app']. The scope axis kills it: not the same
//    slice, and the target carries no `port` tag.
//    Expected: "module .../booking/application cannot access
//               .../customer/application"
//
// import { CustomerStore } from '../../customer/application/customer.store';

// ---------------------------------------------------------------------------
// 2. REACHING PAST A PORT into a foreign adapter.
//    Same axis, same reason — proves the port is the only door, not merely
//    the recommended one.
//
// import { InMemoryCustomerRepository } from '../../customer/adapters/driven/in-memory-customer.repository';

// ---------------------------------------------------------------------------
// 3. USE-CASE REACHING ITS OWN DRIVEN ADAPTER.
//    Legal on the scope axis (same slice!) but illegal on the type axis:
//    `type:app` has no clearance towards `type:adapter-driven`. This is the
//    inversion itself — the use-case must name the port, not the impl.
//
// import { InMemoryBookingRepository } from '../adapters/driven/in-memory-booking.repository';

// ---------------------------------------------------------------------------
// The remaining two live where they belong, as comments at their own site:
//
// 4. UI -> driven adapter (HTTP from a component):
//    see adapters/driving/booking-page.ts
//
// 5. Domain core -> Angular:
//    add `import { Injectable } from '@angular/core';` to domain/booking.ts.
//    Caught by the no-restricted-imports block in eslint.config.mjs, NOT by
//    Sheriff — node_modules imports fall outside the tag system. That gap is
//    the one place the axes cannot cover alone.

export {};
