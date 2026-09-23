import { InjectionToken } from '@angular/core';
import type { LoyaltyTier } from '@hex/customer/domain';

/**
 * PUBLIC API of the customer slice — the only module other slices may import.
 * Tagged `port`, which is what makes it cross-slice reachable.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PORT SPEAKS IN PRIMITIVES AND ITS OWN SUMMARY TYPE:
 *
 * The first draft took `CustomerId` — a branded type that only customer's core
 * can mint. That forced booking to import `toCustomerId` from `core:customer`,
 * and Sheriff rejected it: a foreign core is sealed, `port` or not.
 *
 * The rule exposed a real design flaw, not a false positive. A port whose
 * signature can only be satisfied by reaching into the core is not a boundary
 * — it leaks the core through its own front door. So the port takes a plain
 * string, brands it internally, and hands back `CustomerSummary`: a flat view
 * owned by the port itself, not the core's `Customer` entity.
 *
 * Net effect: callers depend on this file and nothing else of customer.
 */

/** Flat, caller-facing view. Deliberately NOT the core's `Customer` entity. */
export interface CustomerSummary {
  readonly id: string;
  readonly name: string;
  readonly tier: LoyaltyTier;
  readonly discountPercent: number;
}

export interface CustomerApiPort {
  exists(customerId: string): Promise<boolean>;
  /** Percentage off, already derived from the customer's loyalty tier. */
  discountPercentFor(customerId: string): Promise<number>;
  summaryOf(customerId: string): Promise<CustomerSummary | null>;
}

export const CUSTOMER_API = new InjectionToken<CustomerApiPort>('CustomerApi');
