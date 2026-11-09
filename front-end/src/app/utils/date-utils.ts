import { DateFormatOption, DEFAULT_DATE_FORMAT } from '@models/configurations.model';

export { DateFormatOption, DEFAULT_DATE_FORMAT };

export interface FormatDateOptions {
  includeTime?: boolean;
}

// Bounded in-memory cache for ultra-fast repeated lookups
const DATE_CACHE_MAX_SIZE = 2000;
const dateCache = new Map<string, string>();

/**
 * Clears the memoized formatted date cache (e.g. when user changes date format configuration).
 */
export function clearDateFormatCache(): void {
  dateCache.clear();
}

/**
 * Formats a date string (YYYY-MM-DD, ISO, etc.), timestamp or Date object
 * into the configured date format ('DD.MM.YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY').
 * Default is 'DD.MM.YYYY'.
 * If options.includeTime is true and time information is available, appends ", HH:mm".
 * Results are memoized for sub-microsecond retrieval across change detection cycles.
 */
export function formatDateOption(
  date: string | Date | number | null | undefined,
  format: DateFormatOption = DEFAULT_DATE_FORMAT,
  options?: FormatDateOptions
): string {
  if (date === null || date === undefined || date === '') return '';

  const includeTime = Boolean(options?.includeTime);
  const cacheKey = `${typeof date === 'object' && date instanceof Date ? date.getTime() : String(date)}|${format}|${includeTime ? 1 : 0}`;

  const cached = dateCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let y = '';
  let m = '';
  let d = '';
  let hours = '';
  let minutes = '';
  let hasTime = false;

  if (typeof date === 'string') {
    const trimmed = date.trim();
    if (!trimmed) return '';

    // Check for ISO timestamp with T or space followed by time
    const timeMatch = trimmed.match(/[T\s](\d{2}):(\d{2})/);
    if (timeMatch) {
      hasTime = true;
      const dt = new Date(trimmed);
      if (!isNaN(dt.getTime())) {
        y = String(dt.getFullYear());
        m = String(dt.getMonth() + 1).padStart(2, '0');
        d = String(dt.getDate()).padStart(2, '0');
        hours = String(dt.getHours()).padStart(2, '0');
        minutes = String(dt.getMinutes()).padStart(2, '0');
      } else {
        hours = timeMatch[1];
        minutes = timeMatch[2];
      }
    }

    if (!y) {
      // Fast path: YYYY-MM-DD
      const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        y = isoMatch[1];
        m = isoMatch[2];
        d = isoMatch[3];
      } else {
        // Check for DD.MM.YYYY
        const dotMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (dotMatch) {
          d = dotMatch[1];
          m = dotMatch[2];
          y = dotMatch[3];
        } else {
          // Check for DD/MM/YYYY
          const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
          if (slashMatch) {
            d = slashMatch[1];
            m = slashMatch[2];
            y = slashMatch[3];
          } else {
            const dt = new Date(trimmed);
            if (isNaN(dt.getTime())) return trimmed;
            y = String(dt.getFullYear());
            m = String(dt.getMonth() + 1).padStart(2, '0');
            d = String(dt.getDate()).padStart(2, '0');
            hours = String(dt.getHours()).padStart(2, '0');
            minutes = String(dt.getMinutes()).padStart(2, '0');
            hasTime = true;
          }
        }
      }
    }
  } else {
    const dt = date instanceof Date ? date : new Date(date);
    if (isNaN(dt.getTime())) return '';
    y = String(dt.getFullYear());
    m = String(dt.getMonth() + 1).padStart(2, '0');
    d = String(dt.getDate()).padStart(2, '0');
    hours = String(dt.getHours()).padStart(2, '0');
    minutes = String(dt.getMinutes()).padStart(2, '0');
    hasTime = true;
  }

  let formattedDate = '';
  switch (format) {
    case 'YYYY-MM-DD':
      formattedDate = `${y}-${m}-${d}`;
      break;
    case 'DD/MM/YYYY':
      formattedDate = `${d}/${m}/${y}`;
      break;
    case 'DD.MM.YYYY':
    default:
      formattedDate = `${d}.${m}.${y}`;
      break;
  }

  let result = formattedDate;
  if (includeTime && hasTime && hours && minutes) {
    result = `${formattedDate}, ${hours}:${minutes}`;
  }

  // Prevent unbounded cache growth
  if (dateCache.size >= DATE_CACHE_MAX_SIZE) {
    dateCache.clear();
  }
  dateCache.set(cacheKey, result);

  return result;
}
