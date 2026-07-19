import { inject, Injectable } from '@angular/core';
import { Booking, BookingId } from './booking';
import { canCancel, cancel } from './booking-policy';
import { BOOKING_REPOSITORY } from '../ports/out/booking-repository.port';

/**
 * USE-CASE 2 — cancel a booking.
 *
 * Note the division of labour: the *decision* (may this be cancelled?) and the
 * *transition* live in domain/booking-policy.ts as pure functions. This class
 * only orchestrates: load, ask the domain, persist. That is the heuristic in
 * practice — needs inject() ⇒ not domain.
 */
@Injectable()
export class CancelBookingUseCase {
  readonly #bookings = inject(BOOKING_REPOSITORY);

  async execute(id: BookingId): Promise<Booking> {
    const booking = await this.#bookings.findById(id);
    if (!booking) {
      throw new Error('Cannot cancel: unknown booking');
    }
    if (!canCancel(booking)) {
      throw new Error('Cannot cancel: already cancelled');
    }

    const cancelled = cancel(booking);
    await this.#bookings.save(cancelled);
    return cancelled;
  }
}
