import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BookingApi } from '@blueprint/domains/booking/api';
// sheriff-violation-example: import { BookingStore } from '@blueprint/domains/booking/data/booking.store'; // shell -> lib internals (only entry/port)

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  bla = inject(BookingApi);
}
