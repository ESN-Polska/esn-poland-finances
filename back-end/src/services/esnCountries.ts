import { default as Axios } from 'axios';
import { UserMembershipGroup } from '../models/user.model';

export const ESN_COUNTRIES_API_URL = 'https://accounts.esn.org/api/v2/countries';

const COUNTRIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let cachedCountriesLibrary: UserMembershipGroup[] | null = null;
let lastCountriesLibraryFetch = 0;

export const FALLBACK_COUNTRIES: Record<string, string> = {
  PL: 'ESN Poland',
  DE: 'ESN Germany',
  FR: 'ESN France',
  IT: 'ESN Italy',
  ES: 'ESN Spain',
  PT: 'ESN Portugal',
  CZ: 'ESN Czech Republic',
  SK: 'ESN Slovakia',
  AT: 'ESN Austria',
  BE: 'ESN Belgium',
  NL: 'ESN Netherlands',
  CH: 'ESN Switzerland',
  SE: 'ESN Sweden',
  NO: 'ESN Norway',
  FI: 'ESN Finland',
  DK: 'ESN Denmark',
  EE: 'ESN Estonia',
  LV: 'ESN Latvia',
  LT: 'ESN Lithuania',
  HU: 'ESN Hungary',
  RO: 'ESN Romania',
  BG: 'ESN Bulgaria',
  GR: 'ESN Greece',
  TR: 'ESN Turkey',
  HR: 'ESN Croatia',
  RS: 'ESN Serbia',
  BA: 'ESN Bosnia and Herzegovina',
  SI: 'ESN Slovenia',
  MK: 'ESN North Macedonia',
  AL: 'ESN Albania',
  ME: 'ESN Montenegro',
  CY: 'ESN Cyprus',
  MT: 'ESN Malta',
  IE: 'ESN Ireland',
  UK: 'ESN United Kingdom',
  LU: 'ESN Luxembourg',
  IS: 'ESN Iceland',
  UA: 'ESN Ukraine',
  GE: 'ESN Georgia',
  AM: 'ESN Armenia',
  AZ: 'ESN Azerbaijan',
  MD: 'ESN Moldova',
  KZ: 'ESN Kazakhstan',
  JO: 'ESN Jordan',
  LI: 'ESN Liechtenstein'
};

/**
 * Fetches the countries library from https://accounts.esn.org/api/v2/countries
 * with in-memory caching and fallback to static ESN country definitions.
 */
export async function getCountriesLibrary(): Promise<UserMembershipGroup[]> {
  const now = Date.now();
  if (cachedCountriesLibrary && now - lastCountriesLibraryFetch < COUNTRIES_CACHE_TTL_MS) {
    return cachedCountriesLibrary;
  }

  try {
    const res = await Axios.get(ESN_COUNTRIES_API_URL, { timeout: 6000 });
    const data = Array.isArray(res.data) ? res.data : [];
    const list: UserMembershipGroup[] = data
      .map((item: any) => ({
        code: String(item.code || item.cc || '').toUpperCase().trim(),
        name: String(item.label || item.country || item.code || '').trim()
      }))
      .filter((c: UserMembershipGroup) => c.code && c.name);

    if (list.length > 0) {
      cachedCountriesLibrary = list;
      lastCountriesLibraryFetch = now;
      return list;
    }
  } catch (err: any) {
    console.warn('Failed to fetch ESN countries library, using cached/fallback:', err?.message || err);
  }

  if (cachedCountriesLibrary && cachedCountriesLibrary.length > 0) {
    return cachedCountriesLibrary;
  }

  // Convert fallback dictionary to array
  const fallbackList: UserMembershipGroup[] = Object.entries(FALLBACK_COUNTRIES).map(([code, name]) => ({
    code,
    name
  }));
  cachedCountriesLibrary = fallbackList;
  lastCountriesLibraryFetch = now;
  return fallbackList;
}

/**
 * Match a country by section code prefix (e.g. 'PL' from 'PL-WROC-PWR').
 */
export function findCountryMatch(
  sectionCodeOrPrefix: string,
  countries: UserMembershipGroup[]
): UserMembershipGroup | undefined {
  if (!sectionCodeOrPrefix || !Array.isArray(countries) || countries.length === 0) {
    return undefined;
  }
  const prefix = sectionCodeOrPrefix.includes('-')
    ? sectionCodeOrPrefix.split('-')[0]?.toUpperCase().trim()
    : sectionCodeOrPrefix.toUpperCase().trim();

  if (!prefix || prefix.length < 2) return undefined;

  return countries.find(c => {
    const code = String(c?.code || '').toUpperCase().trim();
    const name = String(c?.name || '').toUpperCase().trim();
    return (
      code === prefix ||
      code === `ESN ${prefix}` ||
      code.startsWith(prefix) ||
      name === prefix ||
      name === `ESN ${prefix}` ||
      name.startsWith(`ESN ${prefix} `) ||
      name.endsWith(` (${prefix})`)
    );
  });
}

/**
 * Ensures that for every section provided, there is a corresponding country
 * entry in the returned countries list. If a country was not present in the OAuth response,
 * it is resolved from the ESN countries library (https://accounts.esn.org/api/v2/countries).
 */
export async function resolveCountriesForSections(
  sections: UserMembershipGroup[],
  existingCountries: UserMembershipGroup[] = []
): Promise<UserMembershipGroup[]> {
  const result: UserMembershipGroup[] = [...existingCountries];

  if (!sections || sections.length === 0) {
    return result;
  }

  let library: UserMembershipGroup[] = [];

  for (const s of sections) {
    const sCode = s.code || '';
    const prefix = sCode.includes('-')
      ? sCode.split('-')[0]?.toUpperCase().trim()
      : sCode.toUpperCase().trim();

    if (!prefix || prefix.length < 2) continue;

    const alreadyMatched = findCountryMatch(prefix, result);
    if (!alreadyMatched) {
      if (library.length === 0) {
        library = await getCountriesLibrary();
      }
      const libMatch = findCountryMatch(prefix, library);
      if (libMatch) {
        result.push({
          code: libMatch.code,
          name: libMatch.name
        });
      } else if (FALLBACK_COUNTRIES[prefix]) {
        result.push({
          code: prefix,
          name: FALLBACK_COUNTRIES[prefix]
        });
      } else {
        result.push({
          code: prefix,
          name: `ESN ${prefix}`
        });
      }
    }
  }

  return result.filter(
    (c, idx, self) =>
      self.findIndex(
        o => (o.code && o.code === c.code) || (o.name && o.name === c.name)
      ) === idx
  );
}
