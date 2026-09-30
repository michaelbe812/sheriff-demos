import { computed, inject, Injectable, signal } from '@angular/core';
import { Customer } from '@hex/customer/model';
import { LoadCustomerUseCase } from './load-customer.use-case';

/**
 * Application state — signal store. Lives in `application/`, NOT in domain/
 * (it knows about loading and async) and NOT in the UI (it must survive a
 * component being swapped).
 *
 * The UI of THIS slice may read these signals directly. The UI of another
 * slice may not — the scope axis blocks it, which is the useful reading of
 * "a store must not be used from ui".
 *
 * Plain signals here to keep the blueprint dependency-free; swap in
 * @ngrx/signals `signalStore` without any structural change.
 */
@Injectable()
export class CustomerStore {
  readonly #loadCustomers = inject(LoadCustomerUseCase);

  readonly #customers = signal<Customer[]>([]);
  readonly #loading = signal(false);

  readonly customers = this.#customers.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly count = computed(() => this.#customers().length);

  async load(): Promise<void> {
    this.#loading.set(true);
    try {
      this.#customers.set(await this.#loadCustomers.all());
    } finally {
      this.#loading.set(false);
    }
  }
}
