import { InjectionToken } from '@angular/core';

/**
 * Even the clock is a driven port. `Date.now()` is I/O: it makes the core
 * non-deterministic and its tests time-dependent. Pushing it out here keeps
 * `domain/` pure and lets tests inject a fixed clock.
 */
export interface BookingClockPort {
  now(): Date;
}

export const BOOKING_CLOCK = new InjectionToken<BookingClockPort>('BookingClock');
