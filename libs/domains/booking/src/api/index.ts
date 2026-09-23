import { Booking } from '../types/booking.model';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 *
 * CONTRACT ONLY — the implementation (HttpBookingApi, type:infra) is wired at
 * the slice root by provideBooking(). The port cannot name its own impl: that
 * is the inversion (and, once api/ and infra/ are separate Nx libs, the only
 * option — api -> infra -> api would be a project cycle).
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
export type { Booking } from '../types/booking.model';

export abstract class BookingApi {
  abstract loadBookings(): Promise<Booking[]>;
}
