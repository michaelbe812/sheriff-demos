import { Provider } from '@angular/core';
import { AUTH_API } from '@blueprint/auth/api';
import { AuthStore } from '@blueprint/auth/data';

/** Slice root (entry, type:feature): wires the port contract to its impl. */
export function provideAuth(): Provider {
  return { provide: AUTH_API, useExisting: AuthStore };
}
