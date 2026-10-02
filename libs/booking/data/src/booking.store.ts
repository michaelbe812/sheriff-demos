import { computed, inject, Injectable, signal } from '@angular/core';
import { Booking } from '@blueprint/booking/types';
import { isConfirmed } from '@blueprint/booking/utils';
import { BookingApi } from './booking-api';
import { BookingConfirmed } from './booking.events';

/** Domain-shared store: usable by feature containers, never by ui. */
@Injectable({ providedIn: 'root' })
export class BookingStore {
  private readonly api = inject(BookingApi);
  private readonly bookings = signal<Booking[]>([
    { id: 'b1', guestName: 'Ada Lovelace', checkinDate: '2026-08-01', status: 'pending' },
    { id: 'b2', guestName: 'Grace Hopper', checkinDate: '2026-08-03', status: 'confirmed' },
  ]);

  readonly all = this.bookings.asReadonly();
  readonly confirmed = computed(() => this.bookings().filter(isConfirmed));

  async load(): Promise<void> {
    this.bookings.set(await this.api.loadBookings());
  }

  handle(event: BookingConfirmed): void {
    this.bookings.update((bookings) =>
      bookings.map((booking) =>
        booking.id === event.bookingId ? { ...booking, status: 'confirmed' as const } : booking,
      ),
    );
  }
}
