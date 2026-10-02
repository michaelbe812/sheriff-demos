import { computed, inject, Injectable, signal } from '@angular/core';
// Foreign domain ONLY via its public port. The port is a contract: this store
// binds to BookingApi and cannot see booking's HTTP client — that lives in
// booking/infra, which carries no `port` tag and is unreachable from here.
import { Booking, BookingApi } from '@blueprint/booking/api';
import { CheckinStore } from '@blueprint/checkin/state';
import { guestArrived } from '@blueprint/checkin/events';

/** Feat-private store: orchestrates the desk — arrivals in, check-ins out. */
@Injectable({ providedIn: 'root' })
export class CheckinDeskStore {
  private readonly bookingApi = inject(BookingApi);
  private readonly checkinStore = inject(CheckinStore);

  readonly arrivals = signal<Booking[]>([]);
  readonly openArrivals = computed(() => this.arrivals().length);

  async loadArrivals(): Promise<void> {
    this.arrivals.set(await this.bookingApi.loadBookings());
  }

  checkIn(booking: Booking): void {
    this.checkinStore.handle(guestArrived(booking.id, booking.guestName));
    this.arrivals.update((arrivals) => arrivals.filter((a) => a.id !== booking.id));
  }
}
