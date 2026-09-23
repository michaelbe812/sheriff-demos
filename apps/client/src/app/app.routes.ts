import { Route } from '@angular/router';
import { LayoutShell } from '@blueprint/layout/shell';

// boundary-violation-example: import { BookingCard } from '@blueprint/booking/ui'; // shell -> slice internals (only entry/port)

/** App shell: composes slices via their entries (routes/shells) only. */
export const appRoutes: Route[] = [
  {
    path: '',
    component: LayoutShell,
    children: [
      {
        path: 'bookings',
        loadChildren: () => import('@blueprint/booking/shell').then((m) => m.bookingRoutes),
      },
      {
        path: 'checkin',
        loadChildren: () => import('@blueprint/checkin/shell').then((m) => m.checkinRoutes),
      },
      { path: '', pathMatch: 'full', redirectTo: 'bookings' },
    ],
  },
];
