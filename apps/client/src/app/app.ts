import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BookingApi } from '@blueprint/booking/api';
// boundary-violation-example: import { BookingStore } from '@blueprint/booking/data'; // shell -> lib internals (only entry/port)

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  bla = inject(BookingApi);
}
