/**
 * Domain core — plain TypeScript. No Angular, no rxjs, no imports at all.
 * Testable without a TestBed. Sheriff tag: core:customer / type:domain.
 */
export type CustomerId = string & { readonly __brand: 'CustomerId' };

export const toCustomerId = (raw: string): CustomerId => raw as CustomerId;

export interface Customer {
  readonly id: CustomerId;
  readonly name: string;
  readonly bookingCount: number;
}
