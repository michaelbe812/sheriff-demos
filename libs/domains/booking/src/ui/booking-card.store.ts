import { Injectable, signal } from '@angular/core';

/**
 * Component-LOCAL store: lives inside the ui bucket, so it is type:ui —
 * allowed. Domain/feature stores (type:state) stay off-limits for ui.
 */
@Injectable()
export class BookingCardStore {
  readonly expanded = signal(false);

  toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }
}
