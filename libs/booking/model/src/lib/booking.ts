/**
 * Domain core — zero imports. Note it does NOT import customer's CustomerId
 * even though a booking belongs to a customer: `core:booking` may only see
 * `core:booking`. The slice keeps its own notion of who a guest is; the
 * translation happens in the application layer.
 */
export type BookingId = string & { readonly __brand: 'BookingId' };
export type GuestRef = string & { readonly __brand: 'GuestRef' };

export const toBookingId = (raw: string): BookingId => raw as BookingId;
export const toGuestRef = (raw: string): GuestRef => raw as GuestRef;

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  readonly id: BookingId;
  readonly guest: GuestRef;
  readonly room: string;
  readonly nights: number;
  readonly baseRate: number;
  readonly discountPercent: number;
  readonly status: BookingStatus;
}

export const totalPrice = (booking: Booking): number => {
  const gross = booking.baseRate * booking.nights;
  return Math.round(gross * (1 - booking.discountPercent / 100) * 100) / 100;
};
