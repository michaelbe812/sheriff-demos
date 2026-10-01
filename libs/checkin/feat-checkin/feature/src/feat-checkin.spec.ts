import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AUTH_API, AuthApi } from '@blueprint/auth/api';
import { aBooking, bookingScenarios } from '@blueprint/booking/testing';
import { test, worker } from '@blueprint/shared/testing';
import { beforeEach, describe, expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FeatCheckin } from './feat-checkin';

const signedInAgent: AuthApi = {
  user: signal({ id: 'u-1', name: 'Test Agent' }),
  isAuthenticated: signal(true),
};

/** Renders the real container with real stores; only the auth port is faked, HTTP goes through MSW. */
function renderDesk(): void {
  TestBed.configureTestingModule({ providers: [{ provide: AUTH_API, useValue: signedInAgent }] });
  TestBed.createComponent(FeatCheckin);
}

// Locators read the page as a user does (role + accessible name). expect.element retries
// until the DOM matches, so there is no detectChanges(), whenStable() or manual waiting.
const loadArrivalsButton = () => page.getByRole('button', { name: 'Load arrivals' });
const checkInButton = (guestName: string) => page.getByRole('button', { name: `Check in ${guestName}` });

describe('FeatCheckin', () => {
  // cross-domain: the desk loads arrivals through the booking port (BookingApi), answered by MSW
  beforeEach(() =>
    worker.use(
      bookingScenarios.withBookings([
        aBooking({ id: 'b-7', guestName: 'Grace Hopper' }),
        aBooking({ id: 'b-8', guestName: 'Ada Lovelace' }),
      ]),
    ),
  );

  test('shows the signed-in agent', async () => {
    renderDesk();

    await expect.element(page.getByText('Agent: Test Agent')).toBeVisible();
  });

  test('loads arrivals and offers one check-in per guest', async () => {
    renderDesk();

    await userEvent.click(loadArrivalsButton());

    await expect.element(page.getByText('2 arrivals')).toBeVisible();
    await expect.element(checkInButton('Grace Hopper')).toBeVisible();
    await expect.element(checkInButton('Ada Lovelace')).toBeVisible();
  });

  test('checking a guest in moves them from arrivals to today’s list', async () => {
    renderDesk();
    await userEvent.click(loadArrivalsButton());

    await userEvent.click(checkInButton('Grace Hopper'));

    await expect.element(page.getByText('1 arrival', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Checked in today (1)')).toBeVisible();
    await expect.element(checkInButton('Grace Hopper')).not.toBeInTheDocument();
  });

  test('shows no arrivals when the backend has none', async ({ worker }) => {
    worker.use(bookingScenarios.empty());
    renderDesk();

    await userEvent.click(loadArrivalsButton());

    await expect.element(page.getByText('0 arrivals')).toBeVisible();
    await expect.element(page.getByRole('button', { name: /^Check in / })).not.toBeInTheDocument();
  });
});
