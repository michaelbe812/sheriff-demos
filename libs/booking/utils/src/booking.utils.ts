import { formatDate } from '@blueprint/shared/utils';
import { Booking } from '@blueprint/booking/types';

export function bookingLabel(booking: Booking): string {
  return `${booking.guestName} – ${formatDate(booking.checkinDate)}`;
}

export function isConfirmed(booking: Booking): boolean {
  return booking.status === 'confirmed';
}

/** Result of a booking check — used by feat-check-booking and feat-manage-booking (siblings share via the slice root). */
export interface CheckSummary {
  bookingId: string;
  checkedAt: string;
}

export function describeCheck(summary: CheckSummary): string {
  return `Booking ${summary.bookingId} checked at ${summary.checkedAt}`;
}
