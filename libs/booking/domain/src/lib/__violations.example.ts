/**
 * DELIBERATE VIOLATIONS — every import below is illegal by design.
 *
 * Not exported from index.ts, so nothing imports it and it never reaches the
 * bundle. Uncomment ONE line, run `pnpm exec nx lint booking-domain`, watch it
 * fail. All three (and more) run permanently in `node tools/verify-boundaries.mjs`.
 *
 * This lib is ['scope:booking', 'type:domain']. Every constraint matching one
 * of those tags is checked; each can fail the import on its own.
 */

// ---------------------------------------------------------------------------
// 1. CROSS-SLICE INTERNALS — the flagship violation.
//    Target customer-domain is ['scope:customer', 'type:domain']: the
//    scope:booking constraint only allows scope:booking | port | scope:shared.
//    Expected: 'A project tagged with "scope:booking" can only depend on libs
//    tagged with "scope:booking", "port", "scope:shared"'
//
// import { CustomerStore } from '@hex/customer/domain';

// ---------------------------------------------------------------------------
// 2. REACHING PAST A PORT into a foreign adapter. Scope fails as above; the
//    type:domain constraint fails too (adapter).
//
// import { InMemoryCustomerRepository } from '@hex/customer/adapter-driven';

// ---------------------------------------------------------------------------
// 3. THE CORE REACHING ITS OWN DRIVEN ADAPTER. Same scope, but type:domain
//    may not depend on /^type:adapter-/ — not even transitively. Nx reports
//    it as a circular dependency first (the adapter already imports the
//    domain); with the cycle check off, the tag constraint fires.
//
// import { InMemoryBookingRepository } from '@hex/booking/adapter-driven';

// ---------------------------------------------------------------------------
// 4. DIRECT I/O IN THE CORE — new with Nx, Sheriff upstream cannot express it.
//    type:domain has `allowedExternalImports` = @angular/core + plain rxjs.
//    Expected: 'A project tagged with "type:domain" is not allowed to import
//    "@angular/common/http"'
//
// import { HttpClient } from '@angular/common/http';

// ---------------------------------------------------------------------------
// NOT a violation — the point of the framework-aware core:
//
//   import { InjectionToken, inject, signal } from '@angular/core';

export {};
