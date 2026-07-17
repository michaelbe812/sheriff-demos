import { Route } from '@angular/router';

/**
 * The app shell sees each slice ONLY through its `entry`-tagged routes file.
 * `app:hexagonal-demo` has clearance towards `entry`, `port` and `shared` —
 * never towards a slice's application/ or adapters/.
 */
export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'bookings' },
  {
    path: 'bookings',
    loadChildren: () =>
      import('./domains/booking/booking.routes').then((m) => m.bookingRoutes),
  },
  {
    path: 'customers',
    loadChildren: () =>
      import('./domains/customer/customer.routes').then((m) => m.customerRoutes),
  },
];
