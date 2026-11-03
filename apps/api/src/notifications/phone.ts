import type { CountryCode } from '../common/countries.js';

/**
 * Mobile numbers per country (backlog "Phone numbers and texts per country", 3 Nov). A person's mobile is stored in
 * international form (E.164: +61412345678, +64211234567, +12125550123, +447700900123). Numbers are typed the way the
 * business's country writes them (0412 345 678 in Australia, 021 123 4567 in New Zealand, (212) 555-0123 in the USA,
 * 07700 900123 in the UK), or with a + and country code for someone from another of CROP's countries.
 * Texts still go to Australian mobiles only: sending abroad costs more and waits for David (`smsRefusal`).
 * The web shows them with `apps/web/lib/phone.ts` (keep the examples in step).
 */
export interface Mobile { e164: string; country: CountryCode }

/** The national significant number (after the country code) of a mobile, per country. */
const MOBILE: Record<CountryCode, { code: string; nsn: RegExp; trunk: string | null }> = {
  AU: { code: '61', nsn: /^4\d{8}$/, trunk: '0' },
  // New Zealand mobiles: 020, 021, 022, 027, 028, 029, then 6 to 8 digits.
  NZ: { code: '64', nsn: /^2[012789]\d{6,8}$/, trunk: '0' },
  // North American numbers: area code and exchange never start with 0 or 1. Mobiles aren't told apart from landlines.
  US: { code: '1', nsn: /^[2-9]\d{2}[2-9]\d{6}$/, trunk: null },
  GB: { code: '44', nsn: /^7\d{9}$/, trunk: '0' },
};

/** Example for each country, as its people would type it. */
export const MOBILE_EXAMPLE: Record<CountryCode, string> = {
  AU: '0412 345 678', NZ: '021 123 4567', US: '(212) 555-0123', GB: '07700 900123',
};

const ORDER: CountryCode[] = ['AU', 'NZ', 'US', 'GB'];

/** The mobile in international form, or null when it isn't a mobile number for the business's country or (with +) one of CROP's countries. */
export function parseMobile(country: CountryCode, input: string | null | undefined): Mobile | null {
  if (!input) return null;
  const raw = input.trim().replace(/[\s().-]/g, '');
  if (!/^(\+|00)?\d+$/.test(raw)) return null;
  const intl = raw.startsWith('+') ? raw.slice(1) : raw.startsWith('00') ? raw.slice(2) : null;
  if (intl !== null) {
    for (const c of ORDER) {
      const m = MOBILE[c];
      if (!intl.startsWith(m.code)) continue;
      let nsn = intl.slice(m.code.length);
      // "+61 0412 345 678": a trunk 0 written after the country code.
      if (m.trunk && nsn.startsWith(m.trunk)) nsn = nsn.slice(m.trunk.length);
      if (m.nsn.test(nsn)) return { e164: `+${m.code}${nsn}`, country: c };
    }
    return null;
  }
  const m = MOBILE[country];
  // National form: with the trunk prefix (0412…), or the country code without the + (61412…).
  const candidates = [
    m.trunk && raw.startsWith(m.trunk) ? raw.slice(m.trunk.length) : null,
    raw.startsWith(m.code) ? raw.slice(m.code.length) : null,
    m.trunk ? null : raw,
  ];
  for (const nsn of candidates) if (nsn !== null && m.nsn.test(nsn)) return { e164: `+${m.code}${nsn}`, country };
  return null;
}

/** The refusal for a number that isn't a mobile, with the business's country's example. */
export const mobileProblem = (country: CountryCode) =>
  `Mobile is not a mobile number (for example ${MOBILE_EXAMPLE[country]}, or start with + and the country code)`;

/** Why a text can't go to this number, or null when it can. Texts go to Australian mobiles only for now. */
export function smsRefusal(m: Mobile | null): string | null {
  if (!m) return 'Not a mobile number';
  if (m.country !== 'AU') return 'Texts outside Australia are not switched on yet';
  return null;
}

/**
 * The digits to look for when someone searches people by phone: "0412 345" finds +61412345678 (the trunk 0 is left
 * off). Null unless the search is mostly a number of at least 4 digits.
 */
export function phoneSearchDigits(search: string | null | undefined): string | null {
  if (!search || !/^[\d\s()+.-]+$/.test(search.trim())) return null;
  const digits = search.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 4 ? digits : null;
}

/** Normalises an Australian mobile number to +614XXXXXXXX, or returns null if it isn't one. */
export function auMobile(input: string | null | undefined): string | null {
  const m = parseMobile('AU', input);
  return m && m.country === 'AU' ? m.e164 : null;
}
