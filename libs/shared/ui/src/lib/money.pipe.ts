import { Pipe, PipeTransform } from '@angular/core';
import { formatMoney } from '@hex/shared/util';

/** Dumb shared UI. type:ui may see type:ui, type:util, type:types — never a slice. */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(amount: number): string {
    return formatMoney(amount);
  }
}
