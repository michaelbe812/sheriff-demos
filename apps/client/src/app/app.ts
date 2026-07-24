import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
// ERLAUBT: der Kurz-Alias zeigt auf den PORT (api/index.ts) — der Contract,
// nicht die Impl. Die Shell (app:client) darf `port`, `entry` und `shared`.
import { BookingApi } from '@blueprint/domains/booking/api';

// Alle folgenden Zeilen einkommentieren ⇒ genau die genannte Violation feuert.
//
// sheriff-violation-example: import { HttpBookingApi } from '@blueprint/domains/booking/infra/http-booking-api'; // app:client -> type:infra (Impl ist slice-privat, auch via Kurz-Alias nicht erreichbar)
// sheriff-violation-example: import { BookingStore } from '@blueprint/domains/booking/data/booking.store';       // app:client -> type:data (am Port vorbei)
// sheriff-violation-example: import { BookingCard } from '@blueprint/domains/booking/ui/booking-card';           // app:client -> type:ui (Shell sieht nur entry/port/shared)
// sheriff-violation-example: import { bookingLabel } from '@blueprint/domains/booking/utils/booking.utils';      // app:client -> type:utils (Slice-interna)

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  /**
   * Demo: die Shell bindet an den Contract. `BookingApi` ist eine abstrakte
   * Klasse (Variante B) — sie IST das DI-Token. Welche Impl dahinter steckt,
   * entscheidet provideBooking() am Slice-Root; hier ist sie unsichtbar.
   */
  private readonly bookingApi = inject(BookingApi);
}
