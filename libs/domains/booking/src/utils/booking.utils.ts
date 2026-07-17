import { formatDate } from '@blueprint/shared/utils/format-date';
import { Booking } from '../types/booking.model';

export function bookingLabel(booking: Booking): string {
  return `${booking.guestName} – ${formatDate(booking.checkinDate)}`;
}

export function isConfirmed(booking: Booking): boolean {
  return booking.status === 'confirmed';
}
