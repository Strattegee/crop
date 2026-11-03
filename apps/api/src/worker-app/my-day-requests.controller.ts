import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import type { AuthContext, Membership } from '../auth/auth.types.js';
import { Auth, Tenant } from '../auth/decorators.js';
import { date, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { DAY_REQUEST_KINDS, myDayRequestRefusal, requestLine, type DayRequestKind } from '../roster/day-requests.js';
import { time } from '../roster/shift-create.js';
import { fillWords, wordsFor } from '../terms/words.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { requireLinked } from './worker-app.controller.js';

const MY_COLS = `id, to_char(on_date, 'YYYY-MM-DD') as date, kind, to_char(at_time, 'HH24:MI') as "atTime", note, status,
  created_at as "createdAt", decided_at as "decidedAt", decided_note as "decidedNote"`;
type MyRow = { id: string; date: string; kind: DayRequestKind; atTime: string | null; note: string | null; status: string };

/**
 * Requests for a day in the worker app (David, 3 Nov, answer 3; migration 0080): "AM shift please", "finish by 14:00",
 * or a short note, for a date from today to 90 days ahead. The office answers each done or not possible. The person
 * sees their own only; the office's note is shown back to them (it was written for them).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('my')
export class MyDayRequestsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** The person's requests from today on (and answered ones from the last 14 days), with `line`. */
  @Get('day-requests')
  list(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const today = todayIn((await loadSettings(db, t.tenantId)).timezone);
      const words = await wordsFor(db);
      const rows = (await db.query<MyRow>(
        `select ${MY_COLS} from day_requests where worker_id = $1 and on_date >= $2 and status <> 'withdrawn' order by on_date, created_at`,
        [w.id, addDays(today, -14)])).rows.filter(r => r.date >= today || r.status !== 'open');
      return { today, kinds: DAY_REQUEST_KINDS, requests: rows.map(r => ({ ...r, line: fillWords(requestLine(r), words) })) };
    });
  }

  /** Asks for something on a date: `kind` (prefer_am / prefer_pm / prefer_night / finish_by / start_after / other), `time` for finish by / start after, `note`. */
  @Post('day-requests')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const onDate = date(body ?? {}, 'date', { required: true })!;
    const kind = oneOf(body ?? {}, 'kind', DAY_REQUEST_KINDS, { required: true })!;
    const atTime = kind === 'finish_by' || kind === 'start_after' ? time(body ?? {}, 'time', 'Time') : null;
    if ((kind === 'finish_by' || kind === 'start_after') && !atTime) throw new BadRequestException('Choose a time');
    const note = text(body ?? {}, 'note', { max: 200 });
    if (kind === 'other' && !note) throw new BadRequestException('Say what you would like');
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      await db.query('select 1 from workers where id = $1 for update', [w.id]);
      const today = todayIn((await loadSettings(db, t.tenantId)).timezone);
      const open = (await db.query<{ n: number }>(`select count(*)::int as n from day_requests where worker_id = $1 and on_date = $2 and status = 'open'`, [w.id, onDate])).rows[0].n;
      const refusal = myDayRequestRefusal(onDate, today, open);
      if (refusal) throw new BadRequestException(refusal);
      const row = (await db.query<MyRow>(
        `insert into day_requests(tenant_id, worker_id, on_date, kind, at_time, note, created_via, created_by)
         values ($1, $2, $3, $4, $5::time, $6, 'app', $7) returning ${MY_COLS}`,
        [t.tenantId, w.id, onDate, kind, atTime, note, auth.userId])).rows[0];
      return { ...row, line: fillWords(requestLine(row), await wordsFor(db)) };
    });
  }

  /** Withdraws one of their own requests while it is still waiting. */
  @Post('day-requests/:id/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const r = (await db.query<{ status: string }>('select status from day_requests where id = $1 and worker_id = $2 for update', [id, w.id])).rows[0];
      if (!r) throw new NotFoundException('Request not found');
      if (r.status !== 'open') throw new ConflictException('The office has already answered this request');
      const row = (await db.query<MyRow>(`update day_requests set status = 'withdrawn' where id = $1 returning ${MY_COLS}`, [id])).rows[0];
      return { ...row, line: fillWords(requestLine(row), await wordsFor(db)) };
    });
  }
}
