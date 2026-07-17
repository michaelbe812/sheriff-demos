import { Routes } from '@angular/router';

/** Slice root (entry): the only thing the app shell wires up. */
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
