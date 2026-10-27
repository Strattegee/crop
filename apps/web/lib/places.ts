export const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
export const CLIENT_STATUS: Record<string, [string, 'ok' | 'warn' | 'neutral']> = {
  active: ['Active', 'ok'], on_hold: ['On hold', 'warn'], inactive: ['Inactive', 'neutral'],
};
export const SPECIALTIES = ['Aged Care', 'Medical', 'Surgical', 'Emergency', 'Intensive Care', 'Mental Health', 'Paediatrics', 'Maternity', 'Rehabilitation', 'Community', 'Disability'];

/** Countries CROP supports (David and Steve, 27 Oct), mirroring apps/api/src/common/countries.ts. */
export const COUNTRIES = {
  AU: { name: 'Australia', zones: ['Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'Australia/Broken_Hill', 'Australia/Lord_Howe'] },
  NZ: { name: 'New Zealand', zones: ['Pacific/Auckland', 'Pacific/Chatham'] },
  US: { name: 'United States', zones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'] },
  GB: { name: 'United Kingdom', zones: ['Europe/London'] },
} as const;
export type CountryCode = keyof typeof COUNTRIES;
export const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY'];

/** "America/Los_Angeles" → "Los Angeles". */
export const zoneName = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ');

/** A place's country, area and postcode in one line. */
export function placeLine(p: { addressLine?: string | null; suburb?: string | null; state?: string | null; postcode?: string | null; country?: string | null }, home: string = 'AU') {
  const local = [p.addressLine, p.suburb, [p.state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const abroad = p.country && p.country !== home ? COUNTRIES[p.country as CountryCode]?.name ?? p.country : null;
  return [local, abroad].filter(Boolean).join(', ');
}
