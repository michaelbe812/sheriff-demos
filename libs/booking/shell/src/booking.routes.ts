import { Routes } from '@angular/router';

/** Slice root (entry): the only thing the app shell wires up. */
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
