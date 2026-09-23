/** Domain events: ui/feature emit, data handles. */
export interface GuestArrived {
  readonly type: 'checkin.guestArrived';
  readonly bookingId: string;
  readonly guestName: string;
}

export function guestArrived(bookingId: string, guestName: string): GuestArrived {
  return { type: 'checkin.guestArrived', bookingId, guestName };
}
