import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { NotificationsService } from '@blueprint/generated/notification-client/api';
import type { Notification } from '@blueprint/generated/notification-client/types';
import { BookingNotification } from '@blueprint/booking/types';
import { firstValueFrom } from 'rxjs';

export type { BookingNotification } from '@blueprint/booking/types';

/**
 * Part of the booking PORT: notifications of topic "booking", backed by the shared generated
 * notification-client. Other libs never see the generated service — the port is the wrapper.
 */
@Injectable({ providedIn: 'root' })
export class BookingNotifications {
  private readonly notifications = inject(NotificationsService);

  async load(): Promise<BookingNotification[]> {
    try {
      const list = await firstValueFrom(this.notifications.listNotifications({ topic: 'booking' }), {
        defaultValue: [],
      });
      return list.map(toBookingNotification);
    } catch (error) {
      throw failure(error, 'GET /api/notifications');
    }
  }

  async markRead(id: string): Promise<void> {
    try {
      await firstValueFrom(this.notifications.markNotificationRead({ id }), { defaultValue: undefined });
    } catch (error) {
      throw failure(error, `POST /api/notifications/${id}/read`);
    }
  }
}

/** Anti-corruption: generated DTO → domain model. */
function toBookingNotification({ id, message, read, createdAt }: Notification): BookingNotification {
  return { id, message, read, createdAt };
}

function failure(error: unknown, request: string): unknown {
  return error instanceof HttpErrorResponse ? new Error(`${request} failed: ${error.status}`) : error;
}
