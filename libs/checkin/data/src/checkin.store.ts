import { computed, inject, Injectable, signal } from '@angular/core';
import { CHECKIN_API } from '@blueprint/checkin/api';
import { GuestArrived } from '@blueprint/checkin/events';
import { CheckinRecord } from '@blueprint/checkin/types';
import { toCheckinRecord } from './internal/checkin.mapper';

/** Domain-shared store: handles domain events, owns the checkin state. */
@Injectable({ providedIn: 'root' })
export class CheckinStore {
  private readonly api = inject(CHECKIN_API);
  private readonly records = signal<CheckinRecord[]>([]);

  readonly all = this.records.asReadonly();
  readonly count = computed(() => this.records().length);

  async load(): Promise<void> {
    const dtos = await this.api.loadCheckins();
    this.records.set(dtos.map(toCheckinRecord));
  }

  handle(event: GuestArrived): void {
    this.records.update((records) => [
      ...records,
      {
        id: `c${records.length + 1}`,
        bookingId: event.bookingId,
        guestName: event.guestName,
        checkedInAt: new Date().toISOString(),
      },
    ]);
  }
}
