import { CheckinDto } from '@blueprint/checkin/api';
import { CheckinRecord } from '@blueprint/checkin/types';

/**
 * LIB-PRIVATE: not re-exported from the state lib's index.ts, so no other lib
 * can import it — the Nx public API (tsconfig path -> index.ts) is the
 * encapsulation. The `internal/` folder is a naming convention only.
 */
export function toCheckinRecord(dto: CheckinDto): CheckinRecord {
  return {
    id: dto.id,
    bookingId: dto.booking_id,
    guestName: dto.guest_name,
    checkedInAt: dto.checked_in_at,
  };
}
