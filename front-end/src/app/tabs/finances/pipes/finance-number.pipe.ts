import { Pipe, PipeTransform } from '@angular/core';
import { AppService } from '../../../app.service';
import { formatFinanceAmount, FinanceNumberFormatOptions } from '../../../utils/number-utils';

@Pipe({
  name: 'financeNumber',
  pure: false
})
export class FinanceNumberPipe implements PipeTransform {
  constructor(private app: AppService) {}

  transform(value: number | null | undefined, options?: FinanceNumberFormatOptions): string {
    const mode = this.app.configurations?.financesConfig?.numberDisplayFormat || 'STANDARD';
    return formatFinanceAmount(value, mode, options);
  }
}
