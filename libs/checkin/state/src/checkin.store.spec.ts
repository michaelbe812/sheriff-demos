import { TestBed } from '@angular/core/testing';
import { aCheckinDto, checkinHandlers, checkinScenarios } from '@blueprint/checkin/testing';
import { test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';
import { CheckinStore } from './checkin.store';

describe('CheckinStore', () => {
  beforeEach(() => worker.use(...checkinHandlers));

  test('maps backend DTOs (snake_case) to CheckinRecords', async () => {
    const store = TestBed.inject(CheckinStore);

    await store.load();

    expect(store.all()).toEqual([
      { id: 'c-1', bookingId: 'b-100', guestName: 'Katherine Johnson', checkedInAt: '2026-10-01T14:00:00.000Z' },
    ]);
  });

  test('counts every mapped record', async ({ worker }) => {
    worker.use(checkinScenarios.withCheckins([aCheckinDto(), aCheckinDto(), aCheckinDto()]));
    const store = TestBed.inject(CheckinStore);

    await store.load();

    expect(store.count()).toBe(3);
  });

  test('stays empty when the backend has no check-ins', async ({ worker }) => {
    worker.use(checkinScenarios.empty());
    const store = TestBed.inject(CheckinStore);

    await store.load();

    expect(store.count()).toBe(0);
  });
});
