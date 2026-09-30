import { Booking } from '@blueprint/booking/types';
import { http, HttpResponse } from 'msw';
import { aBooking } from '../fixtures/booking.fixture';

/** Backend contract of the booking domain (mirrors BookingApi). */
export const bookingsUrl = '/api/bookings';

export const defaultBookings: Booking[] = [
  aBooking({ id: 'b-100', guestName: 'Katherine Johnson', status: 'pending' }),
  aBooking({ id: 'b-101', guestName: 'Margaret Hamilton', status: 'confirmed' }),
];

/** Happy path: the backend returns the default bookings. */
export const bookingHandlers = [http.get(bookingsUrl, () => HttpResponse.json(defaultBookings))];

/** Deviations for a single test: `network.use(bookingScenarios.serverError())`. */
export const bookingScenarios = {
  withBookings: (bookings: Booking[]) => http.get(bookingsUrl, () => HttpResponse.json(bookings)),
  empty: () => http.get(bookingsUrl, () => HttpResponse.json([])),
  serverError: () => http.get(bookingsUrl, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
};
