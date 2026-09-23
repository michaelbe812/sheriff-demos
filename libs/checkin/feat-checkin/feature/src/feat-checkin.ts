import { Component, inject } from '@angular/core';
// Shared-feature ONLY via its port:
import { AUTH_API } from '../../../auth/api/auth-api';
import { AppButton } from '../../../shared/ui/button';
import { pluralize } from '../../../shared/utils/pluralize';
import { CheckinStore } from '../data/checkin.store';
import { GuestArrived } from '../events/checkin.events';
import { ArrivalList } from '../ui/arrival-list';
import { CheckinDeskStore } from './data/checkin-desk.store';

// sheriff-violation-example: import { BookingStore } from '@blueprint/domains/booking/data/booking.store'; // foreign domain internals
// sheriff-violation-example: import { AuthStore } from '../../../auth/data/auth.store'; // shared-feature internals

/** Smart container: domain store + feat-private desk store + dumb ui. */
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
    @for (booking of desk.arrivals(); track booking.id) {
      <app-button (clicked)="desk.checkIn(booking)">Check in {{ booking.guestName }}</app-button>
    }
    <h3>Checked in today ({{ checkinStore.count() }})</h3>
    <app-arrival-list [records]="checkinStore.all()" (arrived)="onWalkIn($event)" />
  `,
})
export class FeatCheckin {
  protected readonly auth = inject(AUTH_API);
  protected readonly desk = inject(CheckinDeskStore);
  protected readonly checkinStore = inject(CheckinStore);

  protected get arrivalsLabel(): string {
    return pluralize(this.desk.openArrivals(), 'arrival', 'arrivals');
  }

  protected onWalkIn(event: GuestArrived): void {
    this.checkinStore.handle(event);
  }
}
