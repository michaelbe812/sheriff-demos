import { Injectable } from '@angular/core';
import { BookingApi } from '@blueprint/booking/api';
import { Booking } from '@blueprint/booking/types';

/**
 * The port's implementation (type:infra). Invisible outside this slice: the
 * lib is not tagged `port`, so no foreign scope can reach it — they get the
 * contract in booking/api and nothing else.
 *
 * Swap this for a GraphQL or in-memory variant by changing provideBooking()
 * at the slice root. No store, no component, no other domain moves.
 */
@Injectable({ providedIn: 'root' })
export class HttpBookingApi implements BookingApi {
  async loadBookings(): Promise<Booking[]> {
    const response = await fetch('/api/bookings');
    return (await response.json()) as Booking[];
  }
}
