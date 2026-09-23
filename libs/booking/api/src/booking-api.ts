import { Injectable } from '@angular/core';
import { Booking } from '../types/booking.model';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 */
export type { Booking } from '../types/booking.model';

@Injectable({ providedIn: 'root' })
export class BookingApi {
  async loadBookings(): Promise<Booking[]> {
    const response = await fetch('/api/bookings');
    return (await response.json()) as Booking[];
  }
}
