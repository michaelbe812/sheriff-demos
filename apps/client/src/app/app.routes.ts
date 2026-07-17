import { Route } from '@angular/router';
import { LayoutShell } from './layout/layout.shell';

// sheriff-violation-example: import { BookingCard } from '@blueprint/domains/booking/ui/booking-card'; // shell -> slice internals (only entry/port)

/** App shell: composes slices via their entries (routes/shells) only. */
export const appRoutes: Route[] = [
  {
    path: '',
    component: LayoutShell,
    children: [
      {
        path: 'bookings',
        loadChildren: () => import('@blueprint/domains/booking/booking.routes'),
      },
      {
        path: 'checkin',
        loadChildren: () => import('./domains/checkin/checkin.routes'),
      },
      { path: '', pathMatch: 'full', redirectTo: 'bookings' },
    ],
  },
];
