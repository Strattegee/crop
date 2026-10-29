import type { PoolClient } from 'pg';
import type { CredentialFacts } from '../workforce/compliance.js';

/**
 * What an agency confirmed its person holds for a shift (within withTenant, employer side), keyed by
 * `${shiftId}:${workerId}`. The employer keeps no records for agency people, so each live placement (waiting or
 * booked) carries the employer's credential types the agency confirmed for that shift's date (migration 0046).
 * They read as verified and current for that shift only, so cover rules and equipment operator checks count them.
 */
export async function agencyCredentialsForShifts(db: PoolClient, shiftIds: string[]): Promise<Map<string, CredentialFacts[]>> {
  const out = new Map<string, CredentialFacts[]>();
  if (!shiftIds.length) return out;
  const rows = (await db.query<{ id: string; shift_id: string; worker_id: string; credential_type_ids: string[] }>(
    `select p.id, p.shift_id, p.worker_id, p.credential_type_ids
       from agency_placements p join shift_assignments sa on sa.id = p.assignment_id and sa.status in ('assigned', 'confirmed')
      where p.shift_id = any($1) and p.status in ('waiting', 'booked')`, [shiftIds])).rows;
  for (const r of rows) {
    out.set(`${r.shift_id}:${r.worker_id}`, r.credential_type_ids.map(t => ({
      id: `agency:${r.id}:${t}`, credentialTypeId: t, expiryDate: null, verification: 'verified' as const,
    })));
  }
  return out;
}
