import { computed, inject, Injectable, signal } from '@angular/core';
import { CheckinRecord } from '@blueprint/checkin/types';
import { CheckinApi } from '@blueprint/checkin/data-access';
import { GuestArrived } from './checkin.events';
import { toCheckinRecord } from './internal/checkin.mapper';

/** Domain-shared store: handles domain events, owns the checkin state. */
@Injectable({ providedIn: 'root' })
export class CheckinStore {
  private readonly api = inject(CheckinApi);
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
