import { Component, inject, input, output } from '@angular/core';
import { BookingConfirmed, bookingConfirmed } from '../events/booking.events';
import { Booking } from '../types/booking.model';
import { bookingLabel } from '../utils/booking.utils';
import { BookingCardStore } from './booking-card.store';

// sheriff-violation-example: import { BookingStore } from '../data/booking.store'; // ui -> data
// sheriff-violation-example: import { BookingApi } from '../api/booking-api'; // ui -> api

/** Dumb component: types, utils, events, local store — nothing else. */
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
  readonly confirmed = output<BookingConfirmed>();

  protected readonly store = inject(BookingCardStore);

  protected get label(): string {
    return bookingLabel(this.booking());
  }

  protected confirm(event: Event): void {
    event.stopPropagation();
    this.confirmed.emit(bookingConfirmed(this.booking().id));
  }
}
