import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
// ERLAUBT: der Alias zeigt auf den PORT (booking/api, Tag `port`) — der
// Contract, nicht die Impl. Die App (type:app) darf shell, port und shared.
import { BookingApi } from '@blueprint/booking/api';

// Alle folgenden Zeilen einkommentieren ⇒ @nx/enforce-module-boundaries feuert.
//
// nx-violation-example: import { HttpBookingApi } from '@blueprint/booking/infra'; // type:app -> type:infra (Impl ist slice-privat)
// nx-violation-example: import { BookingStore } from '@blueprint/booking/data';    // type:app -> type:data (am Port vorbei)
// nx-violation-example: import { BookingCard } from '@blueprint/booking/ui';       // type:app -> type:ui
// nx-violation-example: import { bookingLabel } from '@blueprint/booking/utils';   // type:app -> type:utils (Slice-interna)

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App implements OnInit{
  /**
   * Demo: die Shell bindet an den Contract. `BookingApi` ist eine abstrakte
   * Klasse (Variante B) — sie IST das DI-Token. Welche Impl dahinter steckt,
   * bestimmt die Shell-Lib per provideBooking() (app.config.ts). Hier ist
   * sie unsichtbar.
   */
  private readonly bookingApi = inject(BookingApi);

  async ngOnInit() {
    await this.bookingApi.loadBookings()
  }
}
