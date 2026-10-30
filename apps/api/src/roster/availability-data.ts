/**
 * Availability and leave: database steps shared by the office (availability.controller.ts) and the worker app
 * (worker-app/my-availability.controller.ts). Rules are in availability.ts.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { date } from '../common/validate.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import type { Period } from './availability.js';

export const MAX_RANGE_DAYS = 366;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** From and to dates for a list, defaulting to today (business time) and the next 90 days. */
export async function listRange(db: PoolClient, tenantId: string, q: { from?: string; to?: string }) {
  const from = date({ startDate: q.from }, 'startDate') ?? todayIn((await loadSettings(db, tenantId)).timezone);
  const to = date({ endDate: q.to }, 'endDate') ?? addDays(from, 90);
  if (to < from) throw new BadRequestException('The end date is before the start date');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException(`Choose ${MAX_RANGE_DAYS} days or fewer`);
  return { from, to };
}

export const LEAVE_COLS = `l.id, l.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName",
  l.kind, to_char(l.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(l.ends_on, 'YYYY-MM-DD') as "endsOn",
  (l.ends_on - l.starts_on + 1) as days, l.status, l.note, l.created_at as "createdAt", l.decided_at as "decidedAt"`;
export const LEAVE_FROM = 'leave_records l join workers w on w.id = l.worker_id';

export async function leaveById(db: PoolClient, id: string) {
  const r = (await db.query(`select ${LEAVE_COLS} from ${LEAVE_FROM} where l.id = $1`, [id])).rows[0];
  if (!r) throw new NotFoundException('Leave not found');
  return r;
}

/** Shifts the person is on (not cancelled) during the leave, so the office can find cover. */
export async function rosteredDuring(db: PoolClient, workerId: string, startsOn: string, endsOn: string) {
  return (await db.query(
    `select s.id, s.role, f.name as "facilityName", to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
            s.status
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.worker_id = $1 and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2 and $3
      order by s.starts_at`, [workerId, startsOn, endsOn])).rows;
}

/** The weekly pattern, date entries from `from` to `to`, and leave overlapping them. */
export async function availabilityOf(db: PoolClient, workerId: string, from: string, to: string) {
  const pattern = (await db.query(
    'select weekday, periods from availability_patterns where worker_id = $1 order by weekday', [workerId])).rows;
  const dates = (await db.query(
    `select to_char(on_date, 'YYYY-MM-DD') as date, periods, note from availability_dates
      where worker_id = $1 and on_date between $2 and $3 order by on_date`, [workerId, from, to])).rows;
  const leave = (await db.query(
    `select ${LEAVE_COLS} from ${LEAVE_FROM} where l.worker_id = $1 and l.ends_on >= $2 and l.starts_on <= $3
      order by l.starts_on`, [workerId, from, to])).rows;
  return { from, to, pattern, dates, leave };
}

/** Replaces the weekly pattern (the worker row must already be locked by the caller). */
export async function savePattern(db: PoolClient, tenantId: string, workerId: string, days: { weekday: number; periods: Period[] }[], userId: string) {
  await db.query('delete from availability_patterns where worker_id = $1', [workerId]);
  for (const d of days) {
    await db.query(
      `insert into availability_patterns(tenant_id, worker_id, weekday, periods, updated_by) values ($1,$2,$3,$4,$5)`,
      [tenantId, workerId, d.weekday, d.periods, userId]);
  }
  return (await db.query('select weekday, periods from availability_patterns where worker_id = $1 order by weekday', [workerId])).rows;
}

/** Availability for one date, replacing the weekly pattern that day. */
export async function saveDate(db: PoolClient, tenantId: string, workerId: string, onDate: string, periods: Period[], note: string | null, userId: string) {
  return (await db.query(
    `insert into availability_dates(tenant_id, worker_id, on_date, periods, note, updated_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (worker_id, on_date) do update set periods = excluded.periods, note = excluded.note,
                 updated_by = excluded.updated_by, updated_at = now()
     returning to_char(on_date, 'YYYY-MM-DD') as date, periods, note`,
    [tenantId, workerId, onDate, periods, note, userId])).rows[0];
}

export async function clearDate(db: PoolClient, workerId: string, onDate: string) {
  await db.query('delete from availability_dates where worker_id = $1 and on_date = $2', [workerId, onDate]);
}

/**
 * Records leave (the worker row must already be locked). Refused when it overlaps leave already requested or
 * approved. Returns the leave and the shifts the person is on in those days.
 */
export async function recordLeave(db: PoolClient, l: {
  tenantId: string; workerId: string; kind: string; startsOn: string; endsOn: string; approved: boolean; note: string | null; userId: string;
  overlapMessage: string;
}) {
  const overlap = (await db.query(
    `select 1 from leave_records where worker_id = $1 and status in ('requested', 'approved') and starts_on <= $3 and ends_on >= $2`,
    [l.workerId, l.startsOn, l.endsOn])).rowCount;
  if (overlap) throw new ConflictException(l.overlapMessage);
  const id = (await db.query<{ id: string }>(
    `insert into leave_records(tenant_id, worker_id, kind, starts_on, ends_on, status, note, created_by, decided_by, decided_at)
     values ($1,$2,$3,$4,$5,$6::leave_status,$7,$8, case when $6::leave_status = 'approved' then $8::uuid end,
             case when $6::leave_status = 'approved' then now() end)
     returning id`,
    [l.tenantId, l.workerId, l.kind, l.startsOn, l.endsOn, l.approved ? 'approved' : 'requested', l.note, l.userId])).rows[0].id;
  return { ...(await leaveById(db, id)), rostered: await rosteredDuring(db, l.workerId, l.startsOn, l.endsOn) };
}
