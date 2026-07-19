import { inject, Injectable } from '@angular/core';
import { toCustomerId } from '../../domain/customer';
import { discountPercentFor, loyaltyTierFor } from '../../domain/loyalty-tier';
import {
  CustomerApiPort,
  CustomerSummary,
} from '../../ports/in/customer-api.port';
import { LoadCustomerUseCase } from '../../domain/load-customer.use-case';

/**
 * Driving adapter implementing this slice's PUBLIC port.
 *
 * "Driving" because something outside (the booking slice) drives customer
 * through it — even though the caller is code, not a user.
 *
 * This is where branding happens: the port speaks plain strings so callers
 * never need customer's core; this adapter — which IS inside customer and may
 * see `core:customer` — converts and delegates. The translation belongs on
 * this side of the boundary, not the caller's.
 */
@Injectable()
export class CustomerApiAdapter implements CustomerApiPort {
  readonly #loadCustomer = inject(LoadCustomerUseCase);

  async exists(customerId: string): Promise<boolean> {
    return (await this.#loadCustomer.byId(toCustomerId(customerId))) !== null;
  }

  discountPercentFor(customerId: string): Promise<number> {
    return this.#loadCustomer.discountFor(toCustomerId(customerId));
  }

  async summaryOf(customerId: string): Promise<CustomerSummary | null> {
    const customer = await this.#loadCustomer.byId(toCustomerId(customerId));
    if (!customer) {
      return null;
    }
    const tier = loyaltyTierFor(customer);
    return {
      id: customer.id,
      name: customer.name,
      tier,
      discountPercent: discountPercentFor(tier),
    };
  }
}
