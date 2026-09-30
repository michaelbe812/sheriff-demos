/** A notification about a booking (backend: the shared notification-client, topic "booking"). */
export interface BookingNotification {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
}
