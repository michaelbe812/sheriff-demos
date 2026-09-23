import { Provider } from '@angular/core';
import { BOOKING_API } from '@hex/booking/port-in';
import { BOOKING_CLOCK, BOOKING_REPOSITORY } from '@hex/booking/port-out';
import { InMemoryBookingRepository, SystemClock } from '@hex/booking/adapter-driven';
import { BookingApiAdapter } from '@hex/booking/adapter-driving';
import { BookingStore, BookRoomUseCase, CancelBookingUseCase } from '@hex/booking/domain';

/**
 * Slice composition root. The `useClass` lines below are the entire
 * dependency inversion: the use-case named a port, this file picks the
 * implementation, and nothing inward knows which one it got.
 *
 * Swapping InMemoryBookingRepository for an HTTP one is a one-line change
 * here — no use-case, store, or component is touched.
 */
export const provideBooking = (): Provider[] => [
  { provide: BOOKING_REPOSITORY, useClass: InMemoryBookingRepository },
  { provide: BOOKING_CLOCK, useClass: SystemClock },
  // booking's own public port. Provided here rather than app-wide because its
  // adapter needs BOOKING_REPOSITORY, which is route-scoped: an app-level
  // BOOKING_API would resolve in the root injector and fail to find it.
  // The moment another slice needs BOOKING_API app-wide, both move up together
  // — as customer's port already does (see app.config.ts).
  { provide: BOOKING_API, useClass: BookingApiAdapter },
  BookRoomUseCase,
  CancelBookingUseCase,
  BookingStore,
];
