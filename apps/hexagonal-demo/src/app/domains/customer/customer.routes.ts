import { Routes } from '@angular/router';
import { provideCustomerUi } from './ports/customer.providers';

/**
 * Slice entry point (tag `entry`) — the only module app.routes.ts may see.
 * Without it the composition root would have to reach into adapters/.
 *
 * Slice-private providers go here so they stay lazy and scoped to this route
 * subtree. The public port is provided app-wide instead (see app.config.ts).
 */
export const customerRoutes: Routes = [
  {
    path: '',
    providers: [...provideCustomerUi()],
    loadComponent: () =>
      import('./adapters/driving/customer-page').then((m) => m.CustomerPage),
  },
];
