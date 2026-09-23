import { Injectable } from '@angular/core';
import { BookingClockPort } from '@hex/booking/port-out';

/** The real clock — the impure edge, isolated to a single line. */
@Injectable()
export class SystemClock implements BookingClockPort {
  now(): Date {
    return new Date();
  }
}
