import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { LEAVE_KINDS, parsePeriods } from './availability.js';

const MAX_RANGE_DAYS = 366;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

async function requireWorker(db: PoolClient, workerId: string, lock = false) {
  if (!(await db.query(`select 1 from workers where id = $1${lock ? ' for update' : ''}`, [workerId])).rowCount) {
    throw new NotFoundException('Worker not found');
  }
}

/** From and to dates for a list, defaulting to today (business time) and the next 90 days. */
async function listRange(db: PoolClient, tenantId: string, q: { from?: string; to?: string }) {
  const from = date({ startDate: q.from }, 'startDate') ?? todayIn((await loadSettings(db, tenantId)).timezone);
  const to = date({ endDate: q.to }, 'endDate') ?? addDays(from, 90);
  if (to < from) throw new BadRequestException('The end date is before the start date');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BadRequestException(`Choose ${MAX_RANGE_DAYS} days or fewer`);
  return { from, to };
}

const LEAVE_COLS = `l.id, l.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName",
  l.kind, to_char(l.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(l.ends_on, 'YYYY-MM-DD') as "endsOn",
  (l.ends_on - l.starts_on + 1) as days, l.status, l.note, l.created_at as "createdAt", l.decided_at as "decidedAt"`;
const LEAVE_FROM = 'leave_records l join workers w on w.id = l.worker_id';

async function leaveById(db: PoolClient, id: string) {
  const r = (await db.query(`select ${LEAVE_COLS} from ${LEAVE_FROM} where l.id = $1`, [id])).rows[0];
  if (!r) throw new NotFoundException('Leave not found');
  return r;
}

/** Shifts the person is on (not cancelled) during the leave, so the office can find cover. */
async function rosteredDuring(db: PoolClient, workerId: string, startsOn: string, endsOn: string) {
  return (await db.query(
    `select s.id, s.role, f.name as "facilityName", to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
            s.status
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.worker_id = $1 and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and (s.starts_at at time zone f.timezone)::date between $2 and $3
      order by s.starts_at`, [workerId, startsOn, endsOn])).rows;
}

/**
 * When someone can work (backlog item 10): a usual weekly pattern by day and AM / PM / night, and changes for
 * particular dates. Not being available is a warning when rostering.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('workers/:workerId')
export class AvailabilityController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Weekly pattern, date entries and leave from `from` to `to` (default: today and the next 90 days). */
  @Roles(...OFFICE_ROLES)
  @Get('availability')
  get(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string, @Query() q: Record<string, string>) {
    return withTenant(this.pool, t.tenantId, async db => {
      await requireWorker(db, workerId);
      const { from, to } = await listRange(db, t.tenantId, q);
      const pattern = (await db.query(
        'select weekday, periods from availability_patterns where worker_id = $1 order by weekday', [workerId])).rows;
      const dates = (await db.query(
        `select to_char(on_date, 'YYYY-MM-DD') as date, periods, note from availability_dates
          where worker_id = $1 and on_date between $2 and $3 order by on_date`, [workerId, from, to])).rows;
      const leave = (await db.query(
        `select ${LEAVE_COLS} from ${LEAVE_FROM} where l.worker_id = $1 and l.ends_on >= $2 and l.starts_on <= $3
          order by l.starts_on`, [workerId, from, to])).rows;
      return { from, to, pattern, dates, leave };
    });
  }

  /**
   * Replaces the weekly pattern. `days`: [{ weekday: 1–7 (Monday = 1), periods: ['am', 'pm', 'night'] }];
   * an empty periods list means not that day; days left out mean nothing said. An empty `days` clears the pattern.
   */
  @Roles(...OFFICE_ROLES)
  @Put('availability/pattern')
  setPattern(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const raw = body?.days;
    if (!Array.isArray(raw)) throw new BadRequestException('Days must be a list');
    const days = raw.map(d => {
      const weekday = (d as Record<string, unknown>)?.weekday;
      const periods = parsePeriods((d as Record<string, unknown>)?.periods);
      if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw new BadRequestException('Each day needs a weekday from 1 (Monday) to 7 (Sunday)');
      }
      if (!periods) throw new BadRequestException('Times of day must be a list of am, pm and night');
      return { weekday, periods };
    });
    if (new Set(days.map(d => d.weekday)).size !== days.length) throw new BadRequestException('Each weekday can only appear once');
    return withTenant(this.pool, t.tenantId, async db => {
      await requireWorker(db, workerId, true);
      await db.query('delete from availability_patterns where worker_id = $1', [workerId]);
      for (const d of days) {
        await db.query(
          `insert into availability_patterns(tenant_id, worker_id, weekday, periods, updated_by) values ($1,$2,$3,$4,$5)`,
          [t.tenantId, workerId, d.weekday, d.periods, auth.userId]);
      }
      return (await db.query('select weekday, periods from availability_patterns where worker_id = $1 order by weekday', [workerId])).rows;
    });
  }

  /** Availability for one date, replacing the weekly pattern that day. `periods: []` means not available at all. */
  @Roles(...OFFICE_ROLES)
  @Put('availability/dates/:date')
  setDate(
    @Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string,
    @Param('date') onDateRaw: string, @Body() body: Record<string, unknown>,
  ) {
    const onDate = date({ date: onDateRaw }, 'date', { required: true })!;
    const periods = parsePeriods(body?.periods);
    if (!periods) throw new BadRequestException('Times of day must be a list of am, pm and night');
    const note = text(body, 'note', { max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      await requireWorker(db, workerId);
      return (await db.query(
        `insert into availability_dates(tenant_id, worker_id, on_date, periods, note, updated_by) values ($1,$2,$3,$4,$5,$6)
         on conflict (worker_id, on_date) do update set periods = excluded.periods, note = excluded.note,
                     updated_by = excluded.updated_by, updated_at = now()
         returning to_char(on_date, 'YYYY-MM-DD') as date, periods, note`,
        [t.tenantId, workerId, onDate, periods, note, auth.userId])).rows[0];
    });
  }

  /** Removes a date entry, so the weekly pattern applies again that day. */
  @Roles(...OFFICE_ROLES)
  @Delete('availability/dates/:date')
  @HttpCode(204)
  async clearDate(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string, @Param('date') onDateRaw: string) {
    const onDate = date({ date: onDateRaw }, 'date', { required: true })!;
    await withTenant(this.pool, t.tenantId, async db => {
      await requireWorker(db, workerId);
      await db.query('delete from availability_dates where worker_id = $1 and on_date = $2', [workerId, onDate]);
    });
  }

  /**
   * Records leave (whole days). Owners and admins may record it as approved (the default for them); allocators
   * record a request. Returns any shifts the person is on in those days, so the office can find cover.
   */
  @Roles(...OFFICE_ROLES)
  @Post('leave')
  createLeave(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const kind = oneOf(body, 'kind', LEAVE_KINDS, { required: true })!;
    const startsOn = date(body, 'startsOn', { required: true })!;
    const endsOn = date(body, 'endsOn', { required: true })!;
    if (endsOn < startsOn) throw new BadRequestException('The leave ends before it starts');
    if (daysBetween(startsOn, endsOn) > 366) throw new BadRequestException('Leave can be at most a year at a time');
    const note = text(body, 'note', { max: 300 });
    const canApprove = t.role === 'owner' || t.role === 'admin';
    const approved = bool(body, 'approved') ?? canApprove;
    if (approved && !canApprove) throw new BadRequestException('Only an owner or admin can approve leave. Record it as a request.');
    return withTenant(this.pool, t.tenantId, async db => {
      await requireWorker(db, workerId, true);
      const overlap = (await db.query(
        `select 1 from leave_records where worker_id = $1 and status in ('requested', 'approved') and starts_on <= $3 and ends_on >= $2`,
        [workerId, startsOn, endsOn])).rowCount;
      if (overlap) throw new ConflictException('This person already has leave on some of those days');
      const id = (await db.query<{ id: string }>(
        `insert into leave_records(tenant_id, worker_id, kind, starts_on, ends_on, status, note, created_by, decided_by, decided_at)
         values ($1,$2,$3,$4,$5,$6::leave_status,$7,$8, case when $6::leave_status = 'approved' then $8::uuid end,
                 case when $6::leave_status = 'approved' then now() end)
         returning id`,
        [t.tenantId, workerId, kind, startsOn, endsOn, approved ? 'approved' : 'requested', note, auth.userId])).rows[0].id;
      return { ...(await leaveById(db, id)), rostered: await rosteredDuring(db, workerId, startsOn, endsOn) };
    });
  }
}

/** Leave across the business, and approving, declining or cancelling it (backlog item 10). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('leave')
export class LeaveController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Leave overlapping `from`–`to` (default: today and the next 90 days); `status` filters (default requested and approved). */
  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const status = q.status ? oneOf({ status: q.status }, 'status', ['requested', 'approved', 'declined', 'cancelled'] as const) : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const { from, to } = await listRange(db, t.tenantId, q);
      return (await db.query(
        `select ${LEAVE_COLS} from ${LEAVE_FROM}
          where l.ends_on >= $1 and l.starts_on <= $2
            and (case when $3::leave_status is null then l.status in ('requested', 'approved') else l.status = $3 end)
          order by l.starts_on, w.last_name, w.first_name`, [from, to, status])).rows;
    });
  }

  @Roles('owner', 'admin')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.decide(t, auth, id, 'approved', ['requested']);
  }

  @Roles('owner', 'admin')
  @Post(':id/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.decide(t, auth, id, 'declined', ['requested']);
  }

  /** Cancels a request or approved leave (the person is rostered as usual again). */
  @Roles('owner', 'admin')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.decide(t, auth, id, 'cancelled', ['requested', 'approved']);
  }

  private decide(t: Membership, auth: AuthContext, id: string, to: string, from: string[]) {
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = (await db.query<{ status: string; worker_id: string; starts_on: string; ends_on: string }>(
        `select status, worker_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
           from leave_records where id = $1 for update`, [id])).rows[0];
      if (!cur) throw new NotFoundException('Leave not found');
      if (!from.includes(cur.status)) throw new ConflictException(`This leave is already ${cur.status}`);
      await db.query('update leave_records set status = $2::leave_status, decided_by = $3, decided_at = now() where id = $1', [id, to, auth.userId]);
      const leave = await leaveById(db, id);
      return to === 'approved' ? { ...leave, rostered: await rosteredDuring(db, cur.worker_id, cur.starts_on, cur.ends_on) } : leave;
    });
  }
}
