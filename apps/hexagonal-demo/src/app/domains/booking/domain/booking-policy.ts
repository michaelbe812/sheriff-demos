import { Booking } from './booking';

/**
 * Pure business rules. Testable with `new`, no TestBed, no HTTP mock — the
 * reward for keeping this folder sealed.
 */
export const MAX_NIGHTS = 30;

export type CancellationRefusal = 'already-cancelled' | 'stay-too-long';

export const canCancel = (booking: Booking): boolean =>
  booking.status === 'confirmed';

export const validateStay = (nights: number): CancellationRefusal | null =>
  nights > MAX_NIGHTS ? 'stay-too-long' : null;

export const cancel = (booking: Booking): Booking => ({
  ...booking,
  status: 'cancelled',
});
