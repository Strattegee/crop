import type { PoolClient } from 'pg';

/** How far back "worked here before" looks. */
export const SITE_HISTORY_DAYS = 365;

/** A person's past work at a shift's site: shifts they were booked on there that have finished, and the latest one's local date. */
export interface SiteHistory { shiftsHere: number; lastHere: string | null }

export const NO_HISTORY: SiteHistory = { shiftsHere: 0, lastHere: null };

/**
 * Past work at the shift's site, per person (within withTenant): shifts at the same site that ended before this one
 * starts (and before now), in the last `SITE_HISTORY_DAYS`, where the person was booked (confirmed) and the shift
 * wasn't cancelled. People who never worked there are left out of the map.
 */
export async function siteHistoryFor(db: PoolClient, shiftId: string, workerIds: string[]): Promise<Map<string, SiteHistory>> {
  const out = new Map<string, SiteHistory>();
  if (!workerIds.length) return out;
  const rows = (await db.query<{ worker_id: string; n: number; last: string }>(
    `select a.worker_id, count(*)::int as n,
            to_char(max(s.starts_at at time zone f.timezone), 'YYYY-MM-DD') as last
       from shifts t
       join shifts s on s.facility_id = t.facility_id and s.id <> t.id
       join facilities f on f.id = s.facility_id
       join shift_assignments a on a.shift_id = s.id
      where t.id = $1
        and a.resource_kind = 'worker' and a.status = 'confirmed' and a.worker_id = any($2)
        and s.status <> 'cancelled'
        and s.ends_at <= least(now(), t.starts_at)
        and s.starts_at > t.starts_at - make_interval(days => $3)
      group by a.worker_id`, [shiftId, workerIds, SITE_HISTORY_DAYS])).rows;
  for (const r of rows) out.set(r.worker_id, { shiftsHere: r.n, lastHere: r.last });
  return out;
}

/** Adds `siteHistory` to each candidate. */
export async function withSiteHistory<C extends { workerId: string }>(db: PoolClient, shiftId: string, list: C[]): Promise<(C & { siteHistory: SiteHistory })[]> {
  const h = await siteHistoryFor(db, shiftId, list.map(c => c.workerId));
  return list.map(c => ({ ...c, siteHistory: h.get(c.workerId) ?? NO_HISTORY }));
}
