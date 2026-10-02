import { Injectable, signal } from '@angular/core';

/**
 * Component-LOCAL store: lives inside the ui lib (type:ui), intra-lib — never
 * checked, allowed. Domain/feature stores (type:state) stay off-limits for ui.
 */
@Injectable()
export class BookingCardStore {
  readonly expanded = signal(false);

  toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }
}
