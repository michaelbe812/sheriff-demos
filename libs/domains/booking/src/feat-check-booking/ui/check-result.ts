import { Component, input } from '@angular/core';

@Component({
  selector: 'app-check-result',
  template: `
    @if (bookingId()) {
      <p>Last confirmed booking: {{ bookingId() }}</p>
    } @else {
      <p>No booking confirmed yet.</p>
    }
  `,
})
export class CheckResult {
  readonly bookingId = input<string | null>(null);
}
