import { Component, inject } from '@angular/core';
import { BookingStore } from '@blueprint/booking/state';
import { BookingCard } from '@blueprint/booking/ui';
import { CheckBookingStore } from '@blueprint/booking/feat-check-booking/state';
import { CheckResult } from '@blueprint/booking/feat-check-booking/ui';

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

  protected onConfirmed(bookingId: string): void {
    this.checkStore.confirm(bookingId);
  }
}
