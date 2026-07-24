import { Booking } from '../types/booking.model';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 *
 * CONTRACT ONLY — no implementation. The HTTP client lives in infra/ and is
 * wired at the slice root by provideBooking().
 *
 * Variant: ABSTRACT CLASS as the DI token (checkin/ uses the InjectionToken
 * variant — both are valid, see docs/architecture.md).
 *
 * An abstract class is one artifact instead of two: it is the type AND the
 * token. `inject(BookingApi)` reads like a normal class injection, and
 * `extends BookingApi` in infra/ still gives a compile error on drift.
 *
 * `abstract` is load-bearing: it makes the class non-instantiable, so nobody
 * can `new BookingApi()` or accidentally provide it as its own impl. Every
 * member stays abstract — the moment this file carried a method BODY it would
 * hold implementation, and `type:api` has no clearance towards `type:infra`
 * precisely to keep that out.
 */
export type { Booking } from '../types/booking.model';

export abstract class BookingApi {
  abstract loadBookings(): Promise<Booking[]>;
}
