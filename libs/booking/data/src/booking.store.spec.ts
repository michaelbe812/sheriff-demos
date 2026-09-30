import { TestBed } from '@angular/core/testing';
import { aBooking, bookingHandlers, bookingScenarios, defaultBookings } from '@blueprint/booking/testing';
import { test } from '@blueprint/shared/testing';
import { describe, expect } from 'vitest';
import { BookingStore } from './booking.store';

describe('BookingStore', () => {
  test.override('handlers', () => bookingHandlers);

  test('loads bookings from the backend via the real BookingApi', async () => {
    const store = TestBed.inject(BookingStore);

    await store.load();

    expect(store.all()).toEqual(defaultBookings);
    expect(store.confirmed().map((booking) => booking.id)).toEqual(['b-101']);
  });

  test('replaces the list with whatever a single test serves', async ({ network }) => {
    network.use(bookingScenarios.withBookings([aBooking({ id: 'b-1', status: 'confirmed' })]));
    const store = TestBed.inject(BookingStore);

    await store.load();

    expect(store.confirmed().map((booking) => booking.id)).toEqual(['b-1']);
  });

  test('keeps the current bookings when the backend fails', async ({ network }) => {
    network.use(bookingScenarios.serverError());
    const store = TestBed.inject(BookingStore);
    const before = store.all();

    await expect(store.load()).rejects.toThrow('500');

    expect(store.all()).toBe(before);
  });
});
