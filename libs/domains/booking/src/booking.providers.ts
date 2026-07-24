import { Provider } from '@angular/core';
import { BookingApi } from './api';
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
  // the abstract class IS the token — no separate InjectionToken needed
  return { provide: BookingApi, useClass: HttpBookingApi };
}
