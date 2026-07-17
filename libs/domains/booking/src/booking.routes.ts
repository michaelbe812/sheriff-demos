import { Routes } from '@angular/router';

/**
 * Slice root (entry): the only thing the app shell wires up.
 *
 * provideBooking() is deliberately NOT wired here but app-wide in
 * app.config.ts: the checkin domain injects BOOKING_API from its own lazy
 * route, and a provider scoped to THIS route subtree would not be visible
 * there. A port consumed across slices belongs in the root injector — a
 * slice-private one would go here.
 */
const bookingRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./feat-check-booking/feat-check-booking').then((m) => m.FeatCheckBooking),
  },
  {
    path: 'manage',
    loadComponent: () =>
      import('./feat-manage-booking/feat-manage-booking').then((m) => m.FeatManageBooking),
  },
];

export default bookingRoutes;
