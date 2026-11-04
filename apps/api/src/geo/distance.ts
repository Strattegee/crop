import { readFileSync } from 'node:fs';
import { normalPostcode, isCountry, type CountryCode } from '../common/countries.js';

/**
 * Approximate straight-line distances between postcodes (David, 4 Nov: "distance from their home to the project").
 * Postcode points come from GeoNames (CC BY 4.0, see apps/api/data/geo/NOTICE), one point per postcode, loaded on
 * first use per country and kept in memory. Nothing is stored per person: distances are worked out on read.
 */
export interface Point { lat: number; lon: number }

const DATA_DIR = new URL('../../data/geo/', import.meta.url);
const tables = new Map<CountryCode, Map<string, Point>>();

/** Reads one country's file ("postcode<TAB>lat<TAB>lon" per line). Exported for tests. */
export function parsePostcodeTable(text: string): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const line of text.split('\n')) {
    const [code, lat, lon] = line.split('\t');
    if (!code || lat === undefined || lon === undefined) continue;
    const p = { lat: Number(lat), lon: Number(lon) };
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) out.set(code, p);
  }
  return out;
}

function table(country: CountryCode): Map<string, Point> {
  let t = tables.get(country);
  if (!t) {
    try {
      t = parsePostcodeTable(readFileSync(new URL(`postcodes-${country.toLowerCase()}.tsv`, DATA_DIR), 'utf8'));
    } catch {
      t = new Map();
    }
    tables.set(country, t);
  }
  return t;
}

/**
 * The keys to look a postcode up by, best first, tidied like sites and addresses (`normalPostcode`): AU/NZ the
 * 4 digits, US the 5-digit ZIP (a ZIP+4 drops the +4), UK the full code then its outward code ("LS1 1UR" → "LS1").
 */
export function postcodeKeys(country: CountryCode, postcode: string): string[] {
  const s = normalPostcode(country, postcode);
  if (!s) return [];
  if (country === 'US') return /^\d{5}(-\d{4})?$/.test(s) ? [s.slice(0, 5)] : [];
  if (country === 'GB') {
    const outward = s.includes(' ') ? s.split(' ')[0]! : s;
    return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? (s === outward ? [s] : [s, outward]) : [];
  }
  return /^\d{4}$/.test(s) ? [s] : [];
}

/** The point for a postcode in a country, or null when it isn't known (or the country isn't one CROP supports). */
export function postcodePoint(country: string | null | undefined, postcode: string | null | undefined): Point | null {
  if (!country || !postcode || !isCountry(country)) return null;
  const t = table(country);
  for (const k of postcodeKeys(country, postcode)) {
    const p = t.get(k);
    if (p) return p;
  }
  return null;
}

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance between two postcodes, rounded to 0.1 km, or null when either is unknown or they are in different
 * countries (never across countries).
 */
export function postcodeDistance(
  from: { country: string | null; postcode: string | null } | null | undefined,
  to: { country: string | null; postcode: string | null } | null | undefined,
): number | null {
  if (!from || !to || !from.country || from.country !== to.country) return null;
  const a = postcodePoint(from.country, from.postcode);
  const b = postcodePoint(to.country, to.postcode);
  if (!a || !b) return null;
  return Math.round(distanceKm(a, b) * 10) / 10;
}

/** "<1 km", "12 km", "140 km", "1,250 km"; null for unknown. Keep in step with the web's `distanceWords`. */
export function distanceWords(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return '<1 km';
  return `${Math.round(km).toLocaleString('en-AU')} km`;
}
