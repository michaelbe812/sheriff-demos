import { InjectionToken } from '@angular/core';
import type { Booking, BookingId } from '@hex/booking/domain';

/** Driven port — private to the booking slice. */
export interface BookingRepositoryPort {
  save(booking: Booking): Promise<void>;
  findById(id: BookingId): Promise<Booking | null>;
  findAll(): Promise<Booking[]>;
}

export const BOOKING_REPOSITORY = new InjectionToken<BookingRepositoryPort>(
  'BookingRepository',
);
