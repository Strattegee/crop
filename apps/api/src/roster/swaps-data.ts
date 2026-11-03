/**
 * Shift swaps (migration 0073): the database steps shared by the worker app and the office endpoints.
 * Call inside `withTenant(…, actor)` so the shift log and the after-publishing rule see who made the change.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { queueNotification } from '../notifications/notify.js';
import { DEFAULT_WORDS, type Words } from '../terms/words.js';
import { assignWorker, confirmWorker } from './shift-actions.js';
import { swapOutcomeEmail, type SwapMode, type SwapShift, type SwapStatus, type SwapView } from './swaps.js';

export async function swapMode(db: PoolClient, tenantId: string): Promise<SwapMode> {
  return (await db.query<{ m: SwapMode }>('select shift_swaps as m from tenant_settings where tenant_id = $1', [tenantId])).rows[0]?.m ?? 'off';
}

/** Facts about one shift for one person: on it, started, cancelled, in a published week. */
export async function shiftFacts(db: PoolClient, shiftId: string, workerId: string) {
  return (await db.query<{ onShift: boolean; started: boolean; cancelled: boolean; published: boolean; facilityId: string; needsPerson: boolean }>(
    `select exists (select 1 from shift_assignments sa where sa.shift_id = s.id and sa.worker_id = $2 and sa.resource_kind = 'worker'
                      and sa.status in ('assigned', 'confirmed')) as "onShift",
            s.starts_at <= now() as started, s.status = 'cancelled' as cancelled, s.facility_id as "facilityId",
            s.needs_person as "needsPerson",
            exists (select 1 from roster_publications p where p.facility_id = s.facility_id
                     and p.week_start = date_trunc('week', s.starts_at at time zone f.timezone)::date) as published
       from shifts s join facilities f on f.id = s.facility_id where s.id = $1`, [shiftId, workerId])).rows[0] ?? null;
}

const SHIFT_JSON = (alias: string) => `case when ${alias}.id is null then null else json_build_object(
  'id', ${alias}.id, 'role', ${alias}.role, 'site', ${alias}f.name, 'area', ${alias}a.name,
  'localDate', to_char(${alias}.starts_at at time zone ${alias}f.timezone, 'YYYY-MM-DD'),
  'localStart', to_char(${alias}.starts_at at time zone ${alias}f.timezone, 'HH24:MI'),
  'localEnd', to_char(${alias}.ends_at at time zone ${alias}f.timezone, 'HH24:MI'),
  'startsAt', ${alias}.starts_at) end`;

export const SWAP_SELECT = `select sw.id, sw.status, sw.shift_id as "shiftId", sw.other_shift_id as "otherShiftId",
    sw.from_worker_id as "fromWorkerId", sw.to_worker_id as "toWorkerId", sw.reason, sw.created_at as "createdAt",
    sw.answered_at as "answeredAt", sw.decided_at as "decidedAt", sw.decided_by_name as "decidedByName",
    coalesce(fw.preferred_name, fw.first_name) || ' ' || fw.last_name as "fromName", coalesce(fw.preferred_name, fw.first_name) as "fromFirstName",
    fw.email as "fromEmail",
    coalesce(tw.preferred_name, tw.first_name) || ' ' || tw.last_name as "toName", coalesce(tw.preferred_name, tw.first_name) as "toFirstName",
    tw.email as "toEmail",
    ${SHIFT_JSON('s')} as shift, ${SHIFT_JSON('x')} as other
  from shift_swaps sw
  join workers fw on fw.id = sw.from_worker_id join workers tw on tw.id = sw.to_worker_id
  join shifts s on s.id = sw.shift_id join facilities sf on sf.id = s.facility_id left join areas sa on sa.id = s.area_id
  left join shifts x on x.id = sw.other_shift_id left join facilities xf on xf.id = x.facility_id left join areas xa on xa.id = x.area_id`;

export interface SwapRow {
  id: string; status: SwapStatus; shiftId: string; otherShiftId: string | null; fromWorkerId: string; toWorkerId: string;
  reason: string | null; createdAt: Date; answeredAt: Date | null; decidedAt: Date | null; decidedByName: string | null;
  fromName: string; fromFirstName: string; fromEmail: string | null; toName: string; toFirstName: string; toEmail: string | null;
  shift: SwapShift & { id: string; startsAt: string }; other: (SwapShift & { id: string; startsAt: string }) | null;
}

export const viewOf = (r: SwapRow): SwapView => ({ fromName: r.fromName, toName: r.toName, shift: r.shift, other: r.other });

/** One swap, locked when `lock` (taken before answering or deciding, so two answers can't both act). */
export async function loadSwap(db: PoolClient, id: string, lock = false): Promise<SwapRow> {
  if (lock) {
    const locked = await db.query('select 1 from shift_swaps where id = $1 for update', [id]);
    if (!locked.rowCount) throw new NotFoundException('Swap not found');
  }
  const r = (await db.query<SwapRow>(`${SWAP_SELECT} where sw.id = $1`, [id])).rows[0];
  if (!r) throw new NotFoundException('Swap not found');
  return r;
}

/**
 * Makes the swap: both people come off (reason `swap`), then each goes on the other's shift through the ordinary
 * assign rules, and both are booked (they've both agreed). Throws a 409 with the reason when anything stops it;
 * the caller's transaction then rolls back, so nothing changes.
 */
export async function makeSwap(db: PoolClient, tenantId: string, by: string | null, sw: SwapRow): Promise<void> {
  const ids = [sw.shiftId, sw.otherShiftId].filter((x): x is string => !!x).sort();
  for (const id of ids) await db.query('select 1 from shifts where id = $1 for update', [id]);
  const a = await shiftFacts(db, sw.shiftId, sw.fromWorkerId);
  if (!a?.onShift || a.cancelled) throw new ConflictException(`${sw.fromName} is no longer on that {shift}`);
  if (a.started) throw new ConflictException('That {shift} has already started');
  if (sw.otherShiftId) {
    const b = await shiftFacts(db, sw.otherShiftId, sw.toWorkerId);
    if (!b?.onShift || b.cancelled) throw new ConflictException(`${sw.toName} is no longer on that {shift}`);
    if (b.started) throw new ConflictException('That {shift} has already started');
  }
  const off = async (shiftId: string, workerId: string) => {
    await db.query(
      `update shift_assignments set status = 'removed', ended_at = now(), removed_reason = 'swap'
        where shift_id = $1 and worker_id = $2 and resource_kind = 'worker' and status in ('assigned', 'confirmed')`, [shiftId, workerId]);
    await db.query(`update shifts set status = 'open', updated_at = now() where id = $1`, [shiftId]);
  };
  await off(sw.shiftId, sw.fromWorkerId);
  if (sw.otherShiftId) await off(sw.otherShiftId, sw.toWorkerId);
  const put = async (shiftId: string, workerId: string, name: string) => {
    try {
      await assignWorker(db, tenantId, by, shiftId, workerId);
    } catch (e) {
      if (e instanceof ConflictException) throw new ConflictException(`${name} can't work that {shift}: ${(e.getResponse() as { message?: string }).message ?? e.message}`);
      throw e;
    }
    await confirmWorker(db, shiftId);
  };
  await put(sw.shiftId, sw.toWorkerId, sw.toName);
  if (sw.otherShiftId) await put(sw.otherShiftId, sw.fromWorkerId, sw.fromName);
  // Other open asks about these shifts relied on who was on them, so they close.
  await db.query(
    `update shift_swaps set status = 'closed', reason = 'Someone came off one of the shifts', updated_at = now()
      where id <> $1 and status in ('asked', 'agreed') and (shift_id = any($2::uuid[]) or other_shift_id = any($2::uuid[]))`, [sw.id, ids]);
}

/**
 * Tries the swap and undoes it (a savepoint), so asking or agreeing can say at once when it couldn't be made.
 * Returns the reason, or null when it would go through now.
 */
export async function swapProblem(db: PoolClient, tenantId: string, sw: SwapRow): Promise<string | null> {
  await db.query('savepoint swap_try');
  try {
    await makeSwap(db, tenantId, null, sw);
    return null;
  } catch (e) {
    const err = e as { getResponse?: () => unknown; message?: string; code?: string };
    if (err.getResponse) {
      const body = err.getResponse() as { message?: string | string[] } | string;
      const m = typeof body === 'string' ? body : body.message;
      return Array.isArray(m) ? m.join('. ') : (m ?? err.message ?? 'This swap can\'t be made');
    }
    if (err.code === 'CRLK1') return err.message ?? 'The roster can\'t be changed now';
    throw e;
  } finally {
    await db.query('rollback to savepoint swap_try');
    await db.query('release savepoint swap_try');
  }
}

/** Emails each of the two people the outcome (swap made, or the office said no). */
export async function tellBoth(db: PoolClient, tenantId: string, sw: SwapRow, outcome: 'done' | 'refused', by: string | null, w: Words = DEFAULT_WORDS) {
  const people = [
    { email: sw.fromEmail, firstName: sw.fromFirstName, isAsker: true, workerId: sw.fromWorkerId },
    { email: sw.toEmail, firstName: sw.toFirstName, isAsker: false, workerId: sw.toWorkerId },
  ];
  for (const p of people) {
    if (!p.email) continue;
    const m = swapOutcomeEmail({ ...viewOf(sw), firstName: p.firstName, isAsker: p.isAsker }, outcome, w);
    await queueNotification(db, tenantId, {
      channel: 'email', to: p.email, template: outcome === 'done' ? 'shift_swap_done' : 'shift_swap_refused',
      subject: m.subject, body: m.body, workerId: p.workerId, createdBy: by, dedupeKey: `swap:${sw.id}:${outcome}:${p.workerId}`,
    });
  }
}
