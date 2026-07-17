import { Provider } from '@angular/core';
import { BOOKING_API } from './api/booking-api';
import { HttpBookingApi } from './infra/http-booking-api';

/**
 * Slice root (entry, type:feature): wires the port contract to its impl —
 * the same shape as provideAuth() in the auth shared-feature.
 *
 * This is the ONLY module allowed to see both sides: `type:feature` may
 * import any `type:*`, while api/, data/ and ui/ each have no clearance
 * towards `type:infra`. The composition happens here or nowhere.
 */
export function provideBooking(): Provider {
  return { provide: BOOKING_API, useClass: HttpBookingApi };
}
