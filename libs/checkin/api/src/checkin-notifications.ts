import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { NotificationsService } from '@blueprint/generated/notification-client/api';
import type { Notification } from '@blueprint/generated/notification-client/types';
import { CheckinNotification } from '@blueprint/checkin/types';
import { firstValueFrom } from 'rxjs';

export type { CheckinNotification } from '@blueprint/checkin/types';

/**
 * Part of the checkin PORT: notifications of topic "checkin", backed by the shared generated
 * notification-client. Other libs never see the generated service — the port is the wrapper.
 */
@Injectable({ providedIn: 'root' })
export class CheckinNotifications {
  private readonly notifications = inject(NotificationsService);

  async load(): Promise<CheckinNotification[]> {
    try {
      const list = await firstValueFrom(this.notifications.listNotifications({ topic: 'checkin' }), {
        defaultValue: [],
      });
      return list.map(toCheckinNotification);
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
function toCheckinNotification({ id, message, read, createdAt }: Notification): CheckinNotification {
  return { id, message, read, createdAt };
}

function failure(error: unknown, request: string): unknown {
  return error instanceof HttpErrorResponse ? new Error(`${request} failed: ${error.status}`) : error;
}
