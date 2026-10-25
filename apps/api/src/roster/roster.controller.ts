import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, int, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { eligibilityForShift, rankCandidates } from './eligibility-data.js';
import { closePendingOffers } from './offers-data.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'casual', 'bank'] as const;
const MAX_SHIFTS_PER_REQUEST = 400;
const MAX_RANGE_DAYS = 92;

function time(body: Record<string, unknown>, key: string, label: string): string | null {
  const v = text(body, key, { max: 5 });
  if (v === null) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new BadRequestException(`${label} must be a time like 07:00`);
  return v;
}

function uuidField(body: Record<string, unknown>, key: string, label: string, required = false): string | null {
  const v = text(body, key, { max: 40, required });
  if (v === null) return null;
  if (!UUID.test(v)) throw new BadRequestException(`Choose a ${label}`);
  return v;
}

function hours(body: Record<string, unknown>, key: string): number | null {
  const v = body?.[key];
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 80) throw new BadRequestException('Contracted hours must be a number from 0 to 80');
  return Math.round(n * 100) / 100;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

function range(q: { from?: string; to?: string }) {
  const from = date({ startDate: q.from }, 'startDate', { required: true })!;
  const to = date({ endDate: q.to }, 'endDate', { required: true })!;
  if (to < from) throw new BadRequestException('The end date is before the start date');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException(`Choose ${MAX_RANGE_DAYS} days or fewer`);
  return { from, to };
}

const SHIFT_COLS = `s.id, s.facility_id as "facilityId", f.name as "facilityName", s.area_id as "areaId", a.name as "areaName",
  s.shift_code_id as "shiftCodeId", sc.code as "shiftCode", s.role, s.status, not s.needs_person as "equipmentOnly", s.notes, s.cancelled_reason as "cancelledReason",
  s.starts_at as "startsAt", s.ends_at as "endsAt", s.break_minutes as "breakMinutes", f.timezone,
  to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
  to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
  to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
  round((extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::numeric, 2)::float8 as hours,
  sa.worker_id as "workerId", case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName",
  sa.status as "assignmentStatus",
  coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name, 'typeName', et.name) order by e.name)
              from shift_assignments ea join equipment e on e.id = ea.equipment_id join equipment_types et on et.id = e.equipment_type_id
             where ea.shift_id = s.id and ea.resource_kind = 'equipment' and ea.status in ('assigned', 'confirmed')), '[]'::json) as equipment`;
const SHIFT_FROM = `shifts s join facilities f on f.id = s.facility_id
  left join areas a on a.id = s.area_id left join shift_codes sc on sc.id = s.shift_code_id
  left join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
  left join workers w on w.id = sa.worker_id`;

export async function shiftById(db: PoolClient, id: string) {
  const s = (await db.query(`select ${SHIFT_COLS} from ${SHIFT_FROM} where s.id = $1`, [id])).rows[0];
  if (!s) throw new NotFoundException('Shift not found');
  return s;
}

/** Shift codes: named start and finish times, for the whole business or one site. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('shift-codes')
export class ShiftCodesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('facilityId') facilityId?: string) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select sc.id, sc.facility_id as "facilityId", f.name as "facilityName", sc.code, sc.name,
              to_char(sc.start_time, 'HH24:MI') as "startTime", to_char(sc.end_time, 'HH24:MI') as "endTime",
              sc.break_minutes as "breakMinutes", sc.active
         from shift_codes sc left join facilities f on f.id = sc.facility_id
        where ($1::uuid is null or sc.facility_id is null or sc.facility_id = $1)
        order by sc.active desc, sc.start_time, sc.code`,
      [facilityId && UUID.test(facilityId) ? facilityId : null],
    )).rows);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const code = text(body, 'code', { required: true, max: 12 })!;
    const startTime = time(body, 'startTime', 'Start time');
    const endTime = time(body, 'endTime', 'End time');
    if (!startTime || !endTime) throw new BadRequestException('Start and end times are required');
    if (startTime === endTime) throw new BadRequestException('Start and end times must be different');
    const facilityId = uuidField(body, 'facilityId', 'site');
    const breakMinutes = int(body, 'breakMinutes', 0, 240) ?? 0;
    return withTenant(this.pool, t.tenantId, async db => {
      if (facilityId && !(await db.query('select 1 from facilities where id = $1', [facilityId])).rowCount) throw new BadRequestException('Choose a site');
      try {
        return (await db.query(
          `insert into shift_codes(tenant_id, facility_id, code, name, start_time, end_time, break_minutes)
           values ($1,$2,$3,$4,$5,$6,$7)
           returning id, facility_id as "facilityId", code, name, to_char(start_time, 'HH24:MI') as "startTime",
                     to_char(end_time, 'HH24:MI') as "endTime", break_minutes as "breakMinutes", active`,
          [t.tenantId, facilityId, code, text(body, 'name', { max: 60 }), startTime, endTime, breakMinutes],
        )).rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new BadRequestException(`There is already a shift code ${code}`);
        throw e;
      }
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const active = bool(body, 'active');
    const name = text(body, 'name', { max: 60 });
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update shift_codes set active = coalesce($2, active), name = coalesce($3, name) where id = $1
         returning id, code, name, active`, [id, active, name]);
      if (!r.rowCount) throw new NotFoundException('Shift code not found');
      return r.rows[0];
    });
  }
}

/** Employment terms per worker, effective-dated (full-time, part-time, casual, bank; contracted hours). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('workers/:workerId/employment')
export class EmploymentController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1', [workerId])).rowCount) throw new NotFoundException('Worker not found');
      return (await db.query(
        `select id, employment_type as "employmentType", contracted_hours::float8 as "contractedHours",
                to_char(starts_on, 'YYYY-MM-DD') as "startsOn", to_char(ends_on, 'YYYY-MM-DD') as "endsOn"
           from employment_terms where worker_id = $1 order by starts_on desc`, [workerId])).rows;
    });
  }

  /** Starts new terms from a date; the current terms end the day before. */
  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const employmentType = oneOf(body, 'employmentType', EMPLOYMENT_TYPES, { required: true })!;
    const contractedHours = hours(body, 'contractedHours');
    const startsOn = date(body, 'startsOn', { required: true })!;
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1 for update', [workerId])).rowCount) throw new NotFoundException('Worker not found');
      if ((await db.query('select 1 from employment_terms where worker_id = $1 and starts_on >= $2', [workerId, startsOn])).rowCount) {
        throw new BadRequestException('Employment terms already start on or after that date');
      }
      await db.query(
        `update employment_terms set ends_on = $2::date - 1 where worker_id = $1 and (ends_on is null or ends_on >= $2)`,
        [workerId, startsOn]);
      return (await db.query(
        `insert into employment_terms(tenant_id, worker_id, employment_type, contracted_hours, starts_on, created_by)
         values ($1,$2,$3,$4,$5,$6)
         returning id, employment_type as "employmentType", contracted_hours::float8 as "contractedHours",
                   to_char(starts_on, 'YYYY-MM-DD') as "startsOn", to_char(ends_on, 'YYYY-MM-DD') as "endsOn"`,
        [t.tenantId, workerId, employmentType, contractedHours, startsOn, auth.userId],
      )).rows[0];
    });
  }
}

/** Shifts on the roster and who fills them (ROS-). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class ShiftsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Creates one shift, or a block across dates and weekdays; `quantity` shifts per day (one position each). */
  @Roles(...OFFICE_ROLES)
  @Post('shifts')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const facilityId = uuidField(body, 'facilityId', 'site', true)!;
    const areaId = uuidField(body, 'areaId', 'area');
    const shiftCodeId = uuidField(body, 'shiftCodeId', 'shift code');
    // Equipment only: booked without a person (e.g. dry hire, where the client supplies the operator).
    const equipmentOnly = bool(body, 'equipmentOnly') ?? false;
    const role = text(body, 'role', { required: !equipmentOnly, max: 60 }) ?? 'Equipment only';
    const notes = text(body, 'notes', { max: 1000 });
    const quantity = int(body, 'quantity', 1, 20) ?? 1;
    const single = date(body, 'date');
    const startDate = single ?? date(body, 'startDate', { required: true })!;
    const endDate = single ?? date(body, 'endDate', { required: true })!;
    if (endDate < startDate) throw new BadRequestException('The end date is before the start date');
    if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) throw new BadRequestException(`Choose ${MAX_RANGE_DAYS} days or fewer`);
    const weekdaysRaw = body?.weekdays;
    let weekdays: number[] | null = null;
    if (weekdaysRaw !== undefined && weekdaysRaw !== null) {
      if (!Array.isArray(weekdaysRaw) || weekdaysRaw.some(d => !Number.isInteger(d) || d < 1 || d > 7)) {
        throw new BadRequestException('Days must be a list of weekdays, 1 (Monday) to 7 (Sunday)');
      }
      weekdays = [...new Set(weekdaysRaw as number[])];
    }
    const dates: string[] = [];
    for (let d = startDate; d <= endDate; d = addDays(d, 1)) if (!weekdays || weekdays.includes(isoWeekday(d))) dates.push(d);
    if (!dates.length) throw new BadRequestException('No dates match the days chosen');
    if (dates.length * quantity > MAX_SHIFTS_PER_REQUEST) throw new BadRequestException(`That would create more than ${MAX_SHIFTS_PER_REQUEST} shifts`);

    return withTenant(this.pool, t.tenantId, async db => {
      const facility = (await db.query<{ timezone: string }>('select timezone from facilities where id = $1', [facilityId])).rows[0];
      if (!facility) throw new BadRequestException('Choose a site');
      if (areaId && !(await db.query('select 1 from areas where id = $1 and facility_id = $2', [areaId, facilityId])).rowCount) {
        throw new BadRequestException('Choose an area at this site');
      }
      let startTime = time(body, 'startTime', 'Start time');
      let endTime = time(body, 'endTime', 'End time');
      let breakMinutes = int(body, 'breakMinutes', 0, 240);
      if (shiftCodeId) {
        const sc = (await db.query<{ start: string; end: string; brk: number }>(
          `select to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end, break_minutes as brk
             from shift_codes where id = $1 and active and (facility_id is null or facility_id = $2)`, [shiftCodeId, facilityId])).rows[0];
        if (!sc) throw new BadRequestException('Choose a shift code for this site');
        startTime ??= sc.start; endTime ??= sc.end; breakMinutes ??= sc.brk;
      }
      if (!startTime || !endTime) throw new BadRequestException('Choose a shift code, or enter start and end times');
      if (startTime === endTime) throw new BadRequestException('Start and end times must be different');
      const overnight = endTime < startTime;
      const ids = (await db.query<{ id: string }>(
        `insert into shifts(tenant_id, facility_id, area_id, shift_code_id, role, starts_at, ends_at, break_minutes, notes, created_by, needs_person)
         select $1, $2, $3, $4, $5,
                (d + $7::time) at time zone $6,
                (d + $9::int + $8::time) at time zone $6,
                $10, $11, $12, $15
           from unnest($13::date[]) d, generate_series(1, $14::int)
         returning id`,
        [t.tenantId, facilityId, areaId, shiftCodeId, role, facility.timezone, startTime, endTime, overnight ? 1 : 0,
          breakMinutes ?? 0, notes, auth.userId, dates, quantity, !equipmentOnly],
      )).rows.map(r => r.id);
      return { created: ids.length, ids };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('shifts')
  list(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const { from, to } = range(q);
    const facilityId = q.facilityId && UUID.test(q.facilityId) ? q.facilityId : null;
    const status = q.status ? oneOf({ status: q.status }, 'status', ['open', 'assigned', 'booked', 'cancelled'] as const) : null;
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${SHIFT_COLS} from ${SHIFT_FROM}
        where (s.starts_at at time zone f.timezone)::date between $1 and $2
          and ($3::uuid is null or s.facility_id = $3) and ($4::shift_status is null or s.status = $4)
        order by s.starts_at, f.name, a.name nulls first, s.role, s.created_at`,
      [from, to, facilityId, status],
    )).rows);
  }

  /** The roster for a period: shifts plus each active worker's terms and hours rostered. */
  @Roles(...OFFICE_ROLES)
  @Get('roster')
  roster(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const { from, to } = range(q);
    const facilityId = q.facilityId && UUID.test(q.facilityId) ? q.facilityId : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const shifts = (await db.query(
        `select ${SHIFT_COLS} from ${SHIFT_FROM}
          where (s.starts_at at time zone f.timezone)::date between $1 and $2 and ($3::uuid is null or s.facility_id = $3)
            and s.status <> 'cancelled'
          order by s.starts_at, f.name, a.name nulls first, s.role`, [from, to, facilityId])).rows;
      const people = (await db.query(
        `select w.id, coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name, w.roles,
                et.employment_type as "employmentType", et.contracted_hours::float8 as "contractedHours",
                coalesce((select round(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600 - s.break_minutes / 60.0)::numeric, 2)
                            from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
                           where sa.worker_id = w.id and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
                             and (s.starts_at at time zone f.timezone)::date between $1 and $2), 0)::float8 as "rosteredHours"
           from workers w
           left join lateral (select employment_type, contracted_hours from employment_terms e
                               where e.worker_id = w.id and e.starts_on <= $1 and (e.ends_on is null or e.ends_on >= $1)
                               order by e.starts_on desc limit 1) et on true
          where w.status = 'active'
          order by w.last_name, w.first_name`, [from, to])).rows;
      // Equipment rows on the roster (backlog item 4): everything not retired, with hours booked in the period.
      const equipment = (await db.query(
        `select e.id, e.name, et.name as "typeName", e.status, e.home_facility_id as "homeFacilityId",
                coalesce((select round(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600)::numeric, 2)
                            from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
                           where sa.equipment_id = e.id and sa.resource_kind = 'equipment' and sa.status in ('assigned', 'confirmed')
                             and s.status <> 'cancelled' and (s.starts_at at time zone f.timezone)::date between $1 and $2
                             and ($3::uuid is null or s.facility_id = $3)), 0)::float8 as "bookedHours"
           from equipment e join equipment_types et on et.id = e.equipment_type_id
          where e.status <> 'retired'
          order by et.name, e.name`, [from, to, facilityId])).rows;
      return { from, to, shifts, people, equipment };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, db => shiftById(db, id));
  }

  @Roles(...OFFICE_ROLES)
  @Patch('shifts/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const notes = text(body, 'notes', { max: 1000 });
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('update shifts set notes = $2, updated_at = now() where id = $1', [id, notes])).rowCount) throw new NotFoundException('Shift not found');
      return shiftById(db, id);
    });
  }

  /** Who could work this shift: everyone active, ready first, with the reasons anyone can't (backlog item 3). */
  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/candidates')
  candidates(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const shift = await shiftById(db, id);
      if (shift.equipmentOnly) return { shift, candidates: [] }; // nobody goes on an equipment-only shift
      return { shift, candidates: rankCandidates(await eligibilityForShift(db, t.tenantId, id)) };
    });
  }

  /**
   * Puts a person on a shift. Hard blocks: wrong role, a hard credential rule or right to work not met on the
   * shift date, already rostered at an overlapping time, or over their visa's fortnightly hours. Warnings are returned.
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/assign')
  @HttpCode(200)
  assign(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const workerId = uuidField(body, 'workerId', 'person', true)!;
    return withTenant(this.pool, t.tenantId, async db => {
      const shift = (await db.query<{ status: string; needs_person: boolean }>('select status, needs_person from shifts where id = $1 for update', [id])).rows[0];
      if (!shift) throw new NotFoundException('Shift not found');
      if (shift.status === 'cancelled') throw new ConflictException('This shift is cancelled');
      if (!shift.needs_person) throw new ConflictException('This shift is for equipment only, so nobody can be put on it');
      if (shift.status !== 'open') throw new ConflictException('Someone is already on this shift. Remove them first.');
      // Locking the worker serialises assignments for one person, so two shifts can't be given to them at once.
      const worker = (await db.query<{ status: string; name: string }>(
        `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`,
        [workerId])).rows[0];
      if (!worker) throw new BadRequestException('Choose a person');
      if (worker.status !== 'active') throw new BadRequestException(`${worker.name} isn't active`);
      const [check] = await eligibilityForShift(db, t.tenantId, id, [workerId]);
      if (!check.eligible) throw new ConflictException(check.blocks.map(b => b.message).join('. '));
      await db.query(
        `insert into shift_assignments(tenant_id, shift_id, worker_id, assigned_by) values ($1,$2,$3,$4)`,
        [t.tenantId, id, workerId, auth.userId]);
      await db.query(`update shifts set status = 'assigned', updated_at = now() where id = $1`, [id]);
      await closePendingOffers(db, id, 'filled', auth.userId); // filled directly, so any bank-fill offers close
      return { ...(await shiftById(db, id)), warnings: check.warnings.map(w => w.message) };
    });
  }

  /** The person has confirmed (or the office books them directly). */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/confirm')
  @HttpCode(200)
  confirm(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update shift_assignments set status = 'confirmed' where shift_id = $1 and resource_kind = 'worker' and status = 'assigned'`, [id]);
      if (!r.rowCount) throw new ConflictException('There is nobody waiting to confirm on this shift');
      await db.query(`update shifts set status = 'booked', updated_at = now() where id = $1`, [id]);
      return shiftById(db, id);
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/unassign')
  @HttpCode(200)
  unassign(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update shift_assignments set status = 'removed', ended_at = now()
          where shift_id = $1 and resource_kind = 'worker' and status in ('assigned', 'confirmed')`, [id]);
      if (!r.rowCount) throw new ConflictException('Nobody is on this shift');
      await db.query(`update shifts set status = 'open', updated_at = now() where id = $1 and status <> 'cancelled'`, [id]);
      return shiftById(db, id);
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/cancel')
  @HttpCode(200)
  cancel(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { required: true, max: 300 })!;
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update shifts set status = 'cancelled', cancelled_reason = $2, updated_at = now() where id = $1 and status <> 'cancelled'`, [id, reason]);
      if (!r.rowCount) {
        if (!(await db.query('select 1 from shifts where id = $1', [id])).rowCount) throw new NotFoundException('Shift not found');
        throw new ConflictException('This shift is already cancelled');
      }
      await db.query(
        `update shift_assignments set status = 'removed', ended_at = now() where shift_id = $1 and status in ('assigned', 'confirmed')`, [id]);
      await closePendingOffers(db, id, 'withdrawn', auth.userId);
      return shiftById(db, id);
    });
  }
}
