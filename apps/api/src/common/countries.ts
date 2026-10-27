/**
 * Countries CROP supports, in the order David and Steve chose (27 Oct): Australia, New Zealand, the USA, the UK.
 * Each has its time zones, how a site's region and postcode look, and a sensible default time zone.
 */
export type CountryCode = 'AU' | 'NZ' | 'US' | 'GB';
export const COUNTRY_CODES: CountryCode[] = ['AU', 'NZ', 'US', 'GB'];

export const AU_STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
export const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY'] as const;

export interface Country {
  name: string;
  regionLabel: string;
  /** Fixed list of regions (states), or null for free text. */
  regions: readonly string[] | null;
  postcode: RegExp;
  postcodeHint: string;
  zones: string[];
  defaultZone: string;
  /** Time zone from the region, where one region means one zone. */
  zoneFor?: Record<string, string>;
}

export const COUNTRIES: Record<CountryCode, Country> = {
  AU: {
    name: 'Australia', regionLabel: 'State', regions: AU_STATES, postcode: /^\d{4}$/, postcodeHint: '4 digits',
    zones: ['Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'Australia/Broken_Hill', 'Australia/Lord_Howe'],
    defaultZone: 'Australia/Melbourne',
    zoneFor: { VIC: 'Australia/Melbourne', NSW: 'Australia/Sydney', ACT: 'Australia/Sydney', QLD: 'Australia/Brisbane', SA: 'Australia/Adelaide', WA: 'Australia/Perth', TAS: 'Australia/Hobart', NT: 'Australia/Darwin' },
  },
  NZ: {
    name: 'New Zealand', regionLabel: 'Region', regions: null, postcode: /^\d{4}$/, postcodeHint: '4 digits',
    zones: ['Pacific/Auckland', 'Pacific/Chatham'], defaultZone: 'Pacific/Auckland',
  },
  US: {
    name: 'United States', regionLabel: 'State', regions: US_STATES, postcode: /^\d{5}(-\d{4})?$/, postcodeHint: '5 digits (ZIP)',
    zones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
    defaultZone: 'America/New_York',
    zoneFor: { HI: 'Pacific/Honolulu', AZ: 'America/Phoenix', CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
      CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver', MT: 'America/Denver', WY: 'America/Denver',
      IL: 'America/Chicago', TX: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago', MO: 'America/Chicago', LA: 'America/Chicago', IA: 'America/Chicago',
      AR: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', OK: 'America/Chicago', KS: 'America/Chicago', NE: 'America/Chicago',
      NY: 'America/New_York', NJ: 'America/New_York', PA: 'America/New_York', MA: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York',
      VA: 'America/New_York', NC: 'America/New_York', SC: 'America/New_York', OH: 'America/New_York', MI: 'America/New_York', MD: 'America/New_York',
      DC: 'America/New_York', CT: 'America/New_York', RI: 'America/New_York', VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York',
      DE: 'America/New_York', WV: 'America/New_York' },
  },
  GB: {
    name: 'United Kingdom', regionLabel: 'County', regions: null, postcode: /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/, postcodeHint: 'e.g. SW1A 1AA',
    zones: ['Europe/London'], defaultZone: 'Europe/London',
  },
};

export const isCountry = (v: unknown): v is CountryCode => typeof v === 'string' && (COUNTRY_CODES as string[]).includes(v);

/** Tidies a postcode the way the country writes it (UK upper case with one space). */
export function normalPostcode(country: CountryCode, v: string): string {
  const s = v.trim().toUpperCase();
  if (country === 'GB') return s.replace(/\s+/g, '').replace(/^(.+)(\d[A-Z]{2})$/, '$1 $2');
  return s;
}

/** The time zone for a new or moved site: the one given, else from the region, else the country's default. */
export function siteZone(country: CountryCode, region: string | null, given: string | null): string {
  if (given) return given;
  const c = COUNTRIES[country];
  return (region && c.zoneFor?.[region]) || c.defaultZone;
}
