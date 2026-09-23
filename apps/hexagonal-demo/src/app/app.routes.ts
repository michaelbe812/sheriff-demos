import { Route } from '@angular/router';

/**
 * The app shell sees each slice ONLY through its `entry`-tagged shell lib.
 * `app:*` may depend on `entry`, `port` and `scope:shared` — never on a
 * slice's domain or adapters.
 */
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'bookings' },
  {
    path: 'bookings',
    loadChildren: () =>
      import('@hex/booking/shell').then((m) => m.bookingRoutes),
  },
  {
    path: 'customers',
    loadChildren: () =>
      import('@hex/customer/shell').then((m) => m.customerRoutes),
  },
];
