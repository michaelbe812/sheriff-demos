import { Component, input, output } from '@angular/core';
import { GuestArrived, guestArrived } from '@blueprint/checkin/events';
import { CheckinRecord } from '@blueprint/checkin/types';
import { checkinLabel } from '@blueprint/checkin/utils';

// nx-violation-example: import { CheckinStore } from '@blueprint/checkin/data'; // type:ui -> type:data

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
