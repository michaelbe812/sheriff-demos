import { Routes } from '@angular/router';

/**
 * Slice root (entry): the only thing the app shell wires up.
 *
 * There is no providers file: BookingApi is a SELF-PROVIDING port that names
 * its default impl via `useFactory` (see api/index.ts), so nothing needs
 * wiring — neither here nor in app.config.ts.
 *
 * That also sidesteps a scoping trap: the checkin domain injects the booking
 * port from its own lazy route, and a provider scoped to THIS route subtree
 * would be invisible there. `providedIn: 'root'` lands in the root injector,
 * where cross-slice consumers see it. To override the impl for this subtree
 * only, add a `providers: [...]` entry on a route below.
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
