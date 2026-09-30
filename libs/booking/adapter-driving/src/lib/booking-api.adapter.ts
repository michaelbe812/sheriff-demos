import { inject, Injectable } from '@angular/core';
import { BookingStore } from '@hex/booking/domain';
import { Booking } from '@hex/booking/model';
import { BookingApiPort } from '@hex/booking/port-in';

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
