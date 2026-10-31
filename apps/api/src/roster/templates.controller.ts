import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import { T, wordsFor } from '../terms/words.js';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, int, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { randomUUID } from 'node:crypto';
import { equipmentForShift } from './equipment-data.js';
import { eligibilityForShift } from './eligibility-data.js';
import { actorOf, mondayOf, weekState } from './publishing.js';
import { applySummary, copyWeeksSummary, firstReason, MAX_COPY_WEEKS, planWeek, weekPairs, type ApplyResult, type LeftOpen, type PlannedShift, type Slot } from './templates.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SHIFTS = 400;
/** The most shifts copied in one go when copying several weeks. */
const MAX_COPY_SHIFTS = 1000;

function siteField(body: Record<string, unknown>): string {
  const v = body?.facilityId;
  if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException('Choose a site');
  return v;
}

const weekField = (body: Record<string, unknown>, key: string, required = true) => {
  const d = date({ [key]: body?.[key] }, key, { required });
  return d ? mondayOf(d) : null;
};

async function site(db: PoolClient, facilityId: string) {
  const f = (await db.query<{ id: string; name: string; timezone: string }>(
    'select id, name, timezone from facilities where id = $1 for update', [facilityId])).rows[0];
  if (!f) throw new BadRequestException('Choose a site');
  return f;
}

/** The site's shifts in a week as slots (cancelled shifts left out). */
async function slotsFromWeek(db: PoolClient, facilityId: string, weekStart: string): Promise<Slot[]> {
  return (await db.query<Slot>(
    `select extract(isodow from s.starts_at at time zone f.timezone)::int as weekday,
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "startTime",
            to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "endTime",
            s.break_minutes as "breakMinutes", s.area_id as "areaId", s.shift_code_id as "shiftCodeId", s.role,
            s.needs_person as "needsPerson", sa.worker_id as "workerId", s.notes, s.gender_requested as "genderRequested",
            coalesce((select json_agg(se.equipment_id order by se.created_at) from shift_assignments se
                       where se.shift_id = s.id and se.resource_kind = 'equipment' and se.status in ('assigned', 'confirmed')), '[]'::json) as "equipmentIds",
            coalesce((select json_agg(dl.duty_id) from shift_duty_links dl where dl.shift_id = s.id), '[]'::json) as "dutyIds"
       from shifts s join facilities f on f.id = s.facility_id
       left join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
      where s.facility_id = $1 and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2 and $2::date + 6
      order by s.starts_at, s.role`, [facilityId, weekStart])).rows;
}

/** Refuses a week that is over, and (unless asked) a week that already has shifts, so nothing is doubled by mistake. */
async function checkTarget(db: PoolClient, f: { id: string; name: string; timezone: string }, weekStart: string, addToExisting: boolean) {
  const w = await wordsFor(db);
  if (weekState(weekStart, false, todayIn(f.timezone)) === 'history') throw new ConflictException(`That week is over, so ${w.lower(T.shift, true)} can no longer be added to it`);
  if (addToExisting) return;
  const n = (await db.query<{ n: number }>(
    `select count(*)::int as n from shifts s join facilities f on f.id = s.facility_id
      where s.facility_id = $1 and s.status <> 'cancelled' and (s.starts_at at time zone f.timezone)::date between $2 and $2::date + 6`,
    [f.id, weekStart])).rows[0].n;
  if (n > 0) {
    throw new ConflictException(`The week of ${weekStart} already has ${w.count(n, T.shift)} at ${f.name}. Choose "Add to the ${w.lower(T.shift, true)} already there" to add these as well.`);
  }
}

/**
 * Creates the week's shifts from slots and, when `people` is on, puts each slot's usual person on it
 * (assigned, waiting for them to confirm) wherever eligibility allows; otherwise the shift stays open.
 * When `equipment` is on, books each slot's usual equipment again (after the person, so the operator rule
 * sees them) wherever the equipment checks allow; otherwise it is left off with the reason.
 */
async function createFromSlots(
  db: PoolClient, tenantId: string, auth: AuthContext, f: { id: string; timezone: string }, weekStart: string, slots: Slot[], people: boolean, equipment: boolean,
): Promise<ApplyResult> {
  if (slots.length > MAX_SHIFTS) throw new BadRequestException(`That would add more than ${(await wordsFor(db)).count(MAX_SHIFTS, T.shift)}`);
  const result: ApplyResult = { created: 0, assigned: 0, leftOpen: [], equipmentBooked: 0, equipmentLeftOff: [] };
  for (const p of planWeek(slots, weekStart)) {
    const id = (await db.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, area_id, shift_code_id, role, starts_at, ends_at, break_minutes, notes, created_by, needs_person, gender_requested)
       values ($1, $2, $3, $4, $5, ($6::date + $7::time) at time zone $8, ($6::date + $9::int + $10::time) at time zone $8, $11, $12, $13, $14, $15)
       returning id`,
      [tenantId, f.id, p.areaId, p.shiftCodeId, p.role, p.date, p.startTime, f.timezone, p.overnight ? 1 : 0, p.endTime,
        p.breakMinutes, p.notes, auth.userId, p.needsPerson, p.needsPerson ? p.genderRequested ?? null : null])).rows[0].id;
    result.created++;
    // Duties first, so eligibility for the usual person sees what the shift needs. Switched-off duties are dropped.
    if (p.dutyIds?.length) {
      await db.query(
        `insert into shift_duty_links(tenant_id, shift_id, duty_id) select $1, $2, d.id from shift_duties d where d.id = any($3) and d.active`,
        [tenantId, id, p.dutyIds]);
    }
    if (people) await putUsualPerson(db, tenantId, auth, id, p, result);
    if (equipment) await bookUsualEquipment(db, tenantId, auth, id, p, result);
  }
  return result;
}

async function putUsualPerson(db: PoolClient, tenantId: string, auth: AuthContext, id: string, p: PlannedShift, result: ApplyResult) {
  if (!p.workerId || !p.needsPerson) return;
  // Lock the person (as assigning does) so nothing else rosters them at the same time.
  const w = (await db.query<{ status: string; name: string }>(
    `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`, [p.workerId])).rows[0];
  if (!w) return;
  const open = (reason: string): LeftOpen => ({ date: p.date, startTime: p.startTime, role: p.role, workerName: w.name, reason });
  if (w.status !== 'active') { result.leftOpen.push(open(`${w.name} isn't active`)); return; }
  const [check] = await eligibilityForShift(db, tenantId, id, [p.workerId]);
  if (!check?.eligible) { result.leftOpen.push(open(firstReason(check?.blocks ?? []))); return; }
  await db.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, assigned_by) values ($1, $2, $3, $4)`, [tenantId, id, p.workerId, auth.userId]);
  await db.query(`update shifts set status = 'assigned', updated_at = now() where id = $1`, [id]);
  result.assigned++;
}

async function bookUsualEquipment(db: PoolClient, tenantId: string, auth: AuthContext, id: string, p: PlannedShift, result: ApplyResult) {
  for (const equipmentId of p.equipmentIds ?? []) {
    // Lock the equipment (as booking does) so it can't be booked twice at once.
    const e = (await db.query<{ name: string }>('select name from equipment where id = $1 for update', [equipmentId])).rows[0];
    if (!e) continue;
    const [check] = await equipmentForShift(db, tenantId, id, [equipmentId]);
    if (!check?.eligible) {
      result.equipmentLeftOff.push({ date: p.date, startTime: p.startTime, role: p.role, equipmentName: e.name, reason: firstReason(check?.blocks ?? []) });
      continue;
    }
    await db.query(
      `insert into shift_assignments(tenant_id, shift_id, resource_kind, equipment_id, status, assigned_by) values ($1, $2, 'equipment', $3, 'confirmed', $4)`,
      [tenantId, id, equipmentId, auth.userId]);
    // On an equipment-only shift, status follows the equipment.
    if (!p.needsPerson) await db.query(`update shifts set status = 'booked', updated_at = now() where id = $1`, [id]);
    result.equipmentBooked++;
  }
}

const TEMPLATE_COLS = `t.id, t.facility_id as "facilityId", f.name as "facilityName", t.name, t.created_at as "createdAt",
  t.created_by_name as "createdByName",
  (select count(*)::int from roster_template_shifts ts where ts.template_id = t.id) as shifts,
  (select count(*)::int from roster_template_shifts ts where ts.template_id = t.id and ts.worker_id is not null) as "withPeople",
  (select count(*)::int from roster_template_shifts ts join roster_template_equipment te on te.template_shift_id = ts.id where ts.template_id = t.id) as "equipmentBookings"`;

/** Roster templates (the "ideal week") and copying a week (backlog item 2). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class RosterTemplatesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private tx<T>(t: Membership, auth: AuthContext, fn: (db: PoolClient) => Promise<T>) {
    return withTenant(this.pool, t.tenantId, fn, actorOf(auth));
  }

  @Roles(...OFFICE_ROLES)
  @Get('roster/templates')
  list(@Tenant() t: Membership, @Query('facilityId') facilityId?: string) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${TEMPLATE_COLS} from roster_templates t join facilities f on f.id = t.facility_id
        where t.archived_at is null and ($1::uuid is null or t.facility_id = $1)
        order by f.name, lower(t.name)`, [facilityId && UUID.test(facilityId) ? facilityId : null])).rows);
  }

  @Roles(...OFFICE_ROLES)
  @Get('roster/templates/:id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const tpl = (await db.query(`select ${TEMPLATE_COLS}, t.archived_at as "archivedAt" from roster_templates t join facilities f on f.id = t.facility_id where t.id = $1`, [id])).rows[0];
      if (!tpl) throw new NotFoundException('Template not found');
      const shifts = (await db.query(
        `select ts.weekday, to_char(ts.start_time, 'HH24:MI') as "startTime", to_char(ts.end_time, 'HH24:MI') as "endTime",
                ts.break_minutes as "breakMinutes", ts.role, a.name as "areaName", sc.letter as "shiftLetter", not ts.needs_person as "equipmentOnly",
                case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName",
                coalesce((select json_agg(e.name order by e.name) from roster_template_equipment te join equipment e on e.id = te.equipment_id
                           where te.template_shift_id = ts.id), '[]'::json) as equipment
           from roster_template_shifts ts left join areas a on a.id = ts.area_id left join shift_codes sc on sc.id = ts.shift_code_id
           left join workers w on w.id = ts.worker_id
          where ts.template_id = $1 order by ts.weekday, ts.start_time, ts.role`, [id])).rows;
      return { ...tpl, shiftList: shifts };
    });
  }

  /** Saves a site's week as a template. `people: false` leaves out who works each shift; `equipment: false` leaves out the equipment. */
  @Roles(...OFFICE_ROLES)
  @Post('roster/templates')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const facilityId = siteField(body);
    const weekStart = weekField(body, 'weekStart')!;
    const name = text(body, 'name', { required: true, max: 80 })!;
    const people = bool(body, 'people') ?? true;
    const equipment = bool(body, 'equipment') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      await site(db, facilityId);
      const slots = await slotsFromWeek(db, facilityId, weekStart);
      const w = await wordsFor(db);
      if (!slots.length) throw new BadRequestException(`There are no ${w.lower(T.shift, true)} at this ${w.lower(T.site)} that week to save`);
      if (slots.length > MAX_SHIFTS) throw new BadRequestException(`A template can hold up to ${w.count(MAX_SHIFTS, T.shift)}`);
      let id: string;
      try {
        id = (await db.query<{ id: string }>(
          `insert into roster_templates(tenant_id, facility_id, name, created_by, created_by_name) values ($1, $2, $3, $4, $5) returning id`,
          [t.tenantId, facilityId, name, auth.userId, actorOf(auth).name])).rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException(`There is already a template called ${name} for this site`);
        throw e;
      }
      const rows = slots.map(s => ({ ...s, id: randomUUID() }));
      await db.query(
        `insert into roster_template_shifts(id, tenant_id, template_id, weekday, start_time, end_time, break_minutes, area_id, shift_code_id, role, needs_person, worker_id, notes, gender_requested)
         select x.id, $1, $2, x.weekday, x."startTime"::time, x."endTime"::time, x."breakMinutes", x."areaId", x."shiftCodeId", x.role, x."needsPerson",
                case when $4 and x."needsPerson" then x."workerId" end, x.notes, x."genderRequested"
           from json_to_recordset($3::json) as x(id uuid, weekday int, "startTime" text, "endTime" text, "breakMinutes" int, "areaId" uuid,
                "shiftCodeId" uuid, role text, "needsPerson" boolean, "workerId" uuid, notes text, "genderRequested" text)`,
        [t.tenantId, id, JSON.stringify(rows), people]);
      const duties = rows.flatMap(r => (r.dutyIds ?? []).map(d => ({ s: r.id, d })));
      if (duties.length) {
        await db.query(
          `insert into roster_template_duties(tenant_id, template_shift_id, duty_id)
           select $1, x.s, x.d from json_to_recordset($2::json) as x(s uuid, d uuid) on conflict do nothing`, [t.tenantId, JSON.stringify(duties)]);
      }
      if (equipment) {
        const pairs = rows.flatMap(r => r.equipmentIds.map(e => ({ s: r.id, e })));
        if (pairs.length) {
          await db.query(
            `insert into roster_template_equipment(tenant_id, template_shift_id, equipment_id)
             select $1, x.s, x.e from json_to_recordset($2::json) as x(s uuid, e uuid) on conflict do nothing`, [t.tenantId, JSON.stringify(pairs)]);
        }
      }
      return (await db.query(`select ${TEMPLATE_COLS} from roster_templates t join facilities f on f.id = t.facility_id where t.id = $1`, [id])).rows[0];
    });
  }

  /** Puts a template away. It stays on record but no longer shows in the list. */
  @Roles(...OFFICE_ROLES)
  @Post('roster/templates/:id/archive')
  @HttpCode(200)
  async archive(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(`update roster_templates set archived_at = now() where id = $1 and archived_at is null`, [id]);
      if (!r.rowCount) throw new NotFoundException('Template not found');
      return { archived: true };
    });
  }

  /**
   * Adds a template's shifts to a week at the template's site. `people` (default on) puts each shift's
   * usual person on it where they're eligible that day; the rest stay open with the reason. `equipment`
   * (default on) books the usual equipment again where it can be.
   */
  @Roles(...OFFICE_ROLES)
  @Post('roster/templates/:id/apply')
  @HttpCode(200)
  apply(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const weekStart = weekField(body, 'weekStart')!;
    const people = bool(body, 'people') ?? true;
    const equipment = bool(body, 'equipment') ?? true;
    const addToExisting = bool(body, 'addToExisting') ?? false;
    return this.tx(t, auth, async db => {
      const tpl = (await db.query<{ facility_id: string }>(`select facility_id from roster_templates where id = $1 and archived_at is null`, [id])).rows[0];
      if (!tpl) throw new NotFoundException('Template not found');
      const f = await site(db, tpl.facility_id);
      await checkTarget(db, f, weekStart, addToExisting);
      const slots = (await db.query<Slot>(
        `select weekday, to_char(start_time, 'HH24:MI') as "startTime", to_char(end_time, 'HH24:MI') as "endTime", break_minutes as "breakMinutes",
                area_id as "areaId", shift_code_id as "shiftCodeId", role, needs_person as "needsPerson", worker_id as "workerId", notes,
                gender_requested as "genderRequested",
                coalesce((select json_agg(te.equipment_id) from roster_template_equipment te where te.template_shift_id = ts.id), '[]'::json) as "equipmentIds",
                coalesce((select json_agg(td.duty_id) from roster_template_duties td where td.template_shift_id = ts.id), '[]'::json) as "dutyIds"
           from roster_template_shifts ts where template_id = $1`, [id])).rows;
      const r = await createFromSlots(db, t.tenantId, auth, f, weekStart, slots, people, equipment);
      return { ...r, weekStart, facilityId: f.id, summary: applySummary(r, await wordsFor(db)) };
    });
  }

  /** Copies a site's week (by default the one before) into another week, with the same people where they're eligible. */
  @Roles(...OFFICE_ROLES)
  @Post('roster/copy-week')
  @HttpCode(200)
  copyWeek(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const facilityId = siteField(body);
    const toWeek = weekField(body, 'toWeek')!;
    const fromWeek = weekField(body, 'fromWeek', false) ?? addDays(toWeek, -7);
    if (fromWeek === toWeek) throw new BadRequestException('Choose a different week to copy from');
    const people = bool(body, 'people') ?? true;
    const equipment = bool(body, 'equipment') ?? true;
    const addToExisting = bool(body, 'addToExisting') ?? false;
    return this.tx(t, auth, async db => {
      const f = await site(db, facilityId);
      await checkTarget(db, f, toWeek, addToExisting);
      const slots = await slotsFromWeek(db, facilityId, fromWeek);
      if (!slots.length) throw new BadRequestException(`There are no ${(await wordsFor(db)).lower(T.shift, true)} at ${f.name} in the week of ${fromWeek} to copy`);
      const r = await createFromSlots(db, t.tenantId, auth, f, toWeek, slots, people, equipment);
      return { ...r, fromWeek, weekStart: toWeek, facilityId: f.id, summary: applySummary(r, await wordsFor(db)) };
    });
  }

  /**
   * Copies a run of weeks (for example a month: the four or five weeks starting in it) into the same number of
   * weeks starting `toWeek` (by default straight after them). Same rules as copying one week, all or nothing:
   * every week copied into must not be over and (unless `addToExisting`) must have no shifts yet. Source weeks
   * with no shifts are skipped and named in the result.
   */
  @Roles(...OFFICE_ROLES)
  @Post('roster/copy-weeks')
  @HttpCode(200)
  copyWeeks(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const facilityId = siteField(body);
    const fromWeek = weekField(body, 'fromWeek')!;
    const weeks = int(body, 'weeks', 1, MAX_COPY_WEEKS) ?? 4;
    const toWeek = weekField(body, 'toWeek', false) ?? addDays(fromWeek, 7 * weeks);
    const plan = weekPairs(fromWeek, weeks, toWeek);
    if ('error' in plan) throw new BadRequestException(plan.error);
    const people = bool(body, 'people') ?? true;
    const equipment = bool(body, 'equipment') ?? true;
    const addToExisting = bool(body, 'addToExisting') ?? false;
    return this.tx(t, auth, async db => {
      const f = await site(db, facilityId);
      // Check every week first, so a refusal part-way through never leaves half a month copied.
      for (const p of plan.pairs) await checkTarget(db, f, p.to, addToExisting);
      const sources = [];
      for (const p of plan.pairs) sources.push({ ...p, slots: await slotsFromWeek(db, facilityId, p.from) });
      const total = sources.reduce((n, s) => n + s.slots.length, 0);
      const w = await wordsFor(db);
      if (!total) throw new BadRequestException(`There are no ${w.lower(T.shift, true)} at ${f.name} in those weeks to copy`);
      if (total > MAX_COPY_SHIFTS) throw new BadRequestException(`That would add more than ${w.count(MAX_COPY_SHIFTS, T.shift)}. Copy fewer weeks at a time.`);
      const r: ApplyResult = { created: 0, assigned: 0, leftOpen: [], equipmentBooked: 0, equipmentLeftOff: [] };
      const done: Array<{ from: string; to: string; created: number; assigned: number }> = [];
      for (const s of sources) {
        if (!s.slots.length) { done.push({ from: s.from, to: s.to, created: 0, assigned: 0 }); continue; }
        const w = await createFromSlots(db, t.tenantId, auth, f, s.to, s.slots, people, equipment);
        r.created += w.created; r.assigned += w.assigned; r.equipmentBooked += w.equipmentBooked;
        r.leftOpen.push(...w.leftOpen); r.equipmentLeftOff.push(...w.equipmentLeftOff);
        done.push({ from: s.from, to: s.to, created: w.created, assigned: w.assigned });
      }
      const emptyWeeks = done.filter(w => !w.created).map(w => w.from);
      return { ...r, fromWeek, toWeek, facilityId: f.id, weeks: done, emptyWeeks, summary: copyWeeksSummary({ ...r, weeks: done, emptyWeeks }, w) };
    });
  }
}
