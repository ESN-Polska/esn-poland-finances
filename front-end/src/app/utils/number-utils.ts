/**
 * Utility functions for locale-aware numeric parsing and formatting.
 */

/**
 * Parses user-entered numeric strings into a valid JavaScript number.
 * Supports:
 * - Polish accounting: 12.454,32 (dot thousands, comma decimal)
 * - Polish space-separated: 12 454,32 (space thousands, comma decimal)
 * - Polish plain decimal: 12454,32 or 12,50
 * - International standard: 12,454.32 (comma thousands, dot decimal)
 * - Standard decimal: 12454.32 or 12.50
 * - Standard integer: 12454
 */
export function parseLocaleNumber(
  raw: string | number | null | undefined,
  allowNegative: boolean = false
): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'number') {
    if (isNaN(raw) || !isFinite(raw)) return undefined;
    if (!allowNegative && raw < 0) return undefined;
    return raw;
  }

  let str = String(raw).trim().replace(/[\s\u00a0]/g, '');
  if (!str) return undefined;

  // Disallow negative values if not explicitly allowed
  if (!allowNegative && str.includes('-')) return undefined;

  // Disallow scientific notation
  if (/[eE]/.test(str)) return undefined;

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      // e.g. 12.454,32 -> dot thousands, comma decimal
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // e.g. 12,454.32 -> comma thousands, dot decimal
      str = str.replace(/,/g, '');
    }
  } else if (hasComma) {
    // e.g. 12454,32 or 12,50
    str = str.replace(',', '.');
  }

  // Strict regex check: allows optional leading minus (only if allowNegative),
  // integer digits, and optional decimal dot with 1 or 2 digits.
  const regex = allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!regex.test(str)) {
    return undefined;
  }

  const num = parseFloat(str);
  return isNaN(num) || !isFinite(num) ? undefined : num;
}

/**
 * Formats a number with Polish or English locale convention.
 */
export function formatLocaleNumber(
  val: number | null | undefined,
  locale: string = 'pl',
  minDecimals = 2,
  maxDecimals = 2
): string {
  if (val === null || val === undefined || isNaN(val)) return '';
  const isPl = (locale || '').toLowerCase().startsWith('pl');
  const fixed = val.toFixed(maxDecimals);
  const parts = fixed.split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] || '';

  if (isPl) {
    // Polish convention: space thousands separator, comma decimal separator
    const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
    return decimalPart ? `${withThousands},${decimalPart}` : withThousands;
  } else {
    // English convention: comma thousands separator, dot decimal separator
    const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimalPart ? `${withThousands}.${decimalPart}` : withThousands;
  }
}

export interface FinanceNumberFormatOptions {
  currency?: string;          // e.g. 'PLN', 'EUR'
  forceSign?: boolean;        // whether to prefix positive numbers with '+' in STANDARD mode
  minDecimals?: number;       // default 2
  maxDecimals?: number;       // default 2
  emptyPlaceholder?: string;  // fallback for null/undefined/NaN, e.g. '-' or '0,00'
  locale?: string;            // default 'pl'
}

/**
 * Formats an amount based on the selected display format:
 * - 'STANDARD': +1 234,56 PLN / -1 234,56 PLN
 * - 'ACCOUNTING': 1 234,56 PLN / (1 234,56) PLN
 */
export function formatFinanceAmount(
  val: number | null | undefined,
  format: 'STANDARD' | 'ACCOUNTING' = 'STANDARD',
  options?: FinanceNumberFormatOptions
): string {
  if (val === null || val === undefined || isNaN(val)) {
    return options?.emptyPlaceholder !== undefined ? options.emptyPlaceholder : '-';
  }

  const locale = options?.locale || 'pl';
  const minDec = options?.minDecimals ?? 2;
  const maxDec = options?.maxDecimals ?? 2;
  const curr = options?.currency ? ` ${options.currency}` : '';

  const isZero = Math.abs(val) < 0.000001;
  if (isZero) {
    const zeroFormatted = formatLocaleNumber(0, locale, minDec, maxDec);
    return `${zeroFormatted}${curr}`;
  }

  const absVal = Math.abs(val);
  const formattedAbs = formatLocaleNumber(absVal, locale, minDec, maxDec);

  if (format === 'ACCOUNTING') {
    if (val < 0) {
      return `(${formattedAbs})${curr}`;
    }
    return `${formattedAbs}${curr}`;
  }

  // STANDARD
  if (val < 0) {
    return `-${formattedAbs}${curr}`;
  }
  if (val > 0 && options?.forceSign) {
    return `+${formattedAbs}${curr}`;
  }
  return `${formattedAbs}${curr}`;
}

