import { Provider } from '@angular/core';
import { BookingApi } from '@blueprint/booking/api';
import { HttpBookingApi } from '@blueprint/booking/infra';

/**
 * Slice root (type:shell): wires the port contract to its impl.
 *
 * Called from the app's composition root, not from a lazy route: the checkin
 * domain injects the booking port from its own lazy route, and a provider
 * scoped to THIS route subtree would be invisible there.
 */
export function provideBooking(): Provider {
  return { provide: BookingApi, useClass: HttpBookingApi };
}
