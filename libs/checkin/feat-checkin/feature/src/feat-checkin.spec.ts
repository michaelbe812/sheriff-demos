import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AUTH_API, AuthApi } from '@blueprint/auth/api';
import { aBooking, bookingScenarios } from '@blueprint/booking/testing';
import { test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';
import { page } from 'vitest/browser';
import { FeatCheckin } from './feat-checkin';

const signedInAgent: AuthApi = {
  user: signal({ id: 'u-1', name: 'Test Agent' }),
  isAuthenticated: signal(true),
};

function renderDesk(): void {
  TestBed.configureTestingModule({ providers: [{ provide: AUTH_API, useValue: signedInAgent }] });
  TestBed.createComponent(FeatCheckin);
}

describe('FeatCheckin (rendered in Chromium, backend via MSW)', () => {
  // cross-domain: the desk loads arrivals through the booking port (BookingApi)
  beforeEach(() =>
    worker.use(
      bookingScenarios.withBookings([
        aBooking({ id: 'b-7', guestName: 'Grace Hopper' }),
        aBooking({ id: 'b-8', guestName: 'Ada Lovelace' }),
      ]),
    ),
  );

  test('loads arrivals on click and renders one check-in button per guest', async () => {
    renderDesk();

    await page.getByRole('button', { name: 'Load arrivals' }).click();

    await expect.element(page.getByText('2 arrivals')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Check in Grace Hopper' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Check in Ada Lovelace' })).toBeVisible();
  });

  test('checking a guest in moves them from arrivals to today’s list', async () => {
    renderDesk();
    await page.getByRole('button', { name: 'Load arrivals' }).click();

    await page.getByRole('button', { name: 'Check in Grace Hopper' }).click();

    await expect.element(page.getByText('1 arrival', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Checked in today (1)')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Check in Grace Hopper' })).not.toBeInTheDocument();
  });

  test('shows no arrivals when the backend has none', async ({ worker }) => {
    worker.use(bookingScenarios.empty());
    renderDesk();

    await page.getByRole('button', { name: 'Load arrivals' }).click();

    await expect.element(page.getByText('0 arrivals')).toBeVisible();
  });
});
