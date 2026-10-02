/** Domain events (data layer): feature containers create them, stores handle them; ui never sees them. */
export interface GuestArrived {
  readonly type: 'checkin.guestArrived';
  readonly bookingId: string;
  readonly guestName: string;
}

export function guestArrived(bookingId: string, guestName: string): GuestArrived {
  return { type: 'checkin.guestArrived', bookingId, guestName };
}
