import type { PoolClient } from 'pg';
import { acrossSites } from '@crop/db';
import { DEFAULT_DISTANCE_FREE_KM, farAwayLast, postcodeDistance } from './distance.js';

/**
 * Approximate straight-line distance (km, 0.1) from each person's current home address postcode to a site's
 * postcode (within withTenant). Null when either postcode is missing or unknown, or the countries differ.
 *
 * Supervisors can't read addresses (`not_supervisor` on worker_addresses), but may see the distance (David, 4 Nov):
 * the postcodes are read with `acrossSites`, which lifts the limits for this query only, and only the number leaves
 * this function, never an address or postcode. The site must be one the caller can see.
 */
export async function homeDistances(db: PoolClient, facilityId: string, workerIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(workerIds.map(id => [id, null]));
  if (!workerIds.length) return out;
  const site = (await db.query<{ country: string; postcode: string | null }>(
    'select country, postcode from facilities where id = $1', [facilityId])).rows[0];
  if (!site?.postcode) return out;
  const homes = await acrossSites(db, async () => (await db.query<{ worker_id: string; country: string; postcode: string | null }>(
    `select worker_id, country, postcode from worker_addresses
      where is_current and removed_at is null and replaced_at is null and worker_id = any($1)`, [workerIds])).rows);
  for (const h of homes) out.set(h.worker_id, postcodeDistance(h, site));
  return out;
}

/**
 * How far one person's home is from each of several sites (km, 0.1; null when unknown), for their own offers and
 * shifts in the app (David, 4 Nov). Only the numbers leave this function.
 */
export async function myDistances(db: PoolClient, workerId: string, facilityIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(facilityIds)];
  const out = new Map<string, number | null>(ids.map(id => [id, null]));
  if (!ids.length) return out;
  const home = await acrossSites(db, async () => (await db.query<{ country: string; postcode: string | null }>(
    `select country, postcode from worker_addresses
      where is_current and removed_at is null and replaced_at is null and worker_id = $1`, [workerId])).rows[0]);
  if (!home?.postcode) return out;
  for (const f of (await db.query<{ id: string; country: string; postcode: string | null }>(
    'select id, country, postcode from facilities where id = any($1)', [ids])).rows) out.set(f.id, postcodeDistance(home, f));
  return out;
}

/** The shift's site, for `withDistance`. */
async function shiftSite(db: PoolClient, shiftId: string): Promise<string | null> {
  return (await db.query<{ facility_id: string }>('select facility_id from shifts where id = $1', [shiftId])).rows[0]?.facility_id ?? null;
}

/** The business's free range (km; 0 = distance never counts), within withTenant. */
export async function distanceFreeKm(db: PoolClient): Promise<number> {
  const r = (await db.query<{ distance_free_km: number }>('select distance_free_km from tenant_settings where tenant_id = app_tenant_id()')).rows[0];
  return r ? r.distance_free_km : DEFAULT_DISTANCE_FREE_KM;
}

/**
 * Adds `distanceKm` (null when unknown) to each candidate and puts people beyond the business's free range after the
 * others in their eligibility group (`farAwayLast`; David, 4 Nov). Never a block.
 */
export async function withDistance<C extends { workerId: string; eligible: boolean; available?: boolean; warnings: unknown[]; team?: unknown }>(
  db: PoolClient, shiftId: string, list: C[],
): Promise<(C & { distanceKm: number | null })[]> {
  const facilityId = await shiftSite(db, shiftId);
  const d = facilityId ? await homeDistances(db, facilityId, list.map(c => c.workerId)) : new Map<string, number | null>();
  return farAwayLast(list.map(c => ({ ...c, distanceKm: d.get(c.workerId) ?? null })), await distanceFreeKm(db));
}
