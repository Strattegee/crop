import { NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from '../workforce/compliance-data.js';
import { addDays } from '../workforce/compliance.js';
import { PERIODS, type AvailabilityFacts, type LeaveFacts, type Period } from './availability.js';
import { fortnightsContaining, mondayOf, shiftEligibility, type Eligibility, type OperatorNeed, type OtherShift, type ShiftFacts } from './eligibility.js';

export interface Candidate {
  workerId: string;
  name: string;
  roles: string[];
  employmentType: string | null;
  /** Hours already rostered in the shift's week (Monday to Sunday), not counting this shift. */
  weekHours: number;
  /** False when they've said they can't work this part of this day (a warning, not a block). */
  available: boolean;
  eligible: boolean;
  blocks: Eligibility['blocks'];
  warnings: Eligibility['warnings'];
}

/** The facts about a shift that eligibility needs (within withTenant). */
export async function loadShiftFacts(db: PoolClient, shiftId: string): Promise<ShiftFacts & { id: string }> {
  const s = (await db.query<{ id: string; role: string; starts_at: Date; ends_at: Date; local_date: string; local_start: string; hours: number }>(
    `select s.id, s.role, s.starts_at, s.ends_at, to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date,
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as local_start,
            (extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::float8 as hours
       from shifts s join facilities f on f.id = s.facility_id where s.id = $1`, [shiftId])).rows[0];
  if (!s) throw new NotFoundException('Shift not found');
  return { id: s.id, role: s.role, startsAt: s.starts_at, endsAt: s.ends_at, localDate: s.local_date, localStart: s.local_start, hours: s.hours };
}

/** Operator credentials needed by the equipment booked on a shift. */
export async function operatorNeedsForShift(db: PoolClient, shiftId: string): Promise<OperatorNeed[]> {
  return (await db.query<OperatorNeed>(
    `select e.name as "equipmentName", ct.id as "credentialTypeId", ct.name as "typeName"
       from shift_assignments sa join equipment e on e.id = sa.equipment_id
       join equipment_types et on et.id = e.equipment_type_id join credential_types ct on ct.id = et.operator_credential_type_id
      where sa.shift_id = $1 and sa.resource_kind = 'equipment' and sa.status in ('assigned', 'confirmed')
      order by e.name`, [shiftId])).rows;
}

/**
 * Works out who may work a shift (within withTenant). Pass workerIds to check particular people
 * (any status), or leave it out for every active worker.
 */
export async function eligibilityForShift(db: PoolClient, tenantId: string, shiftId: string, workerIds?: string[]): Promise<Candidate[]> {
  const shift = await loadShiftFacts(db, shiftId);

  const workers = (await db.query<{ id: string; name: string; roles: string[]; employment_type: string | null }>(
    `select w.id, coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name, w.roles, et.employment_type
       from workers w
       left join lateral (select employment_type from employment_terms e
                           where e.worker_id = w.id and e.starts_on <= $2 and (e.ends_on is null or e.ends_on >= $2)
                           order by e.starts_on desc limit 1) et on true
      where ${workerIds ? 'w.id = any($1)' : "w.status = 'active' and $1::uuid[] is null"}
      order by w.last_name, w.first_name`, [workerIds ?? null, shift.localDate])).rows;
  if (!workers.length) return [];
  const ids = workers.map(w => w.id);

  const ctx = await complianceContext(db, tenantId);
  const creds = await credentialFactsByWorker(db, ids);
  const rtw = await rightToWorkByWorker(db, ids);
  const limits = new Map((await db.query<{ worker_id: string; hours: number }>(
    `select worker_id, work_hours_per_fortnight as hours from right_to_work_records
      where superseded_at is null and work_limit = 'limited' and worker_id = any($1)`, [ids])).rows.map(r => [r.worker_id, r.hours]));

  // Everything that could matter: overlaps, rest either side, and both fortnights containing the shift date.
  const windows = fortnightsContaining(shift.localDate);
  const others = new Map<string, OtherShift[]>();
  for (const o of (await db.query<{ worker_id: string; id: string; role: string; starts_at: Date; ends_at: Date; local_date: string; hours: number; facility: string; label: string }>(
    `select sa.worker_id, s.id, s.role, s.starts_at, s.ends_at, f.name as facility,
            to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date,
            (extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::float8 as hours,
            to_char(s.starts_at at time zone f.timezone, 'Dy DD Mon HH24:MI') || '–' || to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as label
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.worker_id = any($1) and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2::date - 1 and $3::date + 1`,
    [ids, windows[0].from, windows[1].to])).rows) {
    const list = others.get(o.worker_id) ?? [];
    list.push({ id: o.id, role: o.role, startsAt: o.starts_at, endsAt: o.ends_at, localDate: o.local_date, hours: o.hours, facilityName: o.facility, label: o.label });
    others.set(o.worker_id, list);
  }

  const operatorNeeds = await operatorNeedsForShift(db, shiftId);
  const availability = await availabilityByWorker(db, ids, shift.localDate);
  const leave = await leaveByWorker(db, ids, shift.localDate);

  const weekFrom = mondayOf(shift.localDate);
  const weekTo = addDays(weekFrom, 6);
  return workers.map(w => {
    const mine = others.get(w.id) ?? [];
    const { issues } = ctx.evaluate(w.roles, creds.get(w.id) ?? [], rtw.get(w.id) ?? null, shift.localDate);
    const e = shiftEligibility(shift, {
      name: w.name, roles: w.roles, issues, others: mine, hoursPerFortnight: limits.get(w.id) ?? null, minRestHours: ctx.settings.minRestHours,
      operatorNeeds, credentials: creds.get(w.id) ?? [], windowDays: ctx.settings.expiringWindowDays,
      availability: availability.get(w.id), leave: leave.get(w.id) ?? [],
    });
    const weekHours = mine.filter(o => o.id !== shift.id && o.localDate >= weekFrom && o.localDate <= weekTo).reduce((n, o) => n + o.hours, 0);
    return { workerId: w.id, name: w.name, roles: w.roles, employmentType: w.employment_type, weekHours: Math.round(weekHours * 100) / 100,
      available: !e.warnings.some(x => x.code === 'availability'), ...e };
  });
}

/**
 * Ready to go first, then those with warnings, then those who said they aren't available, then those who
 * can't be assigned; fewest hours this week first.
 */
export function rankCandidates(list: Candidate[]): Candidate[] {
  const group = (c: Candidate) => (!c.eligible ? 3 : !c.available ? 2 : c.warnings.length ? 1 : 0);
  return [...list].sort((a, b) => group(a) - group(b) || a.weekHours - b.weekHours || a.name.localeCompare(b.name));
}

const asPeriods = (v: string[]): Period[] => PERIODS.filter(p => v.includes(p));

/** Each person's weekly pattern and their date entry for one date (within withTenant). */
export async function availabilityByWorker(db: PoolClient, workerIds: string[], onDate: string): Promise<Map<string, AvailabilityFacts>> {
  const out = new Map<string, AvailabilityFacts>();
  const get = (id: string) => {
    let a = out.get(id);
    if (!a) out.set(id, (a = { pattern: new Map(), dates: new Map() }));
    return a;
  };
  for (const r of (await db.query<{ worker_id: string; weekday: number; periods: string[] }>(
    'select worker_id, weekday, periods from availability_patterns where worker_id = any($1)', [workerIds])).rows) {
    get(r.worker_id).pattern.set(r.weekday, asPeriods(r.periods));
  }
  for (const r of (await db.query<{ worker_id: string; on_date: string; periods: string[] }>(
    `select worker_id, to_char(on_date, 'YYYY-MM-DD') as on_date, periods from availability_dates where worker_id = any($1) and on_date = $2`,
    [workerIds, onDate])).rows) {
    get(r.worker_id).dates.set(r.on_date, asPeriods(r.periods));
  }
  return out;
}

/** Requested and approved leave covering a date, per person (within withTenant). */
export async function leaveByWorker(db: PoolClient, workerIds: string[], onDate: string): Promise<Map<string, LeaveFacts[]>> {
  const out = new Map<string, LeaveFacts[]>();
  for (const r of (await db.query<{ worker_id: string; starts_on: string; ends_on: string; status: LeaveFacts['status'] }>(
    `select worker_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, status
       from leave_records where worker_id = any($1) and status in ('requested', 'approved') and starts_on <= $2 and ends_on >= $2`,
    [workerIds, onDate])).rows) {
    const list = out.get(r.worker_id) ?? [];
    list.push({ startsOn: r.starts_on, endsOn: r.ends_on, status: r.status });
    out.set(r.worker_id, list);
  }
  return out;
}
