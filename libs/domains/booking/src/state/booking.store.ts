import { computed, inject, Injectable, signal } from '@angular/core';
import { BookingApi } from '../api';
import { BookingConfirmed } from '../events/booking.events';
import { Booking } from '../types/booking.model';
import { isConfirmed } from '../utils/booking.utils';

/** Domain-shared store: usable by feature containers, never by ui. */
@Injectable({ providedIn: 'root' })
export class BookingStore {
  // binds to the ABSTRACT class, not the impl — the store cannot name
  // HttpBookingApi even if it wanted to (type:state has no clearance towards
  // type:infra). BookingApi is abstract, so this resolves to the port's own
  // default impl, or to whatever an explicit provider overrode it with.
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
