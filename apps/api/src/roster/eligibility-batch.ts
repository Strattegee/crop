import { acrossSites } from '@crop/db';
import type { PoolClient } from 'pg';
import { fillReasons, wordsFor } from '../terms/words.js';
import { complianceContext, credentialFactsByWorker, rightToWorkByWorker } from '../workforce/compliance-data.js';
import { addDays, type RequirementRule } from '../workforce/compliance.js';
import { healthTypes, supervisorEligibility } from '../workforce/supervisor-view.js';
import { PERIODS, type AvailabilityFacts, type LeaveFacts, type Period } from './availability.js';
import type { DayRequestFacts } from './day-requests.js';
import { termsByWorker } from './eligibility-data.js';
import { fortnightsContaining, shiftEligibility, type Eligibility, type OperatorNeed, type OtherShift, type ShiftFacts } from './eligibility.js';

/** A person to check on a shift. */
export interface ShiftPerson { shiftId: string; workerId: string }

/** Key for the result map of `eligibilityForPairs`. */
export const pairKey = (shiftId: string, workerId: string) => `${shiftId}:${workerId}`;

const asPeriods = (v: string[]): Period[] => PERIODS.filter(p => v.includes(p));

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v); else m.set(k, [v]);
}

/**
 * Eligibility for many (shift, person) pairs at once (within withTenant): the same answer as calling
 * `eligibilityForShift(db, tenantId, shiftId, [workerId])` for each pair, but with a fixed number of queries
 * however many shifts there are. Needs attention checks everyone already on the shifts of the next 7–14 days,
 * which was one round of ~20 queries per shift (most of the roster's load on a busy week).
 * Pairs whose shift or person isn't found (or isn't visible) are left out of the result.
 */
export async function eligibilityForPairs(db: PoolClient, tenantId: string, pairs: ShiftPerson[]): Promise<Map<string, Eligibility>> {
  const out = new Map<string, Eligibility>();
  if (!pairs.length) return out;
  const shiftIds = [...new Set(pairs.map(p => p.shiftId))];
  const workerIds = [...new Set(pairs.map(p => p.workerId))];

  const shifts = new Map((await db.query<{ id: string; role: string; starts_at: Date; ends_at: Date; local_date: string; local_start: string; local_end: string; hours: number; gender_requested: 'F' | 'M' | null }>(
    `select s.id, s.role, s.gender_requested, s.starts_at, s.ends_at, to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date,
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as local_start, to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as local_end,
            (extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::float8 as hours
       from shifts s join facilities f on f.id = s.facility_id where s.id = any($1)`, [shiftIds])).rows
    .map(s => [s.id, { id: s.id, role: s.role, startsAt: s.starts_at, endsAt: s.ends_at, localDate: s.local_date, localStart: s.local_start, localEnd: s.local_end, hours: s.hours, genderRequested: s.gender_requested } satisfies ShiftFacts & { id: string }]));
  if (!shifts.size) return out;
  const dates = [...new Set([...shifts.values()].map(s => s.localDate))].sort();

  const operatorNeeds = new Map<string, OperatorNeed[]>();
  for (const r of (await db.query<OperatorNeed & { shift_id: string }>(
    `select sa.shift_id, e.name as "equipmentName", ct.id as "credentialTypeId", ct.name as "typeName"
       from shift_assignments sa join equipment e on e.id = sa.equipment_id
       join equipment_types et on et.id = e.equipment_type_id join credential_types ct on ct.id = et.operator_credential_type_id
      where sa.shift_id = any($1) and sa.resource_kind = 'equipment' and sa.status in ('assigned', 'confirmed')
      order by e.name`, [[...shifts.keys()]])).rows) {
    push(operatorNeeds, r.shift_id, { equipmentName: r.equipmentName, credentialTypeId: r.credentialTypeId, typeName: r.typeName });
  }
  const dutyRules = new Map<string, RequirementRule[]>();
  for (const r of (await db.query<{ shift_id: string; credential_type_id: string; type_name: string; severity: 'hard' | 'warning' | 'optional'; duty: string }>(
    `select l.shift_id, r.credential_type_id, ct.name as type_name, r.severity, d.name as duty
       from shift_duty_links l join shift_duties d on d.id = l.duty_id
       join shift_duty_requirements r on r.duty_id = d.id join credential_types ct on ct.id = r.credential_type_id
      where l.shift_id = any($1) and d.active and ct.active
      order by d.name, ct.name`, [[...shifts.keys()]])).rows) {
    push(dutyRules, r.shift_id, { credentialTypeId: r.credential_type_id, typeName: r.type_name, scope: 'all_workers', role: null, severity: r.severity, forDuty: r.duty });
  }
  const adultDuties = new Map<string, string[]>();
  for (const r of (await db.query<{ shift_id: string; name: string }>(
    `select l.shift_id, d.name from shift_duty_links l join shift_duties d on d.id = l.duty_id
      where l.shift_id = any($1) and d.active and d.adults_only order by d.name`, [[...shifts.keys()]])).rows) push(adultDuties, r.shift_id, r.name);
  const adultRoles = new Set((await db.query<{ name: string }>(
    'select lower(name) as name from business_roles where adults_only and active')).rows.map(r => r.name));

  const workers = new Map((await db.query<{ id: string; name: string; roles: string[]; gender: 'F' | 'M' | null; dob: string | null }>(
    `select w.id, w.gender, to_char(w.date_of_birth, 'YYYY-MM-DD') as dob, coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name, w.roles
       from workers w where w.id = any($1)`, [workerIds])).rows.map(w => [w.id, w]));
  if (!workers.size) return out;
  const ids = [...workers.keys()];

  const ctx = await complianceContext(db, tenantId);
  const creds = await credentialFactsByWorker(db, ids);
  const rtw = await rightToWorkByWorker(db, ids);
  const limits = new Map((await db.query<{ worker_id: string; hours: number }>(
    `select worker_id, work_hours_per_fortnight as hours from right_to_work_records
      where superseded_at is null and work_limit = 'limited' and worker_id = any($1)`, [ids])).rows.map(r => [r.worker_id, r.hours]));

  // Other shifts over every shift's window (each pair then keeps only its own, as eligibilityForFacts does).
  const from = fortnightsContaining(dates[0])[0].from;
  const to = fortnightsContaining(dates[dates.length - 1])[1].to;
  const others = new Map<string, OtherShift[]>();
  for (const o of (await acrossSites(db, () => db.query<{ worker_id: string; id: string; role: string; starts_at: Date; ends_at: Date; local_date: string; hours: number; facility: string; label: string }>(
    `select sa.worker_id, s.id, s.role, s.starts_at, s.ends_at, f.name as facility,
            to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date,
            (extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::float8 as hours,
            to_char(s.starts_at at time zone f.timezone, 'Dy DD Mon HH24:MI') || '–' || to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as label
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.worker_id = any($1) and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2::date - 1 and $3::date + 1
     union all
     select i.placed_worker_id, i.id, i.role, i.starts_at, i.ends_at, i.employer_name || ', ' || i.site_name,
            to_char(i.starts_at at time zone i.site_timezone, 'YYYY-MM-DD'),
            (extract(epoch from (i.ends_at - i.starts_at)) / 3600 - i.break_minutes / 60.0)::float8,
            to_char(i.starts_at at time zone i.site_timezone, 'Dy DD Mon HH24:MI') || '–' || to_char(i.ends_at at time zone i.site_timezone, 'HH24:MI')
       from agency_inbox i
      where i.placed_worker_id = any($1) and i.placement in ('waiting', 'booked')
        and (i.starts_at at time zone i.site_timezone)::date between $2::date - 1 and $3::date + 1`,
    [ids, from, to]))).rows) {
    push(others, o.worker_id, { id: o.id, role: o.role, startsAt: o.starts_at, endsAt: o.ends_at, localDate: o.local_date, hours: o.hours, facilityName: o.facility, label: o.label });
  }

  // Availability: the usual week, plus date entries on any of the shifts' dates (each check looks up its own date).
  const availability = new Map<string, AvailabilityFacts>();
  const avail = (id: string) => {
    let a = availability.get(id);
    if (!a) availability.set(id, (a = { pattern: new Map(), dates: new Map() }));
    return a;
  };
  for (const r of (await db.query<{ worker_id: string; weekday: number; periods: string[] }>(
    'select worker_id, weekday, periods from availability_patterns where worker_id = any($1)', [ids])).rows) {
    avail(r.worker_id).pattern.set(r.weekday, asPeriods(r.periods));
  }
  for (const r of (await db.query<{ worker_id: string; on_date: string; periods: string[] }>(
    `select worker_id, to_char(on_date, 'YYYY-MM-DD') as on_date, periods from availability_dates where worker_id = any($1) and on_date = any($2::date[])`,
    [ids, dates])).rows) {
    avail(r.worker_id).dates.set(r.on_date, asPeriods(r.periods));
  }
  // Leave over the dates' range (leaveReason keeps what covers each shift's date).
  const leave = new Map<string, LeaveFacts[]>();
  for (const r of (await db.query<{ worker_id: string; starts_on: string; ends_on: string; status: LeaveFacts['status'] }>(
    `select worker_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, status
       from leave_records where worker_id = any($1) and status in ('requested', 'approved') and starts_on <= $3 and ends_on >= $2`,
    [ids, dates[0], dates[dates.length - 1]])).rows) {
    push(leave, r.worker_id, { startsOn: r.starts_on, endsOn: r.ends_on, status: r.status });
  }
  // Requests for a day carry no date of their own, so they're kept per person and date.
  const dayRequests = new Map<string, DayRequestFacts[]>();
  for (const r of (await db.query<DayRequestFacts & { worker_id: string; on_date: string }>(
    `select worker_id, to_char(on_date, 'YYYY-MM-DD') as on_date, kind, to_char(at_time, 'HH24:MI') as "atTime", note, status from day_requests
      where worker_id = any($1) and on_date = any($2::date[]) and status in ('open', 'done')`, [ids, dates])).rows) {
    push(dayRequests, `${r.worker_id}|${r.on_date}`, { kind: r.kind, atTime: r.atTime, note: r.note, status: r.status });
  }
  const employment = await termsByWorker(db, ids);

  const words = await wordsFor(db);
  const supervisor = (await db.query<{ s: boolean }>('select app_is_supervisor() as s')).rows[0]?.s ?? false;
  const health = supervisor ? await healthTypes(db) : undefined;

  for (const { shiftId, workerId } of pairs) {
    const shift = shifts.get(shiftId);
    const w = workers.get(workerId);
    if (!shift || !w) continue;
    const [f0, f1] = fortnightsContaining(shift.localDate);
    const lo = addDays(f0.from, -1);
    const hi = addDays(f1.to, 1);
    const mine = (others.get(w.id) ?? []).filter(o => o.localDate >= lo && o.localDate <= hi);
    const { issues } = ctx.evaluate(w.roles, creds.get(w.id) ?? [], rtw.get(w.id) ?? null, shift.localDate, dutyRules.get(shiftId) ?? []);
    const e = shiftEligibility(shift, {
      name: w.name, roles: w.roles, issues, others: mine, hoursPerFortnight: limits.get(w.id) ?? null, minRestHours: ctx.settings.minRestHours,
      operatorNeeds: operatorNeeds.get(shiftId) ?? [], credentials: creds.get(w.id) ?? [], windowDays: ctx.settings.expiringWindowDays,
      availability: availability.get(w.id), leave: leave.get(w.id) ?? [], employment: employment.get(w.id) ?? [],
      gender: w.gender, dayRequests: dayRequests.get(`${w.id}|${shift.localDate}`) ?? [],
      age: { adultRole: adultRoles.has(shift.role.toLowerCase()), adultDuties: adultDuties.get(shiftId) ?? [], dateOfBirth: w.dob },
    });
    if (supervisor) Object.assign(e, supervisorEligibility(e, w.name, health));
    fillReasons(e, words);
    out.set(pairKey(shiftId, workerId), e);
  }
  return out;
}
