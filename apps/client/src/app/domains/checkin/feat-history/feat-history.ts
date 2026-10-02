import { Component, inject } from '@angular/core';
import { CheckinStore } from '../state/checkin.store';
// Sibling feat ONLY via its feat-port:
import { describeDesk } from '../feat-checkin/api/checkin-desk-api';
import { checkinLabel } from '../utils/checkin.utils';

// sheriff-violation-example: import { CheckinDeskStore } from '../feat-checkin/state/checkin-desk.store'; // sibling feat internals

@Component({
  selector: 'app-feat-history',
  template: `
    <h2>Check-in history</h2>
    <p>{{ deskStatus }}</p>
    <ul>
      @for (record of checkinStore.all(); track record.id) {
        <li>{{ label(record) }} — {{ record.checkedInAt }}</li>
      }
    </ul>
  `,
})
export class FeatHistory {
  protected readonly checkinStore = inject(CheckinStore);

  protected readonly deskStatus = describeDesk({ openArrivals: 0 });

  protected label(record: { guestName: string; bookingId: string }): string {
    return checkinLabel({ ...record, id: '', checkedInAt: '' });
  }
}
