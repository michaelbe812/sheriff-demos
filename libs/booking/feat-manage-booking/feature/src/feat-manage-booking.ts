import { Component, inject } from '@angular/core';
import { BookingStore } from '@blueprint/booking/data';
// Sibling feat ONLY via its feat-port:
import { describeCheck } from '@blueprint/booking/feat-check-booking/api';
import { BookingCard } from '@blueprint/booking/ui';

// boundary-violation-example: import { CheckBookingStore } from '@blueprint/booking/feat-check-booking/data'; // sibling feat internals

@Component({
  selector: 'app-feat-manage-booking',
  imports: [BookingCard],
  template: `
    <h2>Manage bookings</h2>
    @for (booking of bookingStore.confirmed(); track booking.id) {
      <app-booking-card [booking]="booking" />
    }
    <p>{{ lastCheck }}</p>
  `,
})
export class FeatManageBooking {
  protected readonly bookingStore = inject(BookingStore);

  protected readonly lastCheck = describeCheck({
    bookingId: 'b2',
    checkedAt: new Date().toISOString(),
  });
}
