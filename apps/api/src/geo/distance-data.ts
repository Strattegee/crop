import type { PoolClient } from 'pg';
import { acrossSites } from '@crop/db';
import { postcodeDistance } from './distance.js';

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

/** The shift's site, for `withDistance`. */
async function shiftSite(db: PoolClient, shiftId: string): Promise<string | null> {
  return (await db.query<{ facility_id: string }>('select facility_id from shifts where id = $1', [shiftId])).rows[0]?.facility_id ?? null;
}

/** Adds `distanceKm` (null when unknown) to each candidate: display only, never a block and not part of the order. */
export async function withDistance<C extends { workerId: string }>(db: PoolClient, shiftId: string, list: C[]): Promise<(C & { distanceKm: number | null })[]> {
  const facilityId = await shiftSite(db, shiftId);
  const d = facilityId ? await homeDistances(db, facilityId, list.map(c => c.workerId)) : new Map<string, number | null>();
  return list.map(c => ({ ...c, distanceKm: d.get(c.workerId) ?? null }));
}
