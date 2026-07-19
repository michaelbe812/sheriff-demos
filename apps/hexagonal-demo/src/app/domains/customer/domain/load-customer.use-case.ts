import { inject, Injectable } from '@angular/core';
import { Customer, CustomerId } from './customer';
import {
  discountPercentFor,
  LoyaltyTier,
  loyaltyTierFor,
} from './loyalty-tier';
import { CUSTOMER_REPOSITORY } from '../ports/out/customer-repository.port';

/**
 * Use-case: orchestrates the domain and the driven port. It injects the PORT
 * token, never the HTTP adapter — `type:app` has no clearance towards
 * `type:adapter-driven`, so Sheriff would reject the shortcut.
 */
@Injectable()
export class LoadCustomerUseCase {
  readonly #customers = inject(CUSTOMER_REPOSITORY);

  byId(id: CustomerId): Promise<Customer | null> {
    return this.#customers.findById(id);
  }

  all(): Promise<Customer[]> {
    return this.#customers.findAll();
  }

  async tierOf(id: CustomerId): Promise<LoyaltyTier> {
    const customer = await this.#customers.findById(id);
    if (!customer) {
      return 'bronze';
    }
    return loyaltyTierFor(customer);
  }

  async discountFor(id: CustomerId): Promise<number> {
    return discountPercentFor(await this.tierOf(id));
  }
}
