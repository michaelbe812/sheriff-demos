import { Customer } from './customer';

/**
 * Pure business rule. No `inject()` anywhere in this folder — that is the
 * heuristic: if it needs inject(), it is not domain.
 */
export type LoyaltyTier = 'bronze' | 'silver' | 'gold';

export const loyaltyTierFor = (customer: Customer): LoyaltyTier => {
  if (customer.bookingCount >= 10) {
    return 'gold';
  }
  if (customer.bookingCount >= 3) {
    return 'silver';
  }
  return 'bronze';
};

export const discountPercentFor = (tier: LoyaltyTier): number =>
  ({ bronze: 0, silver: 5, gold: 10 })[tier];
