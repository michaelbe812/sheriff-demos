import { Component, input, output } from '@angular/core';
import { GuestArrived, guestArrived } from '../events/checkin.events';
import { CheckinRecord } from '../types/checkin.model';
import { checkinLabel } from '../utils/checkin.utils';

// sheriff-violation-example: import { CheckinStore } from '../data/checkin.store'; // ui -> data
// sheriff-violation-example: import { toCheckinRecord } from '../data/internal/checkin.mapper'; // module-private internal/

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
  readonly arrived = output<GuestArrived>();

  protected label(record: CheckinRecord): string {
    return checkinLabel(record);
  }

  protected reportWalkIn(): void {
    this.arrived.emit(guestArrived('walk-in', 'Walk-in guest'));
  }
}
