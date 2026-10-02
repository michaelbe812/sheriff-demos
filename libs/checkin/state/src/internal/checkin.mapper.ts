import { CheckinDto, CheckinRecord } from '@blueprint/checkin/types';

/**
 * LIB-PRIVATE: `internal/` is never exported from index.ts (blueprint/no-internal-export), so no other
 * lib can reach it — deep imports are banned, relative imports across libs too.
 */
export function toCheckinRecord(dto: CheckinDto): CheckinRecord {
  return {
    id: dto.id,
    bookingId: dto.booking_id,
    guestName: dto.guest_name,
    checkedInAt: dto.checked_in_at,
  };
}
