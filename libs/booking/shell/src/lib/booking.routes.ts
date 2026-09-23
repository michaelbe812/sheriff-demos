import { Routes } from '@angular/router';
import { BookingPage } from '@hex/booking/adapter-driving';
import { provideBooking } from '@hex/booking/providers';

/**
 * Slice entry point — the only booking lib the app may import (tag `entry`).
 * The app lazy-loads this whole lib, so the page is imported statically: in Nx
 * the lazy-loading unit is the lib, not the file.
 */
export const bookingRoutes: Routes = [
  {
    path: '',
    providers: [...provideBooking()],
    component: BookingPage,
  },
];
