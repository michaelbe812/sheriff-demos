/**
 * Domain events: definition-only (type + creator). ui and feature may emit
 * them, stores (data) handle them — that's why events is its own bucket that
 * ui may import, unlike data.
 */
export interface BookingConfirmed {
  readonly type: 'booking.confirmed';
  readonly bookingId: string;
}

export function bookingConfirmed(bookingId: string): BookingConfirmed {
  return { type: 'booking.confirmed', bookingId };
}
