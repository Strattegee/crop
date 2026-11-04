import type { PoolClient } from 'pg';
import { teamFirst, type TeamRole } from './projects.js';

/** Someone's place on the team of a shift's site on the shift's local date. */
export interface TeamPlace { teamRole: TeamRole; areaName: string | null }

/**
 * Who of these people is on the team of the shift's site on the shift's local date (within withTenant): live
 * memberships (`site_members`, not removed) covering that date.
 */
export async function teamForShift(db: PoolClient, shiftId: string, workerIds: string[]): Promise<Map<string, TeamPlace>> {
  const out = new Map<string, TeamPlace>();
  if (!workerIds.length) return out;
  for (const r of (await db.query<{ worker_id: string; team_role: TeamRole; area_name: string | null }>(
    `select m.worker_id, m.team_role, a.name as area_name
       from shifts s join facilities f on f.id = s.facility_id
       join site_members m on m.facility_id = s.facility_id and m.removed_at is null
        and m.starts_on <= (s.starts_at at time zone f.timezone)::date
        and (m.ends_on is null or m.ends_on >= (s.starts_at at time zone f.timezone)::date)
       left join areas a on a.id = m.area_id
      where s.id = $1 and m.worker_id = any($2)`, [shiftId, workerIds])).rows) {
    out.set(r.worker_id, { teamRole: r.team_role, areaName: r.area_name });
  }
  return out;
}

/**
 * Adds `team` (null when not on the site's team) to each candidate and puts the team first within each eligibility
 * group. Never a block: eligibility is unchanged. Sites without a team keep their order.
 */
export async function withTeam<C extends { workerId: string; eligible: boolean; available?: boolean; warnings: unknown[] }>(
  db: PoolClient, shiftId: string, list: C[],
): Promise<(C & { team: TeamPlace | null })[]> {
  const team = await teamForShift(db, shiftId, list.map(c => c.workerId));
  if (!team.size) return list.map(c => ({ ...c, team: null }));
  return teamFirst(list.map(c => ({ ...c, team: team.get(c.workerId) ?? null, onTeam: team.has(c.workerId) })))
    .map(({ onTeam: _, ...c }) => c as unknown as C & { team: TeamPlace | null });
}
