import { CheckinDto } from '@blueprint/checkin/types';

let nextId = 1;

/** Test data builder in the raw backend shape (snake_case), as MSW serves it. */
export function aCheckinDto(overrides: Partial<CheckinDto> = {}): CheckinDto {
  return {
    id: `checkin-${nextId++}`,
    booking_id: 'b-100',
    guest_name: 'Katherine Johnson',
    checked_in_at: '2026-10-01T14:00:00.000Z',
    ...overrides,
  };
}
