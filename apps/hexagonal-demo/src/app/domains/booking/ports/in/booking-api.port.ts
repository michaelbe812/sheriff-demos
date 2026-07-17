import { InjectionToken } from '@angular/core';
import { Booking } from '../../domain/booking';

/**
 * Public API of the booking slice. Nothing imports it yet — and that is fine:
 * a slice publishes a port because it intends to be consumable, not because
 * someone already consumes it. When a third slice appears, this is the surface
 * it binds to.
 */
export interface BookingApiPort {
  bookingsOfGuest(guest: string): Promise<Booking[]>;
}

export const BOOKING_API = new InjectionToken<BookingApiPort>('BookingApi');
