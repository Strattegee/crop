import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext, Membership } from '../auth/auth.types.js';
import { Auth, Tenant } from '../auth/decorators.js';
import { date, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { LEAVE_KINDS, parseDays, parsePeriods } from '../roster/availability.js';
import { availabilityOf, clearDate, leaveById, recordLeave, saveDate, savePattern } from '../roster/availability-data.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { requireLinked } from './worker-app.controller.js';
import { tellOffice } from './tell-office.js';
import { appLeaveEmail, myDateRefusal, myLeaveCancelRefusal, myLeaveRefusal } from './worker-app.js';
import { wordsFor } from '../terms/words.js';

const today = async (db: PoolClient, tenantId: string) => todayIn((await loadSettings(db, tenantId)).timezone);

/** Leave as the app shows it: the person's own, so no name. */
const mine = ({ workerId: _w, workerName: _n, ...l }: Record<string, unknown>) => l;

/**
 * The worker app's availability and leave (backlog items 9 and 10): the signed-in person's usual week, changes for
 * particular dates, and asking for leave. Leave asked for here is always a request; owners and admins decide it on
 * the Leave page. Same rules and tables as the office's availability card.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('my')
export class MyAvailabilityController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Usual week, date changes from today for 90 days, and leave from today on (today and the next 365 days). */
  @Get('availability')
  get(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const from = await today(db, t.tenantId);
      const a = await availabilityOf(db, w.id, from, addDays(from, 90));
      const leave = (await availabilityOf(db, w.id, from, addDays(from, 365))).leave
        .filter(l => l.status === 'requested' || l.status === 'approved' || l.status === 'declined');
      return { today: from, pattern: a.pattern, dates: a.dates, leave: leave.map(mine) };
    });
  }

  /** Replaces the person's usual week. Same body as the office's `PUT /workers/:id/availability/pattern`. */
  @Put('availability/pattern')
  setPattern(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const days = parseDays(body?.days);
    if (typeof days === 'string') throw new BadRequestException(days);
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      await db.query('select 1 from workers where id = $1 for update', [w.id]);
      return savePattern(db, t.tenantId, w.id, days, auth.userId);
    });
  }

  /** The person's availability for one date (today or later), replacing their usual week that day. */
  @Put('availability/dates/:date')
  setDate(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('date') onDateRaw: string, @Body() body: Record<string, unknown>) {
    const onDate = date({ date: onDateRaw }, 'date', { required: true })!;
    const periods = parsePeriods(body?.periods);
    if (!periods) throw new BadRequestException('Times of day must be a list of am, pm and night');
    const note = text(body, 'note', { max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const refusal = myDateRefusal(onDate, await today(db, t.tenantId));
      if (refusal) throw new BadRequestException(refusal);
      return saveDate(db, t.tenantId, w.id, onDate, periods, note, auth.userId);
    });
  }

  /** Removes a date change (today or later), so the usual week applies again that day. */
  @Delete('availability/dates/:date')
  @HttpCode(204)
  async clearDate(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('date') onDateRaw: string) {
    const onDate = date({ date: onDateRaw }, 'date', { required: true })!;
    await withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const refusal = myDateRefusal(onDate, await today(db, t.tenantId));
      if (refusal) throw new BadRequestException(refusal);
      await clearDate(db, w.id, onDate);
    });
  }

  /** Asks for leave (whole days, starting today or later). Always a request, for an owner or admin to decide. */
  @Post('leave')
  askLeave(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const kind = oneOf(body, 'kind', LEAVE_KINDS, { required: true })!;
    const startsOn = date(body, 'startsOn', { required: true })!;
    const endsOn = date(body, 'endsOn', { required: true })!;
    const note = text(body, 'note', { max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const refusal = myLeaveRefusal(startsOn, endsOn, await today(db, t.tenantId));
      if (refusal) throw new BadRequestException(refusal);
      await db.query('select 1 from workers where id = $1 for update', [w.id]);
      const { rostered, ...leave } = await recordLeave(db, {
        tenantId: t.tenantId, workerId: w.id, kind, startsOn, endsOn, approved: false, note, userId: auth.userId,
        overlapMessage: 'You already have leave on some of those days',
      });
      // Owners and admins decide it, so they hear about it straight away (never the kind or the note).
      const m = appLeaveEmail({ name: w.name, workerId: w.id, startsOn, endsOn, shiftsDuring: rostered.length }, process.env.APP_URL ?? '', await wordsFor(db));
      await tellOffice(db, t.tenantId, { ...m, template: 'app_leave_request', dedupeKey: `app-leave:${leave.id}`, createdBy: auth.userId, exceptEmail: auth.email });
      // Only how many: the shifts themselves may be in weeks not yet published.
      return { ...mine(leave), shiftsDuring: rostered.length };
    });
  }

  /** Withdraws the person's own leave request while it is still waiting for a decision. */
  @Post('leave/:id/cancel')
  @HttpCode(200)
  cancelLeave(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const cur = (await db.query<{ status: string }>(
        'select status from leave_records where id = $1 and worker_id = $2 for update', [id, w.id])).rows[0];
      if (!cur) throw new NotFoundException('Leave not found');
      const refusal = myLeaveCancelRefusal(cur.status);
      if (refusal) throw new ConflictException(refusal);
      await db.query(`update leave_records set status = 'cancelled', decided_by = $2, decided_at = now() where id = $1`, [id, auth.userId]);
      return mine(await leaveById(db, id));
    });
  }
}
