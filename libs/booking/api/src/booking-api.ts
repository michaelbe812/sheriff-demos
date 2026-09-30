import { Injectable } from '@angular/core';
import { Booking } from '@blueprint/booking/types';

/**
 * PUBLIC PORT of the booking domain: the only module other domains may
 * import. Cross-domain needed types are re-exported here — the types bucket
 * itself stays private.
 */
export type { Booking } from '@blueprint/booking/types';

@Injectable({ providedIn: 'root' })
export class BookingApi {
  async loadBookings(): Promise<Booking[]> {
    const response = await fetch('/api/bookings');
    if (!response.ok) {
      throw new Error(`GET /api/bookings failed: ${response.status}`);
    }
    return (await response.json()) as Booking[];
  }
}
