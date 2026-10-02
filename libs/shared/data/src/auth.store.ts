import { computed, Injectable, signal } from '@angular/core';
import { AuthUser } from '@blueprint/shared/types';

/**
 * Auth state of the app. Lives in shared/data: without ports a slice cannot offer it to the others, so
 * state several slices need is shared. No token, no provideAuth(): root-provided, injected directly.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly currentUser = signal<AuthUser | null>({ id: 'u1', name: 'Michael' });

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  logout(): void {
    this.currentUser.set(null);
  }
}
