import type { CountryCode } from '../common/countries.js';
import { normaliseAbn } from './abn.js';

/**
 * A client's business number in the form the business's own country uses (backlog "Business number per country"):
 * AU ABN (ATO checksum), NZ NZBN (13 digits starting 94, GS1 check digit), UK Companies House number (8 digits, or
 * two letters and 6 digits), US EIN (9 digits with an IRS prefix). Stored in `clients.abn` (the column keeps its first
 * name; renaming a column holding data waits for David) as the plain characters, without spaces or dashes.
 * Keep `apps/web/lib/business-number.ts` (labels and display) in step.
 */
export interface BusinessNumberKind {
  /** What the country calls it, as a field label and in messages. */
  label: string;
  /** What a valid one looks like, for the error message and the input's hint. */
  hint: string;
}

export const BUSINESS_NUMBER: Record<CountryCode, BusinessNumberKind> = {
  AU: { label: 'ABN', hint: '11 digits' },
  NZ: { label: 'NZBN', hint: '13 digits starting 94' },
  US: { label: 'EIN', hint: '9 digits, like 12-3456789' },
  GB: { label: 'Company number', hint: '8 characters, like 01234567 or SC123456' },
};

/** GS1 check digit (used by NZBNs): weights 1 and 3 alternating from the left over the first 12 digits. */
export function gs1CheckDigit(first12: string): number {
  const sum = first12.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/** IRS EIN prefixes that are never issued (IRS list of valid campus prefixes). */
const EIN_UNUSED = new Set(['00', '07', '08', '09', '17', '18', '19', '28', '29', '49', '69', '70', '78', '79', '89', '96', '97']);

/** The business number tidied for storing, or null when it isn't a valid one for the country. */
export function normaliseBusinessNumber(country: CountryCode, input: string): string | null {
  const s = input.trim().toUpperCase().replace(/[\s.-]+/g, '');
  switch (country) {
    case 'AU': return normaliseAbn(s);
    case 'NZ':
      return /^94\d{11}$/.test(s) && gs1CheckDigit(s.slice(0, 12)) === Number(s[12]) ? s : null;
    case 'US':
      return /^\d{9}$/.test(s) && !EIN_UNUSED.has(s.slice(0, 2)) ? s : null;
    case 'GB': {
      // Companies House pads numbers to 8 digits with leading zeros; people often leave them off.
      const padded = /^\d{1,8}$/.test(s) ? s.padStart(8, '0') : s;
      return /^(\d{8}|[A-Z]{2}\d{6}|R0\d{6})$/.test(padded) && padded !== '00000000' ? padded : null;
    }
  }
}

/** The plain message when a business number isn't valid for the country. */
export const businessNumberProblem = (country: CountryCode) =>
  `${BUSINESS_NUMBER[country].label} is not valid (${BUSINESS_NUMBER[country].hint})`;
