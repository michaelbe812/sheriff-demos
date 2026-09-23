import { computed, Injectable, signal } from '@angular/core';
import { AuthApi, AuthUser } from '@blueprint/auth/api';

@Injectable({ providedIn: 'root' })
export class AuthStore implements AuthApi {
  private readonly currentUser = signal<AuthUser | null>({ id: 'u1', name: 'Michael' });

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  logout(): void {
    this.currentUser.set(null);
  }
}
