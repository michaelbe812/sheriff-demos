import { inject, Injectable } from '@angular/core';
import { Booking, GuestRef, toBookingId } from './booking';
import { validateStay } from './booking-policy';
import { BOOKING_CLOCK, BOOKING_REPOSITORY } from '@hex/booking/port-out';
import { CUSTOMER_API } from '@hex/customer/port-in';

/**
 * USE-CASE 1 — book a room.
 *
 * ---------------------------------------------------------------------------
 * THE CROSS-SLICE CALL, and why Nx permits exactly this one:
 *
 *   inject(CUSTOMER_API) targets lib `customer-port-in`, tagged
 *   ['scope:customer', 'type:port-in', 'port'].
 *
 *   This lib is tagged ['scope:booking', 'type:domain']. Every matching
 *   constraint must allow it (AND semantics):
 *     - scope:booking -> not the same slice, BUT target carries `port` => ok
 *     - type:domain   -> target carries type:port-in                  => ok
 *
 *   Point the import at `@hex/customer/domain` instead and the
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
