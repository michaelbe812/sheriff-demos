import { InjectionToken, Signal } from '@angular/core';

/**
 * PORT of the auth shared-feature: contract only (token + interfaces).
 * The implementation (AuthStore, type:data) is wired at the slice root via
 * provideAuth() — consumers inject AUTH_API and never see the store.
 */
export interface AuthUser {
  id: string;
  name: string;
}

export interface AuthApi {
  readonly user: Signal<AuthUser | null>;
  readonly isAuthenticated: Signal<boolean>;
}

export const AUTH_API = new InjectionToken<AuthApi>('AUTH_API');
