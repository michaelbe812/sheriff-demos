import { Routes } from '@angular/router';
import { CustomerPage } from '@hex/customer/adapter-driving';
import { provideCustomerUi } from '@hex/customer/providers';

/**
 * Slice entry point (tag `entry`) — lazy-loaded by the app.
 *
 * Slice-private providers go here so they stay scoped to this route subtree.
 * The public port is provided app-wide instead (see app.config.ts), which is
 * why providers live in their own lib: the app imports `customer-providers`
 * statically and this lib dynamically — Nx forbids both on the same lib.
 */
export const customerRoutes: Routes = [
  {
    path: '',
    providers: [...provideCustomerUi()],
    component: CustomerPage,
  },
];
