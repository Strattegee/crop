import { COUNTRIES, isCountry, normalPostcode, type CountryCode } from '../common/countries.js';

/**
 * A person's addresses (David, 3 Nov 2026, answer 5; migration 0083). A person holds several, one of them current;
 * nothing is overwritten: a correction is a new row that replaces the old one, and removing keeps the row on file.
 * Pure: no database access.
 */
export interface AddressFields {
  label: string | null;
  line1: string;
  line2: string | null;
  suburb: string | null;
  region: string | null;
  postcode: string | null;
  country: CountryCode;
}

const clean = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};

/**
 * Reads an address from a request body (`label`, `line1`, `line2`, `suburb`, `state` or `region`, `postcode`,
 * `country`), checked against the country the way sites are: AU and US states from the list, postcodes in the
 * country's form. The country defaults to the business's. Returns the address or a plain problem.
 */
export function parseAddress(body: Record<string, unknown>, home: CountryCode): { address: AddressFields } | { problem: string } {
  const given = clean(body.country, 2);
  if (given && !isCountry(given.toUpperCase())) return { problem: 'Choose a country: Australia, New Zealand, United States or United Kingdom' };
  const country = (given ? given.toUpperCase() : home) as CountryCode;
  const c = COUNTRIES[country];
  for (const [k, max] of [['label', 40], ['line1', 200], ['line2', 200], ['suburb', 100], ['state', 60], ['region', 60], ['postcode', 10]] as const) {
    const v = body[k];
    if (typeof v === 'string' && v.trim().length > max) return { problem: `${FIELD[k]} is too long (${max} characters at most)` };
    if (v !== undefined && v !== null && typeof v !== 'string') return { problem: `${FIELD[k]} must be text` };
  }
  const line1 = clean(body.line1, 200);
  if (!line1) return { problem: 'Enter the street address' };
  let region = clean(body.state ?? body.region, 60);
  if (region && c.regions) {
    region = region.toUpperCase();
    if (!c.regions.includes(region)) return { problem: `Choose a ${c.regionLabel.toLowerCase()} in ${c.name}` };
  }
  let postcode = clean(body.postcode, 10);
  if (postcode) {
    postcode = normalPostcode(country, postcode);
    if (!c.postcode.test(postcode)) return { problem: `Postcode for ${c.name}: ${c.postcodeHint}` };
  }
  return {
    address: { label: clean(body.label, 40), line1, line2: clean(body.line2, 200), suburb: clean(body.suburb, 100), region, postcode, country },
  };
}

const FIELD: Record<string, string> = {
  label: 'Name for the address', line1: 'Street address', line2: 'Second line', suburb: 'Suburb or town', state: 'State or region',
  region: 'State or region', postcode: 'Postcode',
};

/** True when a correction changes nothing (so nothing is recorded). */
export function sameAddress(a: AddressFields, b: AddressFields): boolean {
  return (['label', 'line1', 'line2', 'suburb', 'region', 'postcode', 'country'] as const).every(k => (a[k] ?? null) === (b[k] ?? null));
}

/** "12 Example Street, Unit 3, Richmond VIC 3121", with the country's name when it isn't the business's. */
export function addressLine(a: Omit<AddressFields, 'label'>, home: CountryCode): string {
  const place = [a.suburb, [a.region, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return [a.line1, a.line2, place, a.country !== home ? COUNTRIES[a.country].name : null].filter(Boolean).join(', ');
}

/** Why an address can't be changed: removed or corrected ones are history. */
export function addressChangeRefusal(a: { replacedAt: unknown; removedAt: unknown }): string | null {
  if (a.replacedAt) return 'That address has been corrected since: change the newer version';
  if (a.removedAt) return 'That address has been taken off the list';
  return null;
}
