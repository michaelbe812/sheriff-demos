import { inject, Injectable } from '@angular/core';
import { Booking, GuestRef, toBookingId } from '../domain/booking';
import { validateStay } from '../domain/booking-policy';
import { BOOKING_REPOSITORY } from '../ports/out/booking-repository.port';
import { BOOKING_CLOCK } from '../ports/out/booking-clock.port';
import { CUSTOMER_API } from '../../customer/ports/in/customer-api.port';

/**
 * USE-CASE 1 — book a room.
 *
 * ---------------------------------------------------------------------------
 * THE CROSS-SLICE CALL, and why Sheriff permits exactly this one:
 *
 *   inject(CUSTOMER_API) targets `customer/ports/in`, tagged
 *   ['domain:customer', 'type:port-in', 'port'].
 *
 *   This module is tagged ['domain:booking', 'type:app']. Both source tags
 *   must independently allow it (AND semantics):
 *     - domain:booking -> not the same slice, BUT target carries `port` => ok
 *     - type:app       -> target carries type:port-in                  => ok
 *
 *   Point the import at `customer/application/customer.store` instead and the
 *   scope axis fails: no `port` tag, different slice. That is the mechanism —
 *   booking may call customer, but only through its front door.
 *
 * The draft of this file also imported `toCustomerId` from customer's core to
 * build the argument. Sheriff refused (`core:customer` is sealed) and it was
 * right: a port you cannot call without reaching into the core is not a
 * boundary. The port now speaks plain strings and brands them on its own side.
 *
 * What booking sees:      CustomerApiPort, CustomerSummary, LoyaltyTier
 * What booking never sees: CustomerStore, LoadCustomerUseCase, Customer,
 *                          CUSTOMER_REPOSITORY, InMemoryCustomerRepository
 */
@Injectable()
export class BookRoomUseCase {
  readonly #bookings = inject(BOOKING_REPOSITORY);
  readonly #clock = inject(BOOKING_CLOCK);
  readonly #customers = inject(CUSTOMER_API);

  async execute(input: {
    guest: GuestRef;
    room: string;
    nights: number;
    baseRate: number;
  }): Promise<Booking> {
    const refusal = validateStay(input.nights);
    if (refusal) {
      throw new Error(`Cannot book: ${refusal}`);
    }

    if (!(await this.#customers.exists(input.guest))) {
      throw new Error('Cannot book: unknown guest');
    }

    // The cross-slice payoff: pricing depends on the customer's loyalty tier,
    // computed by customer's OWN domain rules behind its port. Booking never
    // learns how a tier is derived — only what the discount is.
    const discountPercent = await this.#customers.discountPercentFor(input.guest);

    const booking: Booking = {
      id: toBookingId(`b-${this.#clock.now().getTime()}`),
      guest: input.guest,
      room: input.room,
      nights: input.nights,
      baseRate: input.baseRate,
      discountPercent,
      status: 'confirmed',
    };

    await this.#bookings.save(booking);
    return booking;
  }
}
