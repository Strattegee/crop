import type { PoolClient } from 'pg';

/** Closes a shift's pending offers (filled some other way, or cancelled). Returns who they were for. */
export async function closePendingOffers(db: PoolClient, shiftId: string, status: 'filled' | 'withdrawn', by: string | null): Promise<string[]> {
  return (await db.query<{ worker_id: string }>(
    `update shift_offers set status = $2, responded_at = now(), responded_by = $3 where shift_id = $1 and status = 'pending' returning worker_id`,
    [shiftId, status, by])).rows.map(r => r.worker_id);
}

/**
 * Why the business's after-publishing rule would refuse a change to this shift's week for the person in
 * this transaction (migration 0024), or null when it is allowed.
 */
export async function rosterChangeRefusal(db: PoolClient, shiftId: string): Promise<string | null> {
  const r = await db.query<{ refusal: string | null }>(
    `select app_roster_change_refusal(s.facility_id, date_trunc('week', s.starts_at at time zone f.timezone)::date) as refusal
       from shifts s join facilities f on f.id = s.facility_id where s.id = $1`, [shiftId]);
  return r.rows[0]?.refusal ?? null;
}
