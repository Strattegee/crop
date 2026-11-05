import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { isLimited, OFFICE_ROLES, SITE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, int, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { eligibilityForShift } from '../roster/eligibility-data.js';
import { actorOf } from '../roster/publishing.js';
import { equipmentForShift } from '../roster/equipment-data.js';
import { cancelShift, removeWorker } from '../roster/shift-actions.js';
import { time } from '../roster/shift-create.js';
import { firstReason } from '../roster/templates.js';
import { T, wordsFor } from '../terms/words.js';
import { joinRefusal, makeUpLine, parseMakeUp } from '../teams/teams.js';
import { knownRoles } from '../teams/teams.controller.js';
import { todayIn } from '../workforce/compliance.js';
import { checkAllocation } from './projects.controller.js';
import { rangeLine } from './projects.js';
import { plannedQuantity, stageItemLines, type PlannedItem, type UsedItem } from './stage-items.js';
import {
  copyOffset, copyStageDates, copySummary, DEFAULT_WEEKDAYS, emptyResult, type CopyResult, GAP_REASON, MAX_ROSTER_SHIFTS, moveLaterStages, moveSummary, parseWeekdays, planSlots, rosterSummary,
  noRetime, shiftsOutside, shiftsToRetime, STAGE_MOVED_REASON, STAGE_REMOVED_REASON, stageLine, stageOverlaps, stageProblem, stageShortLine, supervisorDays, supervisorRole,
  toCreate, weekdaysLine, workingDays,
  type Existing, type HoursProblem, type MakeUp, type MoveResult, type RetimeSort, type RosterResult, type StagePerson, type TimedShift, type WantedHours,
} from './stages.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The site's local date and time now, "YYYY-MM-DD" and "HH:MM". */
function localNow(zone: string, now = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return { date: todayIn(zone, now), time: `${p.hour}:${p.minute}` };
}

interface ProjectRow { id: string; name: string; timezone: string; kind: string; supervisorWorkerId: string | null; startsOn: string | null; endsOn: string | null }

async function projectOf(db: PoolClient, id: string, lock = false): Promise<ProjectRow> {
  const p = (await db.query<ProjectRow>(
    `select id, name, timezone, kind, supervisor_worker_id as "supervisorWorkerId", to_char(starts_on, 'YYYY-MM-DD') as "startsOn", to_char(ends_on, 'YYYY-MM-DD') as "endsOn"
       from facilities where id = $1 ${lock ? 'for update' : ''}`, [id])).rows[0];
  if (!p) throw new NotFoundException('{Project} not found');
  if (p.kind !== 'project') throw new BadRequestException('Stages belong to {a project}; this is {a site}');
  return p;
}

interface StageRow {
  id: string; facilityId: string; name: string; areaId: string | null; areaName: string | null; startsOn: string; endsOn: string; weekdays: number[];
  ownStart: string | null; ownEnd: string | null; startTime: string; endTime: string; breakMinutes: number; shiftCodeId: string | null; shiftCode: string | null;
  teamId: string | null; teamName: string | null; notes: string | null; position: number;
}

const STAGE_COLS = `st.id, st.facility_id as "facilityId", st.name, st.area_id as "areaId", a.name as "areaName",
  to_char(st.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(st.ends_on, 'YYYY-MM-DD') as "endsOn", st.weekdays::int[] as weekdays,
  to_char(st.start_time, 'HH24:MI') as "ownStart", to_char(st.end_time, 'HH24:MI') as "ownEnd",
  to_char(coalesce(st.start_time, sc.start_time), 'HH24:MI') as "startTime", to_char(coalesce(st.end_time, sc.end_time), 'HH24:MI') as "endTime",
  case when st.start_time is null then coalesce(sc.break_minutes, 0) else st.break_minutes end::int as "breakMinutes",
  st.shift_code_id as "shiftCodeId", sc.code as "shiftCode", st.team_id as "teamId", t.name as "teamName", st.notes`;
const STAGE_FROM = `project_stages st left join areas a on a.id = st.area_id left join shift_codes sc on sc.id = st.shift_code_id left join teams t on t.id = st.team_id`;

async function liveStages(db: PoolClient, facilityId: string): Promise<StageRow[]> {
  return (await db.query<StageRow>(
    `select ${STAGE_COLS} from ${STAGE_FROM} where st.facility_id = $1 and st.removed_at is null order by st.starts_on, st.created_at`, [facilityId])).rows;
}

/** A live stage (locks it, so two changes can't cross). */
async function liveStage(db: PoolClient, id: string): Promise<StageRow> {
  const r = (await db.query<{ id: string }>('select id from project_stages where id = $1 and removed_at is null for update', [id])).rows[0];
  if (!r) throw new NotFoundException('Stage not found');
  return (await db.query<StageRow>(`select ${STAGE_COLS} from ${STAGE_FROM} where st.id = $1`, [id])).rows[0];
}

async function makeUpOf(db: PoolClient, stageIds: string[]): Promise<Map<string, MakeUp[]>> {
  const out = new Map<string, MakeUp[]>();
  if (!stageIds.length) return out;
  for (const r of (await db.query<{ stage_id: string; role: string; count: number }>(
    'select stage_id, role, count from project_stage_roles where stage_id = any($1) and removed_at is null order by stage_id, position, role', [stageIds])).rows) {
    out.set(r.stage_id, [...(out.get(r.stage_id) ?? []), { role: r.role, count: r.count }]);
  }
  return out;
}

type PersonRow = StagePerson & { id: string; stageId: string; status: string; roleMissing: boolean };
async function peopleOf(db: PoolClient, stageIds: string[]): Promise<Map<string, PersonRow[]>> {
  const out = new Map<string, PersonRow[]>();
  if (!stageIds.length) return out;
  for (const r of (await db.query<PersonRow>(
    `select p.id, p.stage_id as "stageId", p.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name, p.role,
            w.status, w.status = 'active' as active, not (p.role = any(w.roles)) as "roleMissing"
       from project_stage_people p join workers w on w.id = p.worker_id
      where p.stage_id = any($1) and p.removed_at is null order by lower(w.last_name), lower(w.first_name)`, [stageIds])).rows) {
    out.set(r.stageId, [...(out.get(r.stageId) ?? []), r]);
  }
  return out;
}

/** Each stage's shifts so far (not cancelled): local date, role, usual person, status. */
async function stageShifts(db: PoolClient, stageIds: string[]) {
  if (!stageIds.length) return [];
  return (await db.query<{ stageId: string; date: string; role: string; usualWorkerId: string | null; status: string }>(
    `select s.project_stage_id as "stageId", to_char((s.starts_at at time zone f.timezone)::date, 'YYYY-MM-DD') as date, s.role,
            s.usual_worker_id as "usualWorkerId", s.status
       from shifts s join facilities f on f.id = s.facility_id
      where s.project_stage_id = any($1) and s.status <> 'cancelled'`, [stageIds])).rows;
}

/**
 * The project's {shifts} made by its stages and its supervisor's (not cancelled), with whether each has started, has
 * an agency's person on it, or is in a published week.
 */
async function placedShifts(db: PoolClient, facilityId: string): Promise<TimedShift[]> {
  return (await db.query<TimedShift>(
    `select s.id, s.project_stage_id as "stageId", s.project_supervisor as supervisor, s.role,
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "startTime", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "endTime",
            s.break_minutes as "breakMinutes", s.shift_code_id as "shiftCodeId",
            to_char((s.starts_at at time zone f.timezone)::date, 'YYYY-MM-DD') as date, s.starts_at <= now() as started,
            exists (select 1 from roster_publications rp where rp.facility_id = s.facility_id
                     and rp.week_start = date_trunc('week', s.starts_at at time zone f.timezone)::date) as published,
            exists (select 1 from shift_assignments sa join workers w on w.id = sa.worker_id
                     where sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and w.status = 'agency') as agency
       from shifts s join facilities f on f.id = s.facility_id
      where s.facility_id = $1 and s.status <> 'cancelled' and (s.project_stage_id is not null or s.project_supervisor)`, [facilityId])).rows;
}

/**
 * Brings the {shifts} of some stages (`stageIds`) in line with their dates: {shifts} off their working days come off
 * the Draft roster (cancelled with a reason; started ones, an agency's and published weeks' stay and are counted),
 * as do supervisor {shifts} on no live stage's working day; then stages that had {shifts} are rostered again, which
 * adds only what is missing on the new days. `removed`: the stages are being taken off, so all their {shifts} go and
 * nothing is rostered.
 */
async function matchShifts(db: PoolClient, tenantId: string, userId: string, p: ProjectRow, stageIds: string[], removed = false): Promise<MoveResult> {
  const all = await liveStages(db, p.id);
  const days = new Map<string, Set<string>>(stageIds.map(id => {
    const s = removed ? undefined : all.find(x => x.id === id);
    return [id, new Set(s ? workingDays(s.startsOn, s.endsOn, s.weekdays) : [])];
  }));
  const placed = await placedShifts(db, p.id);
  const sort = shiftsOutside(placed, days, new Set(supervisorDays(all).keys()));
  for (const id of sort.cancel) await cancelShift(db, userId, id, removed ? STAGE_REMOVED_REASON : STAGE_MOVED_REASON, 'other');
  const had = removed ? [] : stageIds.filter(id => all.some(s => s.id === id) && placed.some(x => x.stageId === id));
  const times = removed ? noRetime() : await retimeShifts(db, tenantId,
    retimeSort(await placedShifts(db, p.id), all.filter(s => stageIds.includes(s.id)), all), p.timezone);
  const roster = had.length ? await rosterStages(db, tenantId, userId, p, had) : null;
  return { cancelled: sort.cancel.length, kept: sort.kept, roster, ...times };
}

/** Which of the {shifts} of `stages` (and the supervisor's, from every live stage `all`) need the stage's hours now. */
function retimeSort(placed: TimedShift[], stages: StageRow[], all: StageRow[]): RetimeSort {
  const hours = new Map<string, WantedHours>(stages.map(s => [s.id, { startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, shiftCodeId: s.shiftCodeId }]));
  const days = new Map(stages.map(s => [s.id, new Set(workingDays(s.startsOn, s.endsOn, s.weekdays))]));
  return shiftsToRetime(placed, hours, days, supervisorDays(all));
}

/**
 * Gives {shifts} their stage's hours (and shift type), each on its own savepoint, as changing a {shift}'s times does
 * (logged as `times_changed`; Draft weeks only, so nobody is messaged): a new start already past leaves it as it was
 * (counted as started); equipment on it that can't be used at the new hours leaves it as it was (`equipmentKept`);
 * a person who can't work them is taken off and the {shift} left open with the reason (`takenOff`), as "Roster" does.
 */
async function retimeShifts(db: PoolClient, tenantId: string, sort: RetimeSort, zone: string): Promise<ReturnType<typeof noRetime>> {
  const out = { ...noRetime(), retimeKept: { ...sort.kept } };
  for (const r of sort.retime) {
    const h = r.hours;
    await db.query('savepoint stage_retime');
    const u = (await db.query<{ future: boolean }>(
      `update shifts set starts_at = ($2::date + $3::time) at time zone $6, ends_at = ($2::date + $5::int + $4::time) at time zone $6,
              break_minutes = $7, shift_code_id = case when $8 then shift_code_id else $9::uuid end, updated_at = now()
        where id = $1 and status <> 'cancelled' and starts_at > now() returning starts_at > now() as future`,
      [r.id, r.date, h.startTime, h.endTime, h.endTime < h.startTime ? 1 : 0, zone, h.breakMinutes, r.supervisor, h.shiftCodeId])).rows[0];
    if (!u?.future) { await db.query('rollback to savepoint stage_retime'); out.retimeKept.started++; continue; }
    const problem: HoursProblem = { date: r.date, startTime: h.startTime, role: r.role, workerName: null, reason: '' };
    const booked = (await db.query<{ equipment_id: string }>(
      `select equipment_id from shift_assignments where shift_id = $1 and resource_kind = 'equipment' and status = 'confirmed'`, [r.id])).rows.map(x => x.equipment_id);
    const stuck = booked.length ? (await equipmentForShift(db, tenantId, r.id, booked)).filter(e => e.blocks.length) : [];
    if (stuck.length) {
      await db.query('rollback to savepoint stage_retime');
      out.equipmentKept.push({ ...problem, workerName: stuck[0].name, reason: firstReason(stuck[0].blocks) });
      continue;
    }
    const person = (await db.query<{ worker_id: string; status: string }>(
      `select a.worker_id, w.status from shift_assignments a join workers w on w.id = a.worker_id
        where a.shift_id = $1 and a.resource_kind = 'worker' and a.status in ('assigned', 'confirmed')`, [r.id])).rows[0];
    if (person && person.status !== 'agency') {
      const [c] = await eligibilityForShift(db, tenantId, r.id, [person.worker_id]);
      if (c && c.blocks.length) {
        await removeWorker(db, r.id, false);
        out.takenOff.push({ ...problem, workerName: c.name, reason: firstReason(c.blocks) });
      }
    }
    await db.query('release savepoint stage_retime');
    out.retimed++;
  }
  out.takenOff.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return out;
}

/** Everything the Stages tab shows: the project's supervisor and each stage with its team copy, gaps, shifts and equipment. */
async function stagesView(db: PoolClient, p: ProjectRow) {
  const today = todayIn(p.timezone);
  const stages = await liveStages(db, p.id);
  const ids = stages.map(s => s.id);
  const [makeUp, people, shifts, placed] = await Promise.all([makeUpOf(db, ids), peopleOf(db, ids), stageShifts(db, ids), placedShifts(db, p.id)]);
  const equipment = ids.length ? (await db.query<{ id: string; stageId: string; equipmentId: string; equipmentName: string; typeName: string; from: string; to: string | null }>(
    `select x.id, x.project_stage_id as "stageId", x.equipment_id as "equipmentId", e.name as "equipmentName", et.name as "typeName",
            to_char(x.starts_on, 'YYYY-MM-DD') as "from", to_char(x.ends_on, 'YYYY-MM-DD') as "to"
       from equipment_site_allocations x join equipment e on e.id = x.equipment_id join equipment_types et on et.id = e.equipment_type_id
      where x.project_stage_id = any($1) and x.removed_at is null order by e.name`, [ids])).rows : [];
  const items = await stageItems(db, p, stages.map(s => ({ id: s.id, state: stageState(s, today) })));
  const overlaps = stageOverlaps(stages);
  const sup = p.supervisorWorkerId ? (await db.query<{ id: string; name: string; status: string; roles: string[] }>(
    `select id, coalesce(preferred_name, first_name) || ' ' || last_name as name, status, roles from workers where id = $1`, [p.supervisorWorkerId])).rows[0] ?? null : null;
  const supDays = supervisorDays(stages);
  const supShifts = (await db.query<{ n: number }>(
    `select count(distinct (s.starts_at at time zone f.timezone)::date)::int as n from shifts s join facilities f on f.id = s.facility_id
      where s.facility_id = $1 and s.project_supervisor and s.status <> 'cancelled'`, [p.id])).rows[0].n;
  return {
    project: { id: p.id, name: p.name, startsOn: p.startsOn, endsOn: p.endsOn, timezone: p.timezone },
    today,
    span: stages.length ? { from: stages.reduce((m, s) => (s.startsOn < m ? s.startsOn : m), stages[0].startsOn), to: stages.reduce((m, s) => (s.endsOn > m ? s.endsOn : m), stages[0].endsOn) } : null,
    supervisor: sup ? {
      workerId: sup.id, name: sup.name, active: sup.status === 'active', role: supervisorRole(sup.roles),
      workingDays: supDays.size, daysRostered: supShifts,
    } : null,
    stages: stages.map(s => {
      const m = makeUp.get(s.id) ?? [];
      const ppl = (people.get(s.id) ?? []).map(({ stageId: _, ...x }) => x);
      const mine = shifts.filter(x => x.stageId === s.id);
      const days = workingDays(s.startsOn, s.endsOn, s.weekdays);
      const slots = planSlots(m, ppl).filter(x => x.workerId === null || x.workerId !== p.supervisorWorkerId);
      return {
        id: s.id, name: s.name, areaId: s.areaId, areaName: s.areaName, startsOn: s.startsOn, endsOn: s.endsOn, weekdays: s.weekdays,
        startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, ownTimes: s.ownStart !== null, shiftCodeId: s.shiftCodeId, shiftCode: s.shiftCode,
        teamId: s.teamId, teamName: s.teamName, notes: s.notes,
        line: stageLine(s), weekdaysLine: weekdaysLine(s.weekdays), workingDays: days.length,
        state: stageState(s, today),
        roles: m, makeUpLine: makeUpLine(m), needed: m.reduce((n, r) => n + r.count, 0),
        people: ppl.map(x => ({ ...x, supervisor: x.workerId === p.supervisorWorkerId })), shortLine: stageShortLine(m, ppl),
        placesPerDay: slots.length,
        overlaps: overlaps.get(s.id) ?? [],
        rostered: {
          shifts: mine.length, open: mine.filter(x => x.status === 'open').length,
          days: new Set(mine.map(x => x.date)).size,
          outside: mine.filter(x => !days.includes(x.date)).length,
          // Of those, how many "Move to the stage's dates" would take off (Draft weeks, not started, no agency's person).
          outsideMovable: shiftsOutside(placed.filter(x => x.stageId === s.id), new Map([[s.id, new Set(days)]]), new Set()).cancel.length,
          // Not started, on the stage's days but not at its hours (or shift type) now, and how many "Bring them in line" would change.
          ...(() => {
            const r = shiftsToRetime(placed.filter(x => x.stageId === s.id), new Map([[s.id, { startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, shiftCodeId: s.shiftCodeId }]]),
              new Map([[s.id, new Set(days)]]), new Map(), false);
            return { offHours: r.retime.length + r.kept.agency + r.kept.published, offHoursMovable: r.retime.length };
          })(),
        },
        equipment: equipment.filter(e => e.stageId === s.id).map(({ stageId: _, ...e }) => ({ ...e, line: rangeLine(e, today) })),
        items: items.byStage.get(s.id) ?? [],
      };
    }),
    itemShortages: items.shortages,
  };
}

const stageState = (s: { startsOn: string; endsOn: string }, today: string): 'ended' | 'current' | 'upcoming' =>
  s.endsOn < today ? 'ended' : s.startsOn > today ? 'upcoming' : 'current';

/**
 * The stages' planned items, what each stage's {shifts} used (issued for or used on them, net of returns) and the
 * project's stock on hand of counted items, worked out into lines and shortages (`stageItemLines`).
 */
async function stageItems(db: PoolClient, p: ProjectRow, stages: { id: string; state: 'ended' | 'current' | 'upcoming' }[]) {
  const ids = stages.map(s => s.id);
  if (!ids.length) return stageItemLines([], [], [], new Map());
  const planned = (await db.query<PlannedItem>(
    `select x.id, x.stage_id as "stageId", x.item_id as "itemId", i.name, i.unit, i.tracks_stock as "tracksStock", x.quantity::float8 as planned, x.note
       from project_stage_items x join items i on i.id = x.item_id
      where x.stage_id = any($1) and x.removed_at is null order by lower(i.name), x.added_at`, [ids])).rows;
  const used = (await db.query<UsedItem>(
    `select s.project_stage_id as "stageId", m.item_id as "itemId", i.name, i.unit, i.tracks_stock as "tracksStock", (-sum(m.quantity))::float8 as used
       from stock_movements m join shifts s on s.id = m.shift_id join items i on i.id = m.item_id
      where s.project_stage_id = any($1) and m.kind in ('issued', 'used', 'returned')
      group by s.project_stage_id, m.item_id, i.name, i.unit, i.tracks_stock`, [ids])).rows;
  const counted = [...new Set(planned.filter(x => x.tracksStock).map(x => x.itemId))];
  const onHand = new Map(counted.length ? (await db.query<{ item_id: string; n: number }>(
    `select item_id, coalesce(sum(quantity), 0)::float8 as n from stock_movements where facility_id = $1 and item_id = any($2) group by item_id`,
    [p.id, counted])).rows.map(r => [r.item_id, r.n] as const) : []);
  return stageItemLines(stages, planned, used, onHand);
}

interface StageFields {
  name: string | null; areaId: string | null; startsOn: string | null; endsOn: string | null; weekdays: number[];
  startTime: string | null; endTime: string | null; breakMinutes: number; shiftCodeId: string | null; notes: string | null;
}

/** The fields given in a request, over `cur` (a change) or CROP's defaults (a new stage). Checked against the project. */
async function stageFields(db: PoolClient, body: Record<string, unknown>, facilityId: string, cur: StageFields | null): Promise<StageFields> {
  const has = (k: string) => Boolean(body && k in body);
  const wd = parseWeekdays(body?.weekdays);
  if (wd && 'problem' in wd) throw new BadRequestException(wd.problem);
  const f: StageFields = {
    name: has('name') ? text(body, 'name', { max: 80 }) : cur?.name ?? null,
    areaId: has('areaId') ? text(body, 'areaId', { max: 40 }) : cur?.areaId ?? null,
    startsOn: has('startsOn') ? date(body, 'startsOn') : cur?.startsOn ?? null,
    endsOn: has('endsOn') ? date(body, 'endsOn') : cur?.endsOn ?? null,
    weekdays: (wd as number[] | null) ?? cur?.weekdays ?? [...DEFAULT_WEEKDAYS],
    startTime: has('startTime') ? time(body, 'startTime', 'Start time') : cur?.startTime ?? null,
    endTime: has('endTime') ? time(body, 'endTime', 'Finish time') : cur?.endTime ?? null,
    breakMinutes: has('breakMinutes') ? int(body, 'breakMinutes', 0, 240) ?? 0 : cur?.breakMinutes ?? 0,
    shiftCodeId: has('shiftCodeId') ? text(body, 'shiftCodeId', { max: 40 }) : cur?.shiftCodeId ?? null,
    notes: has('notes') ? text(body, 'notes', { max: 1000 }) : cur?.notes ?? null,
  };
  if (f.areaId && (!UUID.test(f.areaId) || !(await db.query('select 1 from areas where id = $1 and facility_id = $2', [f.areaId, facilityId])).rowCount)) {
    throw new BadRequestException('Choose {an area} of this {project}');
  }
  if (f.shiftCodeId && (!UUID.test(f.shiftCodeId) || !(await db.query(
    'select 1 from shift_codes where id = $1 and active and (facility_id is null or facility_id = $2)', [f.shiftCodeId, facilityId])).rowCount)) {
    throw new BadRequestException('Choose a shift type for this {project}');
  }
  // A shift type gives the hours unless times are typed too.
  if (f.shiftCodeId && has('shiftCodeId') && !has('startTime')) { f.startTime = null; f.endTime = null; }
  const p = stageProblem(f);
  if (p) throw new BadRequestException(p);
  return f;
}

/**
 * Puts the usual person on a new shift when eligibility passes (assigned, waiting for them to confirm); otherwise
 * returns the first reason and the shift stays open. Locks the person first, as assigning does.
 */
async function tryPut(db: PoolClient, tenantId: string, userId: string, shiftId: string, workerId: string): Promise<{ ok: true } | { ok: false; reason: string; name: string }> {
  const w = (await db.query<{ status: string; name: string }>(
    `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`, [workerId])).rows[0];
  if (!w) return { ok: false, reason: 'Person not found', name: 'Someone' };
  if (w.status !== 'active') return { ok: false, reason: `${w.name} isn't active`, name: w.name };
  const [check] = await eligibilityForShift(db, tenantId, shiftId, [workerId]);
  if (!check?.eligible) return { ok: false, reason: firstReason(check?.blocks ?? []), name: w.name };
  await db.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, assigned_by) values ($1, $2, $3, $4)`, [tenantId, shiftId, workerId, userId]);
  await db.query(`update shifts set status = 'assigned', updated_at = now() where id = $1`, [shiftId]);
  return { ok: true };
}

async function insertShift(db: PoolClient, tenantId: string, userId: string, p: ProjectRow, d: string, h: { startTime: string; endTime: string; breakMinutes: number },
  extra: { role: string; areaId: string | null; shiftCodeId: string | null; usual: string | null; stageId: string | null; supervisor: boolean }): Promise<string> {
  return (await db.query<{ id: string }>(
    `insert into shifts(tenant_id, facility_id, area_id, shift_code_id, role, starts_at, ends_at, break_minutes, created_by, usual_worker_id, project_stage_id, project_supervisor)
     values ($1, $2, $3, $4, $5, ($6::date + $7::time) at time zone $8, ($6::date + $9::int + $10::time) at time zone $8, $11, $12, $13, $14, $15)
     returning id`,
    [tenantId, p.id, extra.areaId, extra.shiftCodeId, extra.role, d, h.startTime, p.timezone, h.endTime < h.startTime ? 1 : 0, h.endTime,
      h.breakMinutes, userId, extra.usual, extra.stageId, extra.supervisor])).rows[0].id;
}

/**
 * "Roster this stage" / "Roster whole project": ordinary shifts at the project for each working day of the stages, one
 * per place (named person or gap), with the named person as the usual person and put on only when eligibility passes.
 * Plus the project supervisor's one shift a day on those days. Never doubles: what was made before is counted as
 * already rostered (`toCreate`). Past days are left alone. Shifts land in the Draft roster (nobody is messaged).
 */
async function rosterStages(db: PoolClient, tenantId: string, userId: string, p: ProjectRow, only: string[] | null): Promise<RosterResult> {
  const all = await liveStages(db, p.id);
  const stages = only ? all.filter(s => only.includes(s.id)) : all;
  const now = localNow(p.timezone);
  const isPast = (d: string, start: string) => d < now.date || (d === now.date && start <= now.time);
  const ids = stages.map(s => s.id);
  const [makeUp, people, existing] = await Promise.all([makeUpOf(db, ids), peopleOf(db, ids), stageShifts(db, ids)]);
  const result = emptyResult();
  const w = await wordsFor(db);
  // Plan everything first so a too-big press is refused before anything is made.
  const plan: { stage: typeof stages[number]; date: string; slot: ReturnType<typeof planSlots>[number] }[] = [];
  const pastDates = new Set<string>();
  for (const s of stages) {
    const slots = planSlots(makeUp.get(s.id) ?? [], people.get(s.id) ?? []).filter(x => x.workerId === null || x.workerId !== p.supervisorWorkerId);
    for (const d of workingDays(s.startsOn, s.endsOn, s.weekdays)) {
      const ex: Existing[] = existing.filter(e => e.stageId === s.id && e.date === d);
      if (isPast(d, s.startTime)) { pastDates.add(d); continue; }
      const { create, already } = toCreate(slots, ex);
      result.alreadyRostered += already;
      for (const slot of create) plan.push({ stage: s, date: d, slot });
    }
  }
  if (plan.length > MAX_ROSTER_SHIFTS) throw new BadRequestException(`That would add more than ${w.count(MAX_ROSTER_SHIFTS, T.shift)}; roster one stage at a time`);
  for (const { stage: s, date: d, slot } of plan) {
    const id = await insertShift(db, tenantId, userId, p, d, s, {
      role: slot.role, areaId: s.areaId, shiftCodeId: s.shiftCodeId, usual: slot.workerId, stageId: s.id, supervisor: false,
    });
    result.created++;
    if (!slot.workerId) {
      result.leftOpen.push({ date: d, startTime: s.startTime, role: slot.role, workerName: null, reason: GAP_REASON });
      continue;
    }
    const put = await tryPut(db, tenantId, userId, id, slot.workerId);
    if (put.ok) result.assigned++;
    else result.leftOpen.push({ date: d, startTime: s.startTime, role: slot.role, workerName: put.name, reason: put.reason });
  }
  // The supervisor: one shift a day on these stages' working days, at the hours of every stage working that day.
  if (p.supervisorWorkerId) {
    const sup = (await db.query<{ roles: string[]; status: string }>('select roles, status from workers where id = $1', [p.supervisorWorkerId])).rows[0];
    const hours = supervisorDays(all);
    const wanted = new Set(stages.flatMap(s => workingDays(s.startsOn, s.endsOn, s.weekdays)));
    const have = new Set((await db.query<{ date: string }>(
      `select distinct to_char((s.starts_at at time zone f.timezone)::date, 'YYYY-MM-DD') as date from shifts s join facilities f on f.id = s.facility_id
        where s.facility_id = $1 and s.project_supervisor and s.status <> 'cancelled'`, [p.id])).rows.map(r => r.date));
    if (sup) {
      const role = supervisorRole(sup.roles);
      for (const [d, h] of hours) {
        if (!wanted.has(d)) continue;
        if (isPast(d, h.startTime)) { pastDates.add(d); continue; }
        if (have.has(d)) { result.alreadyRostered++; continue; }
        const id = await insertShift(db, tenantId, userId, p, d, h, { role, areaId: null, shiftCodeId: null, usual: p.supervisorWorkerId, stageId: null, supervisor: true });
        result.supervisorCreated++;
        const put = await tryPut(db, tenantId, userId, id, p.supervisorWorkerId);
        if (put.ok) result.supervisorAssigned++;
        else result.leftOpen.push({ date: d, startTime: h.startTime, role, workerName: put.name, reason: put.reason });
      }
    }
  }
  result.pastDays = pastDates.size;
  result.leftOpen.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return result;
}

/** Copying a standing team shows people from every site, so it needs someone who sees every site (like the Teams page). */
function everySite(t: Membership) {
  if (isLimited(t)) throw new ForbiddenException('{Teams} cover every {site}, so only people who see every {site} can use them');
}

/**
 * Project stages (David, 5 Nov; migration 0093): stages with dates, working days, hours and their own copy of a
 * standing team, rostered into ordinary Draft shifts. Reads for site roles; changes for office roles.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class ProjectStagesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private tx<T>(t: Membership, auth: AuthContext, fn: (db: PoolClient) => Promise<T>) {
    return withTenant(this.pool, t.tenantId, fn, actorOf(auth));
  }

  /** The project's stages (by start date) with the supervisor, overlaps, team copies, gaps, shifts made and equipment. */
  @Roles(...SITE_ROLES)
  @Get('projects/:id/stages')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => stagesView(db, await projectOf(db, id)));
  }

  /** Adds a stage: `name`, `areaId`, `startsOn`, `endsOn`, `weekdays` (default Mon–Fri), `startTime`/`endTime`/`breakMinutes` or `shiftCodeId`, `notes`, optional `teamId`. */
  @Roles(...OFFICE_ROLES)
  @Post('projects/:id/stages')
  add(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const teamId = text(body, 'teamId', { max: 40 });
    if (teamId) everySite(t);
    return this.tx(t, auth, async db => {
      const p = await projectOf(db, id, true);
      const f = await stageFields(db, body, id, null);
      const row = (await db.query<{ id: string }>(
        `insert into project_stages(tenant_id, facility_id, name, area_id, starts_on, ends_on, weekdays, start_time, end_time, break_minutes, shift_code_id, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [t.tenantId, id, f.name!.trim(), f.areaId, f.startsOn, f.endsOn, f.weekdays, f.startTime, f.endTime, f.breakMinutes, f.shiftCodeId, f.notes, auth.userId])).rows[0];
      if (teamId) await copyTeam(db, t.tenantId, auth.userId, row.id, teamId);
      return { id: row.id, ...(await stagesView(db, p)) };
    });
  }

  /**
   * Other {projects} whose stages can be copied here (stage templates, 5 Nov): every {project} (archived ones too)
   * with live stages, newest first, with how many stages, their names and their dates.
   */
  @Roles(...OFFICE_ROLES)
  @Get('projects/:id/stage-sources')
  sources(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await projectOf(db, id);
      const rows = (await db.query<{ id: string; name: string; code: string | null; status: string; clientName: string | null; stageCount: number;
        stageNames: string[]; firstDay: string; lastDay: string }>(
        `select f.id, f.name, f.code, f.status, c.name as "clientName", count(st.id)::int as "stageCount",
                array_agg(st.name order by st.starts_on, st.created_at) as "stageNames",
                to_char(min(st.starts_on), 'YYYY-MM-DD') as "firstDay", to_char(max(st.ends_on), 'YYYY-MM-DD') as "lastDay"
           from facilities f join project_stages st on st.facility_id = f.id and st.removed_at is null
           left join clients c on c.id = f.client_id
          where f.kind = 'project' and f.id <> $1
          group by f.id, c.name order by max(st.starts_on) desc, lower(f.name)`, [id])).rows;
      return rows.map(r => ({ ...r, line: `${r.stageCount === 1 ? '1 stage' : `${r.stageCount} stages`}: ${r.stageNames.join(', ')}` }));
    });
  }

  /**
   * Copies another {project}'s stages here (`fromProjectId`, `startsOn` = the first stage's first day): each stage's
   * dates (`copyStageDates`), working days, hours (a shift type of the other {site} becomes its hours), notes, the
   * standing team it came from and its make-up; `people` (default true) its named people who are still active and
   * still have the role; `items` (default true) its planned items still in use. {Areas} are matched by name, and added
   * for owners and admins when this {project} doesn't have one of that name. Equipment, the supervisor and {shifts}
   * are never copied. Adds to any stages already here.
   */
  @Roles(...OFFICE_ROLES)
  @Post('projects/:id/stages/copy')
  copy(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const fromId = text(body, 'fromProjectId', { required: true, max: 40 })!;
    if (!UUID.test(fromId)) throw new BadRequestException('Choose {a project} to copy from');
    if (fromId === id) throw new BadRequestException('Choose another {project} to copy from');
    const firstDay = date(body, 'startsOn');
    if (!firstDay) throw new BadRequestException('Choose the first stage’s first day');
    const withPeople = bool(body, 'people') ?? true;
    const withItems = bool(body, 'items') ?? true;
    const canAddAreas = t.role === 'owner' || t.role === 'admin';
    return this.tx(t, auth, async db => {
      const p = await projectOf(db, id, true);
      const from = await projectOf(db, fromId).catch(() => { throw new NotFoundException('{Project} to copy from not found'); });
      const src = await liveStages(db, fromId);
      const r: CopyResult = { copied: 0, people: 0, peopleLeftOff: [], items: 0, itemsLeftOff: [], areasAdded: [], areasMissing: [], hoursInstead: 0, equipment: 0 };
      if (!src.length) throw new BadRequestException(`${from.name} has no stages to copy`);
      const by = copyOffset(src, firstDay);
      const srcIds = src.map(s => s.id);
      const [makeUp, people] = await Promise.all([makeUpOf(db, srcIds), peopleOf(db, srcIds)]);
      const codes = new Map((await db.query<{ id: string; ok: boolean }>(
        'select id, facility_id is null and active as ok from shift_codes where id = any($1)', [src.map(s => s.shiftCodeId).filter(Boolean)])).rows.map(x => [x.id, x.ok]));
      const areas = new Map((await db.query<{ id: string; name: string }>('select id, name from areas where facility_id = $1 and active', [id])).rows
        .map(a => [a.name.trim().toLowerCase(), a.id]));
      const roles = new Map((await db.query<{ id: string; roles: string[]; status: string }>(
        'select id, roles, status from workers where id = any($1)', [[...people.values()].flat().map(x => x.workerId)])).rows.map(w => [w.id, w]));
      const planned = withItems ? (await db.query<{ stageId: string; itemId: string; name: string; active: boolean; quantity: string; note: string | null }>(
        `select x.stage_id as "stageId", x.item_id as "itemId", i.name, i.active, x.quantity::text as quantity, x.note
           from project_stage_items x join items i on i.id = x.item_id where x.stage_id = any($1) and x.removed_at is null order by x.added_at`, [srcIds])).rows : [];
      r.equipment = (await db.query('select 1 from equipment_site_allocations where project_stage_id = any($1) and removed_at is null', [srcIds])).rowCount ?? 0;
      for (const s of src) {
        const d = copyStageDates(s, by);
        let areaId: string | null = null;
        if (s.areaName) {
          const key = s.areaName.trim().toLowerCase();
          areaId = areas.get(key) ?? null;
          if (!areaId && canAddAreas) {
            areaId = (await db.query<{ id: string }>('insert into areas(tenant_id, facility_id, name) values ($1,$2,$3) returning id', [t.tenantId, id, s.areaName.trim()])).rows[0].id;
            areas.set(key, areaId);
            r.areasAdded.push(s.areaName.trim());
          } else if (!areaId && !r.areasMissing.includes(s.areaName)) r.areasMissing.push(s.areaName);
        }
        const keepCode = Boolean(s.shiftCodeId && codes.get(s.shiftCodeId));
        if (s.shiftCodeId && !keepCode) r.hoursInstead++;
        const f = keepCode
          ? { startTime: s.ownStart, endTime: s.ownEnd, breakMinutes: s.ownStart ? s.breakMinutes : 0, shiftCodeId: s.shiftCodeId }
          : { startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, shiftCodeId: null };
        const problem = stageProblem({ name: s.name, ...d, weekdays: s.weekdays, ...f });
        if (problem) throw new BadRequestException(`${s.name}: ${problem}`);
        const stageId = (await db.query<{ id: string }>(
          `insert into project_stages(tenant_id, facility_id, name, area_id, starts_on, ends_on, weekdays, start_time, end_time, break_minutes, shift_code_id, team_id, notes, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
          [t.tenantId, id, s.name, areaId, d.startsOn, d.endsOn, s.weekdays, f.startTime, f.endTime, f.breakMinutes, f.shiftCodeId, s.teamId, s.notes, auth.userId])).rows[0].id;
        r.copied++;
        await replaceRoles(db, t.tenantId, stageId, makeUp.get(s.id) ?? []);
        if (withPeople) {
          for (const x of people.get(s.id) ?? []) {
            const w = roles.get(x.workerId);
            const reason = !w || w.status !== 'active' ? 'not active' : !w.roles.includes(x.role) ? `no longer ${x.role}` : null;
            if (reason) { r.peopleLeftOff.push({ name: x.name, stage: s.name, reason }); continue; }
            await db.query('insert into project_stage_people(tenant_id, stage_id, worker_id, role, added_by) values ($1,$2,$3,$4,$5)', [t.tenantId, stageId, x.workerId, x.role, auth.userId]);
            r.people++;
          }
        }
        for (const it of planned.filter(x => x.stageId === s.id)) {
          if (!it.active) { r.itemsLeftOff.push({ name: it.name, stage: s.name }); continue; }
          await db.query('insert into project_stage_items(tenant_id, stage_id, item_id, quantity, note, added_by) values ($1,$2,$3,$4,$5,$6)',
            [t.tenantId, stageId, it.itemId, it.quantity, it.note, auth.userId]);
          r.items++;
        }
      }
      const firstCopied = copyStageDates(src.reduce((m, s) => (s.startsOn < m.startsOn ? s : m), src[0]), by).startsOn;
      return { ...r, summary: copySummary(r, from.name, firstCopied, await wordsFor(db)), ...(await stagesView(db, p)) };
    });
  }

  /**
   * Changes a stage. `moveLater: true` with a new last day moves every stage that started after the old last day by
   * the same number of days (never automatic). `moveShifts: true` then brings the {shifts} of this stage (and any moved)
   * to the new dates (`matchShifts`: Draft weeks only); otherwise they stay where they are (`rostered.outside` counts them).
   */
  @Roles(...OFFICE_ROLES)
  @Patch('project-stages/:id')
  update(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const moveLater = bool(body, 'moveLater') ?? false;
    const moveShifts = bool(body, 'moveShifts') ?? false;
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      const p = await projectOf(db, cur.facilityId, true);
      const f = await stageFields(db, body, cur.facilityId, {
        ...cur, startTime: cur.ownStart, endTime: cur.ownEnd,
      });
      await db.query(
        `update project_stages set name = $2, area_id = $3, starts_on = $4, ends_on = $5, weekdays = $6, start_time = $7, end_time = $8,
                break_minutes = $9, shift_code_id = $10, notes = $11, updated_at = now() where id = $1`,
        [id, f.name!.trim(), f.areaId, f.startsOn, f.endsOn, f.weekdays, f.startTime, f.endTime, f.breakMinutes, f.shiftCodeId, f.notes]);
      const moved = moveLater ? moveLaterStages(await liveStages(db, cur.facilityId).then(r => r.map(s => (s.id === id ? { ...s, endsOn: cur.endsOn } : s))), id, cur.endsOn, f.endsOn!) : [];
      for (const m of moved) await db.query('update project_stages set starts_on = $2, ends_on = $3, updated_at = now() where id = $1', [m.id, m.startsOn, m.endsOn]);
      const shifts = moveShifts ? await matchShifts(db, t.tenantId, auth.userId, p, [id, ...moved.map(m => m.id)]) : null;
      return {
        moved: moved.map(m => ({ id: m.id, name: m.name, startsOn: m.startsOn, endsOn: m.endsOn })),
        shifts, shiftsSummary: shifts ? moveSummary(shifts, await wordsFor(db)) : null,
        ...(await stagesView(db, p)),
      };
    });
  }

  /**
   * Takes a stage off (kept on file). `cancelShifts: true` also takes its {shifts} off the Draft roster (and the
   * supervisor's on days no other stage works); otherwise they stay on the roster.
   */
  @Roles(...OFFICE_ROLES)
  @Post('project-stages/:id/remove')
  remove(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { max: 200 });
    const cancelShifts = bool(body, 'cancelShifts') ?? false;
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      await db.query('update project_stages set removed_at = now(), removed_reason = $2 where id = $1', [id, reason]);
      const shifts = cancelShifts ? await matchShifts(db, t.tenantId, auth.userId, await projectOf(db, cur.facilityId, true), [id], true) : null;
      return { removed: true, facilityId: cur.facilityId, shifts, shiftsSummary: shifts ? moveSummary(shifts, await wordsFor(db), true) : null };
    });
  }

  /** Brings a stage's {shifts} to its dates after they changed (Draft weeks only; see `matchShifts`). */
  @Roles(...OFFICE_ROLES)
  @Post('project-stages/:id/move-shifts')
  moveShifts(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      const p = await projectOf(db, cur.facilityId, true);
      const r = await matchShifts(db, t.tenantId, auth.userId, p, [id]);
      return { ...r, summary: moveSummary(r, await wordsFor(db)) };
    });
  }

  /**
   * Copies a standing team into the stage (`teamId`; null = no team): its make-up and current people become the
   * stage's own rows, replacing what the stage had. The standing team itself is never changed.
   */
  @Roles(...OFFICE_ROLES)
  @Put('project-stages/:id/team')
  setTeam(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const teamId = text(body, 'teamId', { max: 40 });
    if (teamId) everySite(t);
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      if (teamId) await copyTeam(db, t.tenantId, auth.userId, id, teamId);
      else {
        await db.query('update project_stage_roles set removed_at = now() where stage_id = $1 and removed_at is null', [id]);
        await db.query(`update project_stage_people set removed_at = now(), removed_reason = 'Team cleared' where stage_id = $1 and removed_at is null`, [id]);
        await db.query('update project_stages set team_id = null, updated_at = now() where id = $1', [id]);
      }
      return stagesView(db, await projectOf(db, cur.facilityId));
    });
  }

  /** The stage's own make-up (`roles: [{role, count}]`), replaced as a set; the standing team is unchanged. */
  @Roles(...OFFICE_ROLES)
  @Put('project-stages/:id/roles')
  setRoles(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      const parsed = parseMakeUp(body?.roles, await knownRoles(db), await wordsFor(db));
      if ('problem' in parsed) throw new BadRequestException(parsed.problem);
      await replaceRoles(db, t.tenantId, id, parsed.roles);
      return stagesView(db, await projectOf(db, cur.facilityId));
    });
  }

  /** Names someone for this stage only (`workerId`, `role`: one of theirs). */
  @Roles(...OFFICE_ROLES)
  @Post('project-stages/:id/people')
  addPerson(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const workerId = text(body, 'workerId', { required: true, max: 40 })!;
    if (!UUID.test(workerId)) throw new BadRequestException('Choose a person');
    const role = text(body, 'role', { max: 80 }) ?? '';
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      const w = (await db.query<{ name: string; status: string; roles: string[] }>(
        `select coalesce(preferred_name, first_name) || ' ' || last_name as name, status, roles from workers where id = $1`, [workerId])).rows[0];
      if (!w) throw new BadRequestException('Choose a person');
      const no = joinRefusal(w, role, await wordsFor(db));
      if (no) throw new BadRequestException(no.replace(/join a (\w+)/, 'be named for a stage'));
      if ((await db.query('select 1 from project_stage_people where stage_id = $1 and worker_id = $2 and removed_at is null', [id, workerId])).rowCount) {
        throw new ConflictException(`${w.name} is already named for this stage`);
      }
      await db.query('insert into project_stage_people(tenant_id, stage_id, worker_id, role, added_by) values ($1,$2,$3,$4,$5)', [t.tenantId, id, workerId, role, auth.userId]);
      return stagesView(db, await projectOf(db, cur.facilityId));
    });
  }

  /** Takes someone off this stage only (kept on file). Their {shifts} already made stay. */
  @Roles(...OFFICE_ROLES)
  @Post('project-stage-people/:id/remove')
  removePerson(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { max: 200 });
    return this.tx(t, auth, async db => {
      const r = (await db.query<{ stage_id: string }>(
        'update project_stage_people set removed_at = now(), removed_reason = $2 where id = $1 and removed_at is null returning stage_id', [id, reason])).rows[0];
      if (!r) throw new NotFoundException('Person not found on that stage');
      const st = await liveStage(db, r.stage_id);
      return stagesView(db, await projectOf(db, st.facilityId));
    });
  }

  /** Rosters one stage (and the supervisor's days in it). Returns what was made, what is left open and why, and a summary. */
  @Roles(...OFFICE_ROLES)
  @Post('project-stages/:id/roster')
  rosterStage(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx(t, auth, async db => {
      const cur = await liveStage(db, id);
      const p = await projectOf(db, cur.facilityId, true);
      const r = await rosterStages(db, t.tenantId, auth.userId, p, [id]);
      return { ...r, summary: rosterSummary(r, await wordsFor(db)) };
    });
  }

  /** Rosters every stage of the project, plus the supervisor on every working day. */
  @Roles(...OFFICE_ROLES)
  @Post('projects/:id/roster')
  rosterProject(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx(t, auth, async db => {
      const p = await projectOf(db, id, true);
      const r = await rosterStages(db, t.tenantId, auth.userId, p, null);
      return { ...r, summary: rosterSummary(r, await wordsFor(db)) };
    });
  }

  /** The project's supervisor (`workerId`, null = none): one person, rostered on every working day of every stage. */
  @Roles(...OFFICE_ROLES)
  @Put('projects/:id/supervisor')
  setSupervisor(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const workerId = text(body, 'workerId', { max: 40 });
    if (workerId && !UUID.test(workerId)) throw new BadRequestException('Choose a person');
    return this.tx(t, auth, async db => {
      const p = await projectOf(db, id, true);
      if (workerId) {
        const w = (await db.query<{ status: string; name: string }>(
          `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1`, [workerId])).rows[0];
        if (!w) throw new BadRequestException('Choose a person');
        if (w.status !== 'active') throw new BadRequestException(`${w.name} isn't active`);
      }
      await db.query('update facilities set supervisor_worker_id = $2 where id = $1', [id, workerId]);
      return stagesView(db, { ...p, supervisorWorkerId: workerId });
    });
  }

  /**
   * Plans an item for the stage (`itemId`, `quantity`, `note`): how much of it the stage is expected to use. Planning
   * an item the stage already has replaces its quantity (the old row is kept, marked removed).
   */
  @Roles(...OFFICE_ROLES)
  @Post('project-stages/:id/items')
  planItem(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const itemId = text(body, 'itemId', { required: true, max: 40 })!;
    if (!UUID.test(itemId)) throw new BadRequestException('Choose {an item}');
    const qty = plannedQuantity(body?.quantity);
    if (typeof qty !== 'number') throw new BadRequestException(qty.problem);
    const note = text(body, 'note', { max: 200 });
    return this.tx(t, auth, async db => {
      const st = await liveStage(db, id);
      const item = (await db.query<{ name: string; active: boolean }>('select name, active from items where id = $1', [itemId])).rows[0];
      if (!item) throw new NotFoundException('{Item} not found');
      if (!item.active) throw new ConflictException(`${item.name} is no longer in use`);
      await db.query('update project_stage_items set removed_at = now() where stage_id = $1 and item_id = $2 and removed_at is null', [id, itemId]);
      await db.query('insert into project_stage_items(tenant_id, stage_id, item_id, quantity, note, added_by) values ($1,$2,$3,$4,$5,$6)',
        [t.tenantId, id, itemId, qty, note, auth.userId]);
      return stagesView(db, await projectOf(db, st.facilityId));
    });
  }

  /** Takes a planned item off the stage (kept on file). What its {shifts} used stays in the stock ledger. */
  @Roles(...OFFICE_ROLES)
  @Post('project-stage-items/:id/remove')
  removeItem(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tx(t, auth, async db => {
      const r = (await db.query<{ stage_id: string }>(
        'update project_stage_items set removed_at = now() where id = $1 and removed_at is null returning stage_id', [id])).rows[0];
      if (!r) throw new NotFoundException('{Item} not found on that stage');
      const st = await liveStage(db, r.stage_id);
      return stagesView(db, await projectOf(db, st.facilityId));
    });
  }

  /** Books equipment to the project for the stage's dates (an allocation marked with the stage; refused like any allocation). */
  @Roles(...OFFICE_ROLES)
  @Post('project-stages/:id/equipment')
  bookEquipment(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const equipmentId = text(body, 'equipmentId', { required: true, max: 40 })!;
    if (!UUID.test(equipmentId)) throw new BadRequestException('Choose {an equipment}');
    return this.tx(t, auth, async db => {
      const st = await liveStage(db, id);
      const e = (await db.query<{ id: string; name: string; status: string }>('select id, name, status from equipment where id = $1 for update', [equipmentId])).rows[0];
      if (!e) throw new NotFoundException('{Equipment} not found');
      if (e.status === 'retired') throw new ConflictException(`${e.name} is retired`);
      const r = { from: st.startsOn, to: st.endsOn };
      await checkAllocation(db, e, st.facilityId, r);
      await db.query(
        `insert into equipment_site_allocations(tenant_id, equipment_id, facility_id, area_id, starts_on, ends_on, note, added_by, project_stage_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [t.tenantId, equipmentId, st.facilityId, st.areaId, r.from, r.to, `For ${st.name}`.slice(0, 300), auth.userId, id]);
      return stagesView(db, await projectOf(db, st.facilityId));
    });
  }
}

async function replaceRoles(db: PoolClient, tenantId: string, stageId: string, roles: MakeUp[]) {
  await db.query('update project_stage_roles set removed_at = now() where stage_id = $1 and removed_at is null', [stageId]);
  for (const [i, r] of roles.entries()) {
    await db.query('insert into project_stage_roles(tenant_id, stage_id, role, count, position) values ($1,$2,$3,$4,$5)', [tenantId, stageId, r.role, r.count, i]);
  }
}

/** Copies a standing team's make-up and its people on the team at the stage's start (or now) into the stage. */
async function copyTeam(db: PoolClient, tenantId: string, userId: string, stageId: string, teamId: string) {
  if (!UUID.test(teamId)) throw new BadRequestException('Choose {a team}');
  const team = (await db.query<{ active: boolean }>('select active from teams where id = $1', [teamId])).rows[0];
  if (!team) throw new BadRequestException('Choose {a team}');
  if (!team.active) throw new ConflictException('That {team} is put away. Bring it back first.');
  const st = (await db.query<{ starts_on: string; today: string }>(
    `select to_char(st.starts_on, 'YYYY-MM-DD') as starts_on, to_char((now() at time zone f.timezone)::date, 'YYYY-MM-DD') as today
       from project_stages st join facilities f on f.id = st.facility_id where st.id = $1`, [stageId])).rows[0];
  const roles = (await db.query<MakeUp>('select role, count from team_roles where team_id = $1 order by position, role', [teamId])).rows;
  await replaceRoles(db, tenantId, stageId, roles);
  await db.query(`update project_stage_people set removed_at = now(), removed_reason = 'Team chosen again' where stage_id = $1 and removed_at is null`, [stageId]);
  // People on the team on the stage's first day (or today, when it has started), still active.
  await db.query(
    `insert into project_stage_people(tenant_id, stage_id, worker_id, role, added_by)
     select distinct on (m.worker_id) $1, $2, m.worker_id, m.role, $3
       from team_members m join workers w on w.id = m.worker_id
      where m.team_id = $4 and m.removed_at is null and w.status = 'active'
        and m.starts_on <= greatest($5::date, $6::date) and (m.ends_on is null or m.ends_on >= least($5::date, $6::date))
      order by m.worker_id, m.starts_on desc`,
    [tenantId, stageId, userId, teamId, st.starts_on, st.today]);
  await db.query('update project_stages set team_id = $2, updated_at = now() where id = $1', [stageId, teamId]);
}
