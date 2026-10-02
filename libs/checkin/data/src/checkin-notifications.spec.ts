import { TestBed } from '@angular/core/testing';
import {
  getListNotificationsResponseMock,
  type Notification,
  notificationClientHandlers,
  notificationClientHttp,
} from '@blueprint/generated/notification-client/testing';
import { test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';
import { CheckinNotifications } from './checkin-notifications';

describe('CheckinNotifications (shared notification-client behind the checkin data layer)', () => {
  // generated default handlers of the shared client: spec examples, faker (seeded per test) for the rest
  beforeEach(() => worker.use(...notificationClientHandlers));

  test('loads through the generated default handler', async () => {
    const notifications = await TestBed.inject(CheckinNotifications).load();

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]).toEqual({
      id: 'n-1',
      message: 'Booking b-101 confirmed',
      read: false,
      createdAt: '2026-10-01T09:00:00Z',
    });
  });

  test('asks for topic "checkin" only (typed scenario, generated factory as data)', async ({ worker }) => {
    const [example] = getListNotificationsResponseMock();
    const all: Notification[] = [
      { ...example, id: 'n-booking', topic: 'booking' },
      { ...example, id: 'n-checkin', topic: 'checkin' },
    ];
    worker.use(
      notificationClientHttp.get('/notifications', ({ query, response }) =>
        response(200).json(all.filter((notification) => notification.topic === query.get('topic'))),
      ),
    );

    expect((await TestBed.inject(CheckinNotifications).load()).map((notification) => notification.id)).toEqual([
      'n-checkin',
    ]);
  });

  test('marks a notification as read', async ({ worker }) => {
    const marked: string[] = [];
    worker.use(
      notificationClientHttp.post('/notifications/{id}/read', ({ params, response }) => {
        marked.push(params.id);
        return response(204).empty();
      }),
    );

    await TestBed.inject(CheckinNotifications).markRead('n-7');

    expect(marked).toEqual(['n-7']);
  });

  test('turns a documented 404 into an Error', async ({ worker }) => {
    worker.use(
      notificationClientHttp.post('/notifications/{id}/read', ({ response }) =>
        response(404).json({ message: 'unknown' }),
      ),
    );

    await expect(TestBed.inject(CheckinNotifications).markRead('n-0')).rejects.toThrow(
      'POST /api/notifications/n-0/read failed: 404',
    );
  });
});
