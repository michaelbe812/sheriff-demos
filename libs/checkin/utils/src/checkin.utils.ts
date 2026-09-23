import { CheckinRecord } from '@blueprint/checkin/types';

export function checkinLabel(record: CheckinRecord): string {
  return `${record.guestName} (${record.bookingId})`;
}
