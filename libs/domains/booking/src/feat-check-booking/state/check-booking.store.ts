import { inject, Injectable, signal } from '@angular/core';
import { BookingStore } from '../../state/booking.store';
import { bookingConfirmed } from '../../events/booking.events';

/** Feat-private store; may use domain-shared state (same slice family). */
@Injectable({ providedIn: 'root' })
export class CheckBookingStore {
  private readonly bookingStore = inject(BookingStore);

  readonly lastCheckedId = signal<string | null>(null);

  confirm(bookingId: string): void {
    this.lastCheckedId.set(bookingId);
    this.bookingStore.handle(bookingConfirmed(bookingId));
  }
}
