import { formatDate } from '@blueprint/shared/utils';
import { Booking } from '@blueprint/booking/types';

export function bookingLabel(booking: Booking): string {
  return `${booking.guestName} – ${formatDate(booking.checkinDate)}`;
}

export function isConfirmed(booking: Booking): boolean {
  return booking.status === 'confirmed';
}
