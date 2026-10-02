import { Component, inject, input, output } from '@angular/core';
import { Booking } from '@blueprint/booking/types';
import { bookingLabel } from '@blueprint/booking/utils';
import { BookingCardStore } from './booking-card.store';

// boundary-violation-example: import { BookingStore } from '@blueprint/booking/state'; // ui -> state (store, events)
// boundary-violation-example: import { BookingApi } from '@blueprint/booking/data-access'; // ui -> data-access (http)

/** Dumb component: types, utils, local store — nothing else. Emits the booking id, the container makes the event. */
@Component({
  selector: 'app-booking-card',
  providers: [BookingCardStore],
  template: `
    <article (click)="store.toggle()">
      <h3>{{ label }}</h3>
      @if (store.expanded()) {
        <p>Status: {{ booking().status }}</p>
        <button type="button" (click)="confirm($event)">Confirm</button>
      }
    </article>
  `,
})
export class BookingCard {
  readonly booking = input.required<Booking>();
  readonly confirmed = output<string>();

  protected readonly store = inject(BookingCardStore);

  protected get label(): string {
    return bookingLabel(this.booking());
  }

  protected confirm(event: Event): void {
    event.stopPropagation();
    this.confirmed.emit(this.booking().id);
  }
}
