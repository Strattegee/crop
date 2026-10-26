import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { eligibilityForShift } from './eligibility-data.js';
import { actorOf, mondayOf, weekState } from './publishing.js';
import { applySummary, firstReason, planWeek, type ApplyResult, type LeftOpen, type Slot } from './templates.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SHIFTS = 400;

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
            s.needs_person as "needsPerson", sa.worker_id as "workerId", s.notes
       from shifts s join facilities f on f.id = s.facility_id
       left join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
      where s.facility_id = $1 and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2 and $2::date + 6
      order by s.starts_at, s.role`, [facilityId, weekStart])).rows;
}

/** Refuses a week that is over, and (unless asked) a week that already has shifts, so nothing is doubled by mistake. */
async function checkTarget(db: PoolClient, f: { id: string; name: string; timezone: string }, weekStart: string, addToExisting: boolean) {
  if (weekState(weekStart, false, todayIn(f.timezone)) === 'history') throw new ConflictException('That week is over, so shifts can no longer be added to it');
  if (addToExisting) return;
  const n = (await db.query<{ n: number }>(
    `select count(*)::int as n from shifts s join facilities f on f.id = s.facility_id
      where s.facility_id = $1 and s.status <> 'cancelled' and (s.starts_at at time zone f.timezone)::date between $2 and $2::date + 6`,
    [f.id, weekStart])).rows[0].n;
  if (n > 0) {
    throw new ConflictException(`The week of ${weekStart} already has ${n} ${n === 1 ? 'shift' : 'shifts'} at ${f.name}. Choose "Add to the shifts already there" to add these as well.`);
  }
}

/**
 * Creates the week's shifts from slots and, when `people` is on, puts each slot's usual person on it
 * (assigned, waiting for them to confirm) wherever eligibility allows; otherwise the shift stays open.
 */
async function createFromSlots(
  db: PoolClient, tenantId: string, auth: AuthContext, f: { id: string; timezone: string }, weekStart: string, slots: Slot[], people: boolean,
): Promise<ApplyResult> {
  if (slots.length > MAX_SHIFTS) throw new BadRequestException(`That would add more than ${MAX_SHIFTS} shifts`);
  const result: ApplyResult = { created: 0, assigned: 0, leftOpen: [] };
  for (const p of planWeek(slots, weekStart)) {
    const id = (await db.query<{ id: string }>(
      `insert into shifts(tenant_id, facility_id, area_id, shift_code_id, role, starts_at, ends_at, break_minutes, notes, created_by, needs_person)
       values ($1, $2, $3, $4, $5, ($6::date + $7::time) at time zone $8, ($6::date + $9::int + $10::time) at time zone $8, $11, $12, $13, $14)
       returning id`,
      [tenantId, f.id, p.areaId, p.shiftCodeId, p.role, p.date, p.startTime, f.timezone, p.overnight ? 1 : 0, p.endTime,
        p.breakMinutes, p.notes, auth.userId, p.needsPerson])).rows[0].id;
    result.created++;
    if (!people || !p.workerId || !p.needsPerson) continue;
    // Lock the person (as assigning does) so nothing else rosters them at the same time.
    const w = (await db.query<{ status: string; name: string }>(
      `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`, [p.workerId])).rows[0];
    if (!w) continue;
    const open = (reason: string): LeftOpen => ({ date: p.date, startTime: p.startTime, role: p.role, workerName: w.name, reason });
    if (w.status !== 'active') { result.leftOpen.push(open(`${w.name} isn't active`)); continue; }
    const [check] = await eligibilityForShift(db, tenantId, id, [p.workerId]);
    if (!check?.eligible) { result.leftOpen.push(open(firstReason(check?.blocks ?? []))); continue; }
    await db.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, assigned_by) values ($1, $2, $3, $4)`, [tenantId, id, p.workerId, auth.userId]);
    await db.query(`update shifts set status = 'assigned', updated_at = now() where id = $1`, [id]);
    result.assigned++;
  }
  return result;
}

const TEMPLATE_COLS = `t.id, t.facility_id as "facilityId", f.name as "facilityName", t.name, t.created_at as "createdAt",
  t.created_by_name as "createdByName",
  (select count(*)::int from roster_template_shifts ts where ts.template_id = t.id) as shifts,
  (select count(*)::int from roster_template_shifts ts where ts.template_id = t.id and ts.worker_id is not null) as "withPeople"`;

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
                case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName"
           from roster_template_shifts ts left join areas a on a.id = ts.area_id left join shift_codes sc on sc.id = ts.shift_code_id
           left join workers w on w.id = ts.worker_id
          where ts.template_id = $1 order by ts.weekday, ts.start_time, ts.role`, [id])).rows;
      return { ...tpl, shiftList: shifts };
    });
  }

  /** Saves a site's week as a template. `people: false` leaves out who works each shift. */
  @Roles(...OFFICE_ROLES)
  @Post('roster/templates')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const facilityId = siteField(body);
    const weekStart = weekField(body, 'weekStart')!;
    const name = text(body, 'name', { required: true, max: 80 })!;
    const people = bool(body, 'people') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      await site(db, facilityId);
      const slots = await slotsFromWeek(db, facilityId, weekStart);
      if (!slots.length) throw new BadRequestException('There are no shifts at this site that week to save');
      if (slots.length > MAX_SHIFTS) throw new BadRequestException(`A template can hold up to ${MAX_SHIFTS} shifts`);
      let id: string;
      try {
        id = (await db.query<{ id: string }>(
          `insert into roster_templates(tenant_id, facility_id, name, created_by, created_by_name) values ($1, $2, $3, $4, $5) returning id`,
          [t.tenantId, facilityId, name, auth.userId, actorOf(auth).name])).rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException(`There is already a template called ${name} for this site`);
        throw e;
      }
      await db.query(
        `insert into roster_template_shifts(tenant_id, template_id, weekday, start_time, end_time, break_minutes, area_id, shift_code_id, role, needs_person, worker_id, notes)
         select $1, $2, x.weekday, x."startTime"::time, x."endTime"::time, x."breakMinutes", x."areaId", x."shiftCodeId", x.role, x."needsPerson",
                case when $4 and x."needsPerson" then x."workerId" end, x.notes
           from json_to_recordset($3::json) as x(weekday int, "startTime" text, "endTime" text, "breakMinutes" int, "areaId" uuid,
                "shiftCodeId" uuid, role text, "needsPerson" boolean, "workerId" uuid, notes text)`,
        [t.tenantId, id, JSON.stringify(slots), people]);
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
   * usual person on it where they're eligible that day; the rest stay open with the reason.
   */
  @Roles(...OFFICE_ROLES)
  @Post('roster/templates/:id/apply')
  @HttpCode(200)
  apply(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const weekStart = weekField(body, 'weekStart')!;
    const people = bool(body, 'people') ?? true;
    const addToExisting = bool(body, 'addToExisting') ?? false;
    return this.tx(t, auth, async db => {
      const tpl = (await db.query<{ facility_id: string }>(`select facility_id from roster_templates where id = $1 and archived_at is null`, [id])).rows[0];
      if (!tpl) throw new NotFoundException('Template not found');
      const f = await site(db, tpl.facility_id);
      await checkTarget(db, f, weekStart, addToExisting);
      const slots = (await db.query<Slot>(
        `select weekday, to_char(start_time, 'HH24:MI') as "startTime", to_char(end_time, 'HH24:MI') as "endTime", break_minutes as "breakMinutes",
                area_id as "areaId", shift_code_id as "shiftCodeId", role, needs_person as "needsPerson", worker_id as "workerId", notes
           from roster_template_shifts where template_id = $1`, [id])).rows;
      const r = await createFromSlots(db, t.tenantId, auth, f, weekStart, slots, people);
      return { ...r, weekStart, facilityId: f.id, summary: applySummary(r) };
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
    const addToExisting = bool(body, 'addToExisting') ?? false;
    return this.tx(t, auth, async db => {
      const f = await site(db, facilityId);
      await checkTarget(db, f, toWeek, addToExisting);
      const slots = await slotsFromWeek(db, facilityId, fromWeek);
      if (!slots.length) throw new BadRequestException(`There are no shifts at ${f.name} in the week of ${fromWeek} to copy`);
      const r = await createFromSlots(db, t.tenantId, auth, f, toWeek, slots, people);
      return { ...r, fromWeek, weekStart: toWeek, facilityId: f.id, summary: applySummary(r) };
    });
  }
}
