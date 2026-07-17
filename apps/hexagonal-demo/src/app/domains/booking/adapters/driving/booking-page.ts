import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { BookingStore } from '../../application/booking.store';
import { toGuestRef, totalPrice } from '../../domain/booking';
import { Booking } from '../../domain/booking';

/**
 * Driving adapter (UI). Injects its own slice's store, calls use-cases through
 * it, renders domain data.
 *
 * Try adding `inject(BOOKING_REPOSITORY)` here and lint fails:
 * type:adapter-driving has no clearance towards type:port-out. A component can
 * never reach persistence, which is the rule that usually erodes first.
 */
@Component({
  selector: 'hex-booking-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Bookings</h2>

    <p>
      <button type="button" (click)="bookGold()">Book for Ada (gold → 10%)</button>
      <button type="button" (click)="bookBronze()">Book for Alan (bronze → 0%)</button>
      <button type="button" (click)="bookUnknown()">Book for unknown guest</button>
    </p>

    @if (store.error(); as error) {
      <p role="alert">{{ error }}</p>
    }

    <ul>
      @for (booking of store.items(); track booking.id) {
        <li>
          {{ booking.room }} · {{ booking.guest }} · {{ booking.nights }}n ·
          −{{ booking.discountPercent }}% → {{ price(booking) }} €
          <em>({{ booking.status }})</em>
          @if (booking.status === 'confirmed') {
            <button type="button" (click)="store.cancel(booking.id)">cancel</button>
          }
        </li>
      }
    </ul>

    <p>Revenue: {{ store.revenue() }} €</p>
  `,
})
export class BookingPage implements OnInit {
  protected readonly store = inject(BookingStore);

  ngOnInit(): void {
    void this.store.load();
  }

  protected price(booking: Booking): number {
    return totalPrice(booking);
  }

  protected bookGold(): void {
    void this.store.book(toGuestRef('c-1'), 'Suite 1', 3);
  }

  protected bookBronze(): void {
    void this.store.book(toGuestRef('c-3'), 'Room 7', 2);
  }

  protected bookUnknown(): void {
    void this.store.book(toGuestRef('nope'), 'Room 9', 1);
  }
}
