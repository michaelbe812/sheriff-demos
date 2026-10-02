import { Provider } from '@angular/core';
import { AUTH_API } from './api/auth-api';
import { AuthStore } from './state/auth.store';

/** Slice root (entry, type:feature): wires the port contract to its impl. */
export function provideAuth(): Provider {
  return { provide: AUTH_API, useExisting: AuthStore };
}
