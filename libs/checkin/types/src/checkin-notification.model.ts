/** A notification about a check-in (backend: the shared notification-client, topic "checkin"). */
export interface CheckinNotification {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
}
