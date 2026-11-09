import { Pipe, PipeTransform } from '@angular/core';
import { AppService } from '../app.service';
import { FormatDateOptions } from '../utils/date-utils';

@Pipe({
  name: 'appDate',
  pure: false,
  standalone: true
})
export class AppDatePipe implements PipeTransform {
  private lastInput: string | Date | number | null | undefined;
  private lastOptionsKey: string | undefined;
  private lastFormat: string | undefined;
  private lastResult: string = '';

  constructor(private app: AppService) {}

  transform(
    value: string | Date | number | null | undefined,
    options?: FormatDateOptions | string
  ): string {
    if (value === null || value === undefined || value === '') return '';

    const opts = typeof options === 'string'
      ? { includeTime: options === 'withTime' || options === 'time' }
      : options;

    const optsKey = opts?.includeTime ? 'time' : 'date';
    const curFormat = this.app.dateFormat;

    // Fast path: if inputs and format are identical to previous check, return cached string in 0ms
    if (
      value === this.lastInput &&
      optsKey === this.lastOptionsKey &&
      curFormat === this.lastFormat
    ) {
      return this.lastResult;
    }

    this.lastInput = value;
    this.lastOptionsKey = optsKey;
    this.lastFormat = curFormat;
    this.lastResult = this.app.formatDate(value, opts);

    return this.lastResult;
  }
}
