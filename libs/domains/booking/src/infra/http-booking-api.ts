import { Injectable } from '@angular/core';
import { BookingApi } from '../api';
import { Booking } from '../types/booking.model';

/**
 * The port's implementation (type:infra). Invisible outside this slice: the
 * bucket is not tagged `port`, so no foreign domain can reach it — they get
 * the contract in api/ and nothing else.
 *
 * Swap this for a GraphQL or in-memory variant by pointing the port's
 * `useFactory` at another class, or by overriding the token at the composition
 * root. No store, no component, no other domain moves.
 *
 * `implements`, not `extends`: the port imports THIS file to declare it as the
 * default, so `extends BookingApi` would need the base class as a VALUE at
 * class-definition time and blow up on the cycle. `implements` is checked by
 * the compiler only, so it still errors on signature drift.
 */
@Injectable({ providedIn: 'root' })
export class HttpBookingApi implements BookingApi {
  async loadBookings(): Promise<Booking[]> {
    const response = await fetch('/api/bookings');
    return (await response.json()) as Booking[];
  }
}
