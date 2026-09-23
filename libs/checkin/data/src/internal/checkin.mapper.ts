import { CheckinDto } from '@blueprint/checkin/api';
import { CheckinRecord } from '@blueprint/checkin/types';

/**
 * MODULE-PRIVATE (sheriff `encapsulationPattern: 'internal'`, the default):
 * a top-level `internal/` folder inside a module is only importable from
 * within that module (here: `data`). Even sibling modules of the SAME domain
 * get an encapsulation violation — no config or tag needed.
 */
export function toCheckinRecord(dto: CheckinDto): CheckinRecord {
  return {
    id: dto.id,
    bookingId: dto.booking_id,
    guestName: dto.guest_name,
    checkedInAt: dto.checked_in_at,
  };
}
