import { Provider } from '@angular/core';
import { CUSTOMER_API } from '@hex/customer/port-in';
import { CUSTOMER_REPOSITORY } from '@hex/customer/port-out';
import { CustomerApiAdapter } from '@hex/customer/adapter-driving';
import { InMemoryCustomerRepository } from '@hex/customer/adapter-driven';
import { CustomerStore, LoadCustomerUseCase } from '@hex/customer/domain';

/**
 * Slice composition root — the only module allowed to see both sides of this
 * hexagon (tag `type:providers`). Everything else stays on its own layer.
 *
 * Split in two deliberately:
 *   provideCustomerApi() — the PUBLIC port impl. Goes in app.config.ts, because
 *     booking needs CUSTOMER_API app-wide, and a lazy route would not have
 *     loaded it yet.
 *   provideCustomerUi()  — slice-private wiring. Goes on the route, so it stays
 *     lazy and scoped to the screens that need it.
 */
export const provideCustomerApi = (): Provider[] => [
  { provide: CUSTOMER_REPOSITORY, useClass: InMemoryCustomerRepository },
  LoadCustomerUseCase,
  { provide: CUSTOMER_API, useClass: CustomerApiAdapter },
];

export const provideCustomerUi = (): Provider[] => [CustomerStore];
