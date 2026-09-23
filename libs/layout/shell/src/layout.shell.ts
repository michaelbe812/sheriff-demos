import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavBar } from '@blueprint/layout/ui';

/** Slice root (entry): what the app shell composes into its routes. */
@Component({
  selector: 'app-layout-shell',
  imports: [RouterOutlet, NavBar],
  template: `
    <app-nav-bar />
    <main>
      <router-outlet />
    </main>
  `,
})
export class LayoutShell {}
