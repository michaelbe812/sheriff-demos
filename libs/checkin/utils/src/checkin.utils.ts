import { CheckinRecord } from '@blueprint/checkin/types';

export function checkinLabel(record: CheckinRecord): string {
  return `${record.guestName} (${record.bookingId})`;
}

/** Desk state — used by feat-checkin and feat-history (siblings share via the slice root, no feat-port). */
export interface DeskSummary {
  openArrivals: number;
}

export function describeDesk(summary: DeskSummary): string {
  return summary.openArrivals === 0
    ? 'Desk clear — no open arrivals'
    : `${summary.openArrivals} open arrivals at the desk`;
}
