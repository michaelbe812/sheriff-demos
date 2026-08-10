import { Booking } from '../types/booking.model';
import { inject, Injectable } from '@angular/core';
import { HttpBookingApi } from '../infra/http-booking-api';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 *
 * SELF-PROVIDING PORT: the contract declares its own DEFAULT implementation
 * via `useFactory`, so consuming this domain needs no providers file and no
 * `provideBooking()` in the composition root. `inject(BookingApi)` just works;
 * an explicit provider (tests, a GraphQL variant) still wins, because explicit
 * providers beat `providedIn: 'root'`.
 *
 * The trade, stated plainly: this file imports infra/, so the arrow points at
 * infrastructure and the relation is LAYERED, not inverted. Substitutability
 * survives — consumers name only the token — but the contract is no longer
 * ignorant of its impl, and api/ <-> infra/ is a real import cycle that works
 * because classes hoist. Foreign domains are unaffected: infra/ carries no
 * `port` tag, so the scope axis still keeps them out.
 *
 * Variant: ABSTRACT CLASS as the DI token (checkin/ uses the InjectionToken
 * variant — both are valid, see docs/architecture.md). One artifact instead of
 * two: it is the type AND the token, and `inject(BookingApi)` reads like a
 * normal class injection.
 *
 * `abstract` is load-bearing: it makes the class non-instantiable, so nobody
 * can `new BookingApi()`. Every member stays abstract — the contract declares
 * WHICH impl is the default, it never contains one.
 */
export type { Booking } from '../types/booking.model';

@Injectable({
  providedIn: 'root',
  useFactory: (): BookingApi => inject(HttpBookingApi),
})
export abstract class BookingApi {
  abstract loadBookings(): Promise<Booking[]>;
}
