import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideBooking } from '@blueprint/domains/booking/booking.providers';
import { appRoutes } from './app.routes';
import { provideAuth } from './auth/auth.providers';
import { provideCheckin } from './domains/checkin/checkin.providers';

/**
 * Composition root. Each provideX() binds a slice's port contract to its
 * implementation — the only place in the app where both sides meet.
 *
 * Note what is NOT imported here: no store, no HTTP client, no component.
 * `app:client` may only reach `entry`, `port` and `shared`, and every
 * providers file sits at its slice root (entry).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideAuth(),
    provideBooking(),
    provideCheckin(),
  ],
};
