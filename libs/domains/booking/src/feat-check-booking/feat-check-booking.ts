import { Component, inject } from '@angular/core';
import { BookingStore } from '../data/booking.store';
import { BookingConfirmed } from '../events/booking.events';
import { BookingCard } from '../ui/booking-card';
import { CheckBookingStore } from './data/check-booking.store';
import { CheckResult } from './ui/check-result';

/** Smart container: wires domain-shared + feat-private state into dumb ui. */
@Component({
  selector: 'app-feat-check-booking',
  imports: [BookingCard, CheckResult],
  template: `
    <h2>Check bookings</h2>
    @for (booking of bookingStore.all(); track booking.id) {
      <app-booking-card [booking]="booking" (confirmed)="onConfirmed($event)" />
    }
    <app-check-result [bookingId]="checkStore.lastCheckedId()" />
  `,
})
export class FeatCheckBooking {
  protected readonly bookingStore = inject(BookingStore);
  protected readonly checkStore = inject(CheckBookingStore);

  protected onConfirmed(event: BookingConfirmed): void {
    this.checkStore.confirm(event.bookingId);
  }
}
