import { inject, Injectable, signal } from '@angular/core';
import { bookingConfirmed, BookingStore } from '@blueprint/booking/state';

/** Feat-private store; may use the slice's state (same slice family). */
@Injectable({ providedIn: 'root' })
export class CheckBookingStore {
  private readonly bookingStore = inject(BookingStore);

  readonly lastCheckedId = signal<string | null>(null);

  confirm(bookingId: string): void {
    this.lastCheckedId.set(bookingId);
    this.bookingStore.handle(bookingConfirmed(bookingId));
  }
}
