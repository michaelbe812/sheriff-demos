import { inject, Injectable } from '@angular/core';
import { Booking } from '../../domain/booking';
import { BookingApiPort } from '../../ports/in/booking-api.port';
import { BookingStore } from '../../domain/booking.store';

/**
 * Serves booking's public port to any future slice.
 *
 * It goes through the application layer, NOT through BOOKING_REPOSITORY — the
 * first draft did the latter and Sheriff rejected it: `type:adapter-driving`
 * has no clearance towards `type:port-out`. A driving adapter sits on the
 * outside of the hexagon; persistence is the far side, reachable only through
 * application/. The rule was right and the code was wrong.
 */
@Injectable()
export class BookingApiAdapter implements BookingApiPort {
  readonly #store = inject(BookingStore);

  async bookingsOfGuest(guest: string): Promise<Booking[]> {
    await this.#store.load();
    return this.#store.items().filter((booking) => booking.guest === guest);
  }
}
