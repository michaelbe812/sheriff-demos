import { computed, inject, Injectable, signal } from '@angular/core';
import { CheckinApi, CheckinStore, guestArrived } from '@blueprint/checkin/data';
import { Arrival } from '@blueprint/checkin/types';

// boundary-violation-example: import { BookingApi } from '@blueprint/booking/data'; // foreign slice (never, no port)

/** Feat-private store: orchestrates the desk — arrivals in, check-ins out. */
@Injectable({ providedIn: 'root' })
export class CheckinDeskStore {
  private readonly api = inject(CheckinApi);
  private readonly checkinStore = inject(CheckinStore);

  readonly arrivals = signal<Arrival[]>([]);
  readonly openArrivals = computed(() => this.arrivals().length);

  async loadArrivals(): Promise<void> {
    this.arrivals.set(await this.api.loadArrivals());
  }

  checkIn(arrival: Arrival): void {
    this.checkinStore.handle(guestArrived(arrival.bookingId, arrival.guestName));
    this.arrivals.update((arrivals) => arrivals.filter((a) => a.bookingId !== arrival.bookingId));
  }
}
