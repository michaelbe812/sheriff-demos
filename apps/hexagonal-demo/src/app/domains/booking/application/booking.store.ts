import { computed, inject, Injectable, signal } from '@angular/core';
import { Booking, BookingId, GuestRef, totalPrice } from '../domain/booking';
import { BOOKING_REPOSITORY } from '../ports/out/booking-repository.port';
import { BookRoomUseCase } from './book-room.use-case';
import { CancelBookingUseCase } from './cancel-booking.use-case';

/**
 * Application state for the booking screens. Orchestrates use-cases and holds
 * what the UI renders.
 *
 * Store events, if you add them (`bookingConfirmed`, `bookingCancelled`),
 * belong here too — they are application vocabulary, not domain invariants.
 * Should another slice ever need one, promote THAT event into ports/in
 * deliberately; the tag system will force the decision rather than let it drift.
 */
@Injectable()
export class BookingStore {
  readonly #bookings = inject(BOOKING_REPOSITORY);
  readonly #bookRoom = inject(BookRoomUseCase);
  readonly #cancelBooking = inject(CancelBookingUseCase);

  readonly #items = signal<Booking[]>([]);
  readonly #error = signal<string | null>(null);

  readonly items = this.#items.asReadonly();
  readonly error = this.#error.asReadonly();
  readonly revenue = computed(() =>
    this.#items()
      .filter((booking) => booking.status === 'confirmed')
      .reduce((sum, booking) => sum + totalPrice(booking), 0),
  );

  async load(): Promise<void> {
    this.#items.set(await this.#bookings.findAll());
  }

  async book(guest: GuestRef, room: string, nights: number): Promise<void> {
    this.#error.set(null);
    try {
      await this.#bookRoom.execute({ guest, room, nights, baseRate: 120 });
      await this.load();
    } catch (error) {
      this.#error.set((error as Error).message);
    }
  }

  async cancel(id: BookingId): Promise<void> {
    this.#error.set(null);
    try {
      await this.#cancelBooking.execute(id);
      await this.load();
    } catch (error) {
      this.#error.set((error as Error).message);
    }
  }
}
