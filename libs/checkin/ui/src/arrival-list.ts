import { Component, input, output } from '@angular/core';
import { Arrival, CheckinRecord } from '@blueprint/checkin/types';
import { checkinLabel } from '@blueprint/checkin/utils';

// boundary-violation-example: import { CheckinStore } from '@blueprint/checkin/data'; // ui -> data (store, http, events)
// boundary-violation-example: import { toCheckinRecord } from '../../../data/src/internal/checkin.mapper'; // module-private internal/

@Component({
  selector: 'app-arrival-list',
  template: `
    <ul>
      @for (record of records(); track record.id) {
        <li>{{ label(record) }}</li>
      }
    </ul>
    <button type="button" (click)="reportWalkIn()">Walk-in guest</button>
  `,
})
export class ArrivalList {
  readonly records = input.required<CheckinRecord[]>();
  /** plain value out — the container turns it into the domain event */
  readonly arrived = output<Arrival>();

  protected label(record: CheckinRecord): string {
    return checkinLabel(record);
  }

  protected reportWalkIn(): void {
    this.arrived.emit({ bookingId: 'walk-in', guestName: 'Walk-in guest' });
  }
}
