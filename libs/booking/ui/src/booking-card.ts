import { Component, inject, input, output } from '@angular/core';
import { BookingConfirmed, bookingConfirmed } from '@blueprint/booking/events';
import { Booking } from '@blueprint/booking/types';
import { bookingLabel } from '@blueprint/booking/utils';
import { BookingCardStore } from './booking-card.store';

// nx-violation-example: import { BookingStore } from '@blueprint/booking/data'; // type:ui -> type:data
// nx-violation-example: import { BookingApi } from '@blueprint/booking/api'; // type:ui -> type:api

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
