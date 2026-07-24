import { Injectable } from '@angular/core';
import { BookingApi } from '../api/booking-api';
import { Booking } from '../types/booking.model';

/**
 * The port's implementation (type:infra). Invisible outside this slice: the
 * bucket is not tagged `port`, so no foreign domain can reach it — they get
 * the contract in api/ and nothing else.
 *
 * Swap this for a GraphQL or in-memory variant by changing one line in
 * booking.providers.ts. No store, no component, no other domain moves.
 */
@Injectable({ providedIn: 'root' })
export class HttpBookingApi extends BookingApi {
  async loadBookings(): Promise<Booking[]> {
    const response = await fetch('/api/bookings');
    return (await response.json()) as Booking[];
  }
}
