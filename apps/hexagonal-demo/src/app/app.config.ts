import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';
import { provideCustomerApi } from '@hex/customer/providers';

/**
 * Composition root.
 *
 * It provides customer's PUBLIC port app-wide, because booking injects
 * CUSTOMER_API from a lazily loaded route — a route-scoped provider would not
 * be visible there. Slice-private wiring stays on each slice's own route.
 *
 * Note what is NOT imported here: no repository, no adapter, no store. The
 * root only ever names `entry`- and `port`-tagged libs, which is exactly
 * what the `app:*` constraint permits. `customer-providers` is imported
 * statically here; `customer-shell` is lazy — hence two separate libs.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    ...provideCustomerApi(),
  ],
};
