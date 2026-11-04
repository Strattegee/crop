/**
 * How far someone lives from a site (David, 4 Nov): the API's `distanceKm`, an approximate straight line between
 * their home postcode and the site's postcode (GeoNames postcode data). Never a block; beyond the business's free range
 * (Settings) the API ranks people further away after the others.
 * "<1 km", "12 km", "140 km", "1,250 km"; null when unknown. Keep in step with `distanceWords` in apps/api/src/geo/distance.ts.
 */
export function distanceWords(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return '<1 km';
  return `${Math.round(km).toLocaleString('en-AU')} km`;
}

/** The title on a distance, so nobody reads it as a road distance or thinks CROP shows the address. */
export const DISTANCE_TITLE = 'Approximate straight-line distance from their home postcode';

/**
 * For the person themselves, on their offer (David, 4 Nov): "About 12 km from home", "Under 1 km from home"; null when
 * unknown. Keep in step with `homeWords` in apps/api/src/geo/distance.ts.
 */
export function homeWords(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return null;
  if (km < 1) return 'Under 1 km from home';
  return `About ${Math.round(km).toLocaleString('en-AU')} km from home`;
}
