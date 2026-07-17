import { Routes } from '@angular/router';
import { provideBooking } from './ports/booking.providers';

/** Slice entry point — the only booking module app.routes.ts may import. */
export const bookingRoutes: Routes = [
  {
    path: '',
    providers: [...provideBooking()],
    loadComponent: () =>
      import('./adapters/driving/booking-page').then((m) => m.BookingPage),
  },
];
