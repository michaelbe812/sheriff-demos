import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAuth } from '@blueprint/auth/shell';
import { provideBooking } from '@blueprint/booking/shell';
import { provideCheckin } from '@blueprint/checkin/shell';
import { appRoutes } from './app.routes';

/**
 * Composition root. Each provideX() binds a slice's port contract to its
 * implementation — wired in the slice's shell lib, the only lib allowed to
 * see both sides.
 *
 * Note what is NOT imported here: no store, no HTTP client, no component.
 * `type:app` may only reach `type:shell`, `port` and `scope:shared`.
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
