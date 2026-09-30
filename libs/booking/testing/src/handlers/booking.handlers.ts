import { bookingClientHttp } from '@blueprint/booking/generated/booking-client/testing';
import { Booking } from '@blueprint/booking/types';
import { aBooking } from '../fixtures/booking.fixture';

/**
 * Backend contract of the booking domain = the spec of the generated booking-client
 * (libs/booking/generated/booking-client/openapi.yaml). `bookingClientHttp` (openapi-msw) only
 * accepts its paths, status codes and bodies — a spec change breaks these handlers at compile time.
 * The generated default handlers (`bookingClientHandlers`, spec examples + faker) are there, too.
 */
export const defaultBookings: Booking[] = [
  aBooking({ id: 'b-100', guestName: 'Katherine Johnson', status: 'pending' }),
  aBooking({ id: 'b-101', guestName: 'Margaret Hamilton', status: 'confirmed' }),
];

/** Happy path: the backend returns the default bookings. */
export const bookingHandlers = [
  bookingClientHttp.get('/bookings', ({ response }) => response(200).json(defaultBookings)),
];

/** Deviations for a single test: `worker.use(bookingScenarios.serverError())`. */
export const bookingScenarios = {
  withBookings: (bookings: Booking[]) =>
    bookingClientHttp.get('/bookings', ({ response }) => response(200).json(bookings)),
  empty: () => bookingClientHttp.get('/bookings', ({ response }) => response(200).json([])),
  serverError: () =>
    bookingClientHttp.get('/bookings', ({ response }) =>
      response('default').json({ message: 'boom' }, { status: 500 }),
    ),
};
