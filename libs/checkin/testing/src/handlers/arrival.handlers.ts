import { Arrival } from '@blueprint/checkin/types';
import { http, HttpResponse } from 'msw';
import { anArrival } from '../fixtures/arrival.fixture';

/** Backend contract of the desk arrivals (mirrors CheckinApi.loadArrivals). */
export const arrivalsUrl = '/api/arrivals';

export const defaultArrivals: Arrival[] = [anArrival({ bookingId: 'b-100', guestName: 'Katherine Johnson' })];

/** Happy path: the backend returns the default arrivals. */
export const arrivalHandlers = [http.get(arrivalsUrl, () => HttpResponse.json(defaultArrivals))];

/** Deviations for a single test: `worker.use(arrivalScenarios.empty())`. */
export const arrivalScenarios = {
  withArrivals: (arrivals: Arrival[]) => http.get(arrivalsUrl, () => HttpResponse.json(arrivals)),
  empty: () => http.get(arrivalsUrl, () => HttpResponse.json([])),
};
