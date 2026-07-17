import { Injectable } from '@angular/core';
import { Customer, CustomerId, toCustomerId } from '../../domain/customer';
import { CustomerRepositoryPort } from '../../ports/out/customer-repository.port';

/**
 * Driven adapter — implements the out-port. This is the ONLY kind of place
 * allowed to know about I/O. Swap this for an HttpClient version and nothing
 * inward changes: that is the payoff of the inversion.
 *
 * It may not call use-cases (`type:adapter-driven` has no clearance towards
 * `type:app`) — that would invert the flow back on itself.
 */
const SEED: readonly Customer[] = [
  { id: toCustomerId('c-1'), name: 'Ada Lovelace', bookingCount: 12 },
  { id: toCustomerId('c-2'), name: 'Grace Hopper', bookingCount: 4 },
  { id: toCustomerId('c-3'), name: 'Alan Turing', bookingCount: 1 },
];

@Injectable()
export class InMemoryCustomerRepository implements CustomerRepositoryPort {
  async findById(id: CustomerId): Promise<Customer | null> {
    return SEED.find((customer) => customer.id === id) ?? null;
  }

  async findAll(): Promise<Customer[]> {
    return [...SEED];
  }
}
