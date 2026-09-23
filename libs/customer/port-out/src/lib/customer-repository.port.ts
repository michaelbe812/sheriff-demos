import { InjectionToken } from '@angular/core';
import type { Customer, CustomerId } from '@hex/customer/domain';

/**
 * Driven port — what the core needs FROM the world. Private to this slice:
 * tagged `type:port-out`, never `port`, so no other slice can reach it.
 *
 * The use-case depends on this interface; the HTTP adapter implements it.
 * That inversion is the whole point — the core never names HttpClient.
 */
export interface CustomerRepositoryPort {
  findById(id: CustomerId): Promise<Customer | null>;
  findAll(): Promise<Customer[]>;
}

export const CUSTOMER_REPOSITORY = new InjectionToken<CustomerRepositoryPort>(
  'CustomerRepository',
);
