import { Arrival } from '@blueprint/checkin/types';

let nextId = 1;

/** Test data builder: a guest expected at the desk, override what the test cares about. */
export function anArrival(overrides: Partial<Arrival> = {}): Arrival {
  return { bookingId: `b-${nextId++}`, guestName: 'Ada Lovelace', ...overrides };
}
