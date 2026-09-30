import { Routes } from '@angular/router';

/**
 * Slice root (type:shell): the only thing the app shell wires up. Each feat
 * is its own lib and the lazy-loading boundary.
 */
export const bookingRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('@blueprint/booking/feat-check-booking/feature').then((m) => m.FeatCheckBooking),
  },
  {
    path: 'manage',
    loadComponent: () =>
      import('@blueprint/booking/feat-manage-booking/feature').then((m) => m.FeatManageBooking),
  },
];
