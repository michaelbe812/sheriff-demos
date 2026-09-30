import { Booking } from '@blueprint/booking/types';

let nextId = 1;

/** Test data builder: a valid pending booking, override what the test cares about. */
export function aBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: `booking-${nextId++}`,
    guestName: 'Ada Lovelace',
    checkinDate: '2026-10-01',
    status: 'pending',
    ...overrides,
  };
}
