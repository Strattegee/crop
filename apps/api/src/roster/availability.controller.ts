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
import { LEAVE_KINDS, parseDays, parsePeriods } from './availability.js';
import {
  availabilityOf, clearDate, daysBetween, LEAVE_COLS, LEAVE_FROM, leaveById, listRange, recordLeave, rosteredDuring, saveDate, savePattern,
} from './availability-data.js';

async function requireWorker(db: PoolClient, workerId: string, lock = false) {
  if (!(await db.query(`select 1 from workers where id = $1${lock ? ' for update' : ''}`, [workerId])).rowCount) {
    throw new NotFoundException('Worker not found');
  }
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
      return availabilityOf(db, workerId, from, to);
    });
  }

  /**
   * Replaces the weekly pattern. `days`: [{ weekday: 1–7 (Monday = 1), periods: ['am', 'pm', 'night'] }];
   * an empty periods list means not that day; days left out mean nothing said. An empty `days` clears the pattern.
   */
  @Roles(...OFFICE_ROLES)
  @Put('availability/pattern')
  setPattern(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('workerId', ParseUUIDPipe) workerId: string, @Body() body: Record<string, unknown>) {
    const days = parseDays(body?.days);
    if (typeof days === 'string') throw new BadRequestException(days);
    return withTenant(this.pool, t.tenantId, async db => {
      await requireWorker(db, workerId, true);
      return savePattern(db, t.tenantId, workerId, days, auth.userId);
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
      return saveDate(db, t.tenantId, workerId, onDate, periods, note, auth.userId);
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
      await clearDate(db, workerId, onDate);
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
      return recordLeave(db, {
        tenantId: t.tenantId, workerId, kind, startsOn, endsOn, approved, note, userId: auth.userId,
        overlapMessage: 'This person already has leave on some of those days',
      });
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
