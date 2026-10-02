import { Component, inject } from '@angular/core';
import { AuthStore } from '@blueprint/shared/state';
import { AppButton } from '@blueprint/shared/ui';
import { pluralize } from '@blueprint/shared/utils';
import { CheckinStore, guestArrived } from '@blueprint/checkin/state';
import { Arrival } from '@blueprint/checkin/types';
import { ArrivalList } from '@blueprint/checkin/ui';
import { CheckinDeskStore } from '@blueprint/checkin/feat-checkin/state';

// boundary-violation-example: import { BookingStore } from '@blueprint/booking/state'; // foreign slice (never, no port)
// boundary-violation-example: import { CheckBookingStore } from '@blueprint/booking/feat-check-booking/state'; // foreign feat

/** Smart container: domain store + feat-private desk store + shared auth + dumb ui. */
@Component({
  selector: 'app-feat-checkin',
  imports: [AppButton, ArrivalList],
  template: `
    <h2>Check-in desk</h2>
    @if (auth.user(); as user) {
      <p>Agent: {{ user.name }}</p>
    }
    <app-button (clicked)="desk.loadArrivals()">Load arrivals</app-button>
    <p>{{ desk.openArrivals() }} {{ arrivalsLabel }}</p>
    @for (arrival of desk.arrivals(); track arrival.bookingId) {
      <app-button (clicked)="desk.checkIn(arrival)">Check in {{ arrival.guestName }}</app-button>
    }
    <h3>Checked in today ({{ checkinStore.count() }})</h3>
    <app-arrival-list [records]="checkinStore.all()" (arrived)="onWalkIn($event)" />
  `,
})
export class FeatCheckin {
  protected readonly auth = inject(AuthStore);
  protected readonly desk = inject(CheckinDeskStore);
  protected readonly checkinStore = inject(CheckinStore);

  protected get arrivalsLabel(): string {
    return pluralize(this.desk.openArrivals(), 'arrival', 'arrivals');
  }

  protected onWalkIn(arrival: Arrival): void {
    this.checkinStore.handle(guestArrived(arrival.bookingId, arrival.guestName));
  }
}
