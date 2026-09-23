import { Route } from '@angular/router';
import { bookingRoutes } from '@blueprint/booking/shell';
import { checkinRoutes } from '@blueprint/checkin/shell';
import { LayoutShell } from '@blueprint/layout/shell';

// nx-violation-example: import { BookingCard } from '@blueprint/booking/ui'; // type:app -> type:ui (only shell/port/shared)

/**
 * App shell: composes slices via their shells only. Shell libs are imported
 * statically (app.config needs their providers anyway — a lazy import of the
 * same lib would trip Nx' lazy-load check); the lazy boundary is the feat lib.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    component: LayoutShell,
    children: [
      { path: 'bookings', children: bookingRoutes },
      { path: 'checkin', children: checkinRoutes },
      { path: '', pathMatch: 'full', redirectTo: 'bookings' },
    ],
  },
];
