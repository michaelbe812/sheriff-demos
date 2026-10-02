import { InjectionToken } from '@angular/core';

/** PUBLIC PORT of the checkin domain — cross-domain types re-exported here. */
export type { CheckinRecord } from '@blueprint/checkin/types';

/** Raw backend shape; mapped to the domain model inside the state lib. */
export interface CheckinDto {
  id: string;
  booking_id: string;
  guest_name: string;
  checked_in_at: string;
}

/**
 * CONTRACT ONLY — the implementation (HttpCheckinApi, type:infra) is wired at
 * the slice root by provideCheckin(). Consumers inject CHECKIN_API and bind
 * to this interface, so the HTTP client can be swapped or faked without
 * touching a single store.
 *
 * `type:api` has no clearance towards `type:infra` (and infra -> api would
 * close a project cycle), so this lib structurally cannot name its own
 * implementation — that is the inversion.
 *
 * Variant: INJECTION TOKEN + interface. The booking domain uses the abstract
 * class variant (libs/booking/api) — both are kept side by side on
 * purpose; see docs/architecture.md for the trade-off.
 * The token variant erases at compile time (no runtime class in the bundle)
 * and cannot be `extends`-ed by accident.
 */
export interface CheckinApi {
  loadCheckins(): Promise<CheckinDto[]>;
}

export const CHECKIN_API = new InjectionToken<CheckinApi>('CHECKIN_API');
