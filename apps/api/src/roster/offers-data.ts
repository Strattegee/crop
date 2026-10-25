import type { PoolClient } from 'pg';

/** Closes a shift's pending offers (filled some other way, or cancelled). Returns who they were for. */
export async function closePendingOffers(db: PoolClient, shiftId: string, status: 'filled' | 'withdrawn', by: string | null): Promise<string[]> {
  return (await db.query<{ worker_id: string }>(
    `update shift_offers set status = $2, responded_at = now(), responded_by = $3 where shift_id = $1 and status = 'pending' returning worker_id`,
    [shiftId, status, by])).rows.map(r => r.worker_id);
}
