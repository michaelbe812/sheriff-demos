/**
 * Domain events: definition-only (type + creator), part of the data layer. feature containers
 * create them, stores handle them. ui never sees them — it emits plain values via outputs.
 */
export interface BookingConfirmed {
  readonly type: 'booking.confirmed';
  readonly bookingId: string;
}

export function bookingConfirmed(bookingId: string): BookingConfirmed {
  return { type: 'booking.confirmed', bookingId };
}
