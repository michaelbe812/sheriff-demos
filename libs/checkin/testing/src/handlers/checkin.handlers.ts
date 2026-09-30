import { CheckinDto } from '@blueprint/checkin/types';
import { http, HttpResponse } from 'msw';
import { aCheckinDto } from '../fixtures/checkin.fixture';

/** Backend contract of the checkin domain (mirrors CheckinApi). */
export const checkinsUrl = '/api/checkins';

export const defaultCheckinDtos: CheckinDto[] = [
  aCheckinDto({ id: 'c-1', booking_id: 'b-100', guest_name: 'Katherine Johnson' }),
];

/** Happy path: the backend returns the default check-ins. */
export const checkinHandlers = [http.get(checkinsUrl, () => HttpResponse.json(defaultCheckinDtos))];

/** Deviations for a single test: `network.use(checkinScenarios.empty())`. */
export const checkinScenarios = {
  withCheckins: (dtos: CheckinDto[]) => http.get(checkinsUrl, () => HttpResponse.json(dtos)),
  empty: () => http.get(checkinsUrl, () => HttpResponse.json([])),
  serverError: () => http.get(checkinsUrl, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
};
