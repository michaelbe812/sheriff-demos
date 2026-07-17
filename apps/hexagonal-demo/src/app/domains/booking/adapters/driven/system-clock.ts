import { Injectable } from '@angular/core';
import { BookingClockPort } from '../../ports/out/booking-clock.port';

/** The real clock — the impure edge, isolated to a single line. */
@Injectable()
export class SystemClock implements BookingClockPort {
  now(): Date {
    return new Date();
  }
}
