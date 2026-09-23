import { Booking } from '@blueprint/booking/types';

/**
 * PUBLIC PORT of the booking domain (tag `port`): the only lib other scopes
 * may import. Cross-domain needed types are re-exported here — the types lib
 * itself stays private.
 *
 * CONTRACT ONLY — the implementation (HttpBookingApi, type:infra) is wired at
 * the slice root (booking/shell) by provideBooking(). The port cannot name
 * its own impl: `type:api` has no clearance towards `type:infra`, and
 * api -> infra -> api would be a project cycle anyway.
 *
 * Variant: ABSTRACT CLASS as the DI token (checkin/ uses the InjectionToken
 * variant — both are valid, see docs/architecture.md). One artifact instead of
 * two: it is the type AND the token, and `inject(BookingApi)` reads like a
 * normal class injection.
 *
 * `abstract` is load-bearing: it makes the class non-instantiable, so nobody
 * can `new BookingApi()`. Every member stays abstract — the contract never
 * contains an implementation.
 */
export type { Booking } from '@blueprint/booking/types';

export abstract class BookingApi {
  abstract loadBookings(): Promise<Booking[]>;
}
