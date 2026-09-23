import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-nav-bar',
  imports: [RouterLink],
  template: `
    <nav>
      <a routerLink="/bookings">Bookings</a>
      <a routerLink="/checkin">Check-in</a>
    </nav>
  `,
})
export class NavBar {}
