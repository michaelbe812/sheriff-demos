import { TestBed } from '@angular/core/testing';
import { test } from '@blueprint/shared/testing';
import { describe, expect, vi } from 'vitest';
import { BookingApi } from './booking-api';

describe('BookingApi without a matching MSW handler', () => {
  // no default handlers (no `beforeEach(() => worker.use(...))`): nothing is mocked for this spec
  test('fails the request instead of hitting a real backend (onUnhandledRequest: error)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = TestBed.inject(BookingApi);

    // MSW logs the unhandled request and answers it with a 500 instead of passing it through
    await expect(api.loadBookings()).rejects.toThrow('500');

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringMatching(/\[MSW\] Error: intercepted a request without a matching request handler:\s+• GET \/api\/bookings/),
    );
    consoleError.mockRestore();
  });
});
