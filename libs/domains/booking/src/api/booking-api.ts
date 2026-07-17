import { InjectionToken } from '@angular/core';
import { Booking } from '../types/booking.model';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 *
 * CONTRACT ONLY — no implementation, mirroring the auth shared-feature.
 * Consumers inject BOOKING_API and bind to this interface; the HTTP client
 * lives in infra/ and is wired at the slice root by provideBooking().
 *
 * Why: the previous version exported a concrete @Injectable with
 * `fetch('/api/bookings')` inside, so every consumer — including the checkin
 * domain across the slice boundary — depended on that class. The dependency
 * arrow pointed *at* infrastructure and there was no seam: no fake for tests,
 * no swap to GraphQL without touching callers. `type:api` now has no
 * clearance towards `type:infra`, which makes the inversion structural rather
 * than a matter of discipline.
 */
export type { Booking } from '../types/booking.model';

export interface BookingApi {
  loadBookings(): Promise<Booking[]>;
}

export const BOOKING_API = new InjectionToken<BookingApi>('BOOKING_API');
