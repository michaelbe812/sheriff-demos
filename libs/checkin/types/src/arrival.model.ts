/** A guest expected at the desk — checkin's own view of the backend's arrivals (no booking import). */
export interface Arrival {
  bookingId: string;
  guestName: string;
}
