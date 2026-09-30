import { Injectable } from '@angular/core';
import { Booking, BookingId } from '@hex/booking/model';
import { BookingRepositoryPort } from '@hex/booking/port-out';

/** Driven adapter. Replace with an HttpClient version — nothing inward moves. */
@Injectable()
export class InMemoryBookingRepository implements BookingRepositoryPort {
  readonly #store = new Map<BookingId, Booking>();

  async save(booking: Booking): Promise<void> {
    this.#store.set(booking.id, booking);
  }

  async findById(id: BookingId): Promise<Booking | null> {
    return this.#store.get(id) ?? null;
  }

  async findAll(): Promise<Booking[]> {
    return [...this.#store.values()];
  }
}
