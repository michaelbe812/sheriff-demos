import { Provider } from '@angular/core';
import { CUSTOMER_API } from './in/customer-api.port';
import { CUSTOMER_REPOSITORY } from './out/customer-repository.port';
import { CustomerApiAdapter } from '../adapters/driving/customer-api.adapter';
import { InMemoryCustomerRepository } from '../adapters/driven/in-memory-customer.repository';
import { LoadCustomerUseCase } from '../application/load-customer.use-case';
import { CustomerStore } from '../application/customer.store';

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
