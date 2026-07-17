import { Component, inject, signal } from '@angular/core';
// Foreign domain ONLY via its public port (works identically for a lib):
import { Booking, BookingApi } from '@blueprint/domains/booking/api/booking-api';
// Shared-feature ONLY via its port:
import { AUTH_API } from '../../../shared-features/auth/api/auth-api';
import { AppButton } from '../../../shared/ui/button';
import { pluralize } from '../../../shared/utils/pluralize';

// sheriff-violation-example: import { BookingStore } from '@blueprint/domains/booking/data/booking.store'; // foreign domain internals
// sheriff-violation-example: import { AuthStore } from '../../../shared-features/auth/data/auth.store'; // shared-feature internals

@Component({
  selector: 'app-feat-checkin',
  imports: [AppButton],
  template: `
    <h2>Check-in</h2>
    @if (auth.user(); as user) {
      <p>Agent: {{ user.name }}</p>
    }
    <app-button (clicked)="loadArrivals()">Load arrivals</app-button>
    <p>{{ arrivals().length }} {{ arrivalsLabel }}</p>
  `,
})
export class FeatCheckin {
  protected readonly auth = inject(AUTH_API);
  private readonly bookingApi = inject(BookingApi);

  protected readonly arrivals = signal<Booking[]>([]);

  protected get arrivalsLabel(): string {
    return pluralize(this.arrivals().length, 'arrival', 'arrivals');
  }

  protected async loadArrivals(): Promise<void> {
    this.arrivals.set(await this.bookingApi.loadBookings());
  }
}
