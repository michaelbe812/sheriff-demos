import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-button',
  template: `
    <button type="button" [disabled]="disabled()" (click)="clicked.emit()">
      <ng-content />
    </button>
  `,
})
export class AppButton {
  readonly disabled = input(false);
  readonly clicked = output<void>();
}
