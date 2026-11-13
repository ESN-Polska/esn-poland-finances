/**
 * Utility functions for bank account and IBAN formatting and validation.
 */

/**
 * Formats a 26-digit Polish domestic bank account number (NRB format: 2 + 6*4 digits).
 * e.g. "52114020040000370278113216" -> "52 1140 2004 0000 3702 7811 3216"
 */
export function formatDomesticAccount(value: string | null | undefined): string {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '').slice(0, 26);
  if (digits.length <= 2) return digits;
  const firstTwo = digits.slice(0, 2);
  const rest = digits.slice(2);
  const restGroups = rest.match(/.{1,4}/g);
  return restGroups ? `${firstTwo} ${restGroups.join(' ')}` : firstTwo;
}

/**
 * Formats an international IBAN into standard 4-character blocks.
 * e.g. "PL52114020040000370278113216" -> "PL52 1140 2004 0000 3702 7811 3216"
 * or "DE89370400440532013000" -> "DE89 3704 0044 0532 0130 00"
 */
export function formatInternationalIban(value: string | null | undefined): string {
  if (!value) return '';
  const cleaned = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 34);
  return cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
}

/**
 * Formats an account number depending on whether it's domestic or international.
 */
export function formatIban(value: string | null | undefined, forceType?: 'DOMESTIC' | 'INTERNATIONAL'): string {
  if (!value) return '';
  const type = forceType || (
    /^[A-Za-z]{2}/.test(String(value).trim()) && !String(value).trim().toUpperCase().startsWith('PL')
      ? 'INTERNATIONAL'
      : 'DOMESTIC'
  );
  if (type === 'DOMESTIC') {
    return formatDomesticAccount(value);
  }
  return formatInternationalIban(value);
}

/**
 * Formats an account number for display (e.g. in view / payouts tables).
 */
export function formatIbanDisplay(val: string | null | undefined, isDomestic?: boolean): string {
  if (!val) return '—';
  const trimmed = String(val).trim();
  if (!trimmed) return '—';
  const clean = trimmed.replace(/\s+/g, '');
  if (isDomestic !== undefined) {
    return isDomestic ? formatDomesticAccount(clean) : formatInternationalIban(clean);
  }
  // Auto-detect: if starts with non-PL letters, international; if 26 digits or PL + 26 digits, domestic
  if (/^[A-Za-z]{2}/.test(clean) && !clean.toUpperCase().startsWith('PL')) {
    return formatInternationalIban(clean);
  }
  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length === 26) {
    return formatDomesticAccount(clean);
  }
  return formatInternationalIban(clean);
}

export function formatSwift(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
}

export function isValidDomesticAccount(val: string | null | undefined): boolean {
  const clean = (val || '').replace(/\D/g, '');
  return clean.length === 26;
}

export function isValidInternationalIban(val: string | null | undefined): boolean {
  const clean = (val || '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{13,32}$/.test(clean);
}

export function isValidSwift(val: string | null | undefined): boolean {
  const clean = (val || '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$|^[A-Z0-9]{11}$/.test(clean);
}

