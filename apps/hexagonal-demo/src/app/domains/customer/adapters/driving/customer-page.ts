import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { CustomerStore } from '../../domain/customer.store';
import { loyaltyTierFor } from '../../domain/loyalty-tier';

/**
 * Driving adapter (UI). Reads signals straight from its OWN slice's store —
 * that is the pragmatic reading of "no store in ui": within a slice it is
 * allowed (otherwise signals in templates would be impossible); across slices
 * it is blocked by the scope axis.
 *
 * What it can NOT do: inject CUSTOMER_REPOSITORY or the HTTP adapter.
 * `type:adapter-driving` has no clearance towards `type:port-out` or
 * `type:adapter-driven`.
 */
@Component({
  selector: 'hex-customer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Customers</h2>
    @if (store.loading()) {
      <p>Loading…</p>
    } @else {
      <ul>
        @for (customer of store.customers(); track customer.id) {
          <li>
            <strong>{{ customer.name }}</strong>
            — {{ customer.bookingCount }} bookings
            <em>({{ tierOf(customer.bookingCount) }})</em>
          </li>
        }
      </ul>
      <p>{{ store.count() }} total</p>
    }
  `,
})
export class CustomerPage implements OnInit {
  protected readonly store = inject(CustomerStore);

  ngOnInit(): void {
    void this.store.load();
  }

  protected tierOf(bookingCount: number): string {
    // domain rule reused directly in the UI — allowed: type:adapter-driving
    // may import type:domain of its own slice.
    return loyaltyTierFor({ id: '' as never, name: '', bookingCount });
  }
}
