import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification, queuePush } from '../notifications/notify.js';
import { fillWords, wordsFor } from '../terms/words.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { answeredMessage, breaksRequest, decideRefusal, requestLine, type DayRequestKind, type DayRequestStatus } from './day-requests.js';
import { actorOf } from './publishing.js';
import { UUID } from './shift-create.js';

export const DAY_REQUEST_COLS = `r.id, r.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName",
  to_char(r.on_date, 'YYYY-MM-DD') as date, r.kind, to_char(r.at_time, 'HH24:MI') as "atTime", r.note, r.status, r.created_via as "createdVia",
  r.created_at as "createdAt", r.decided_at as "decidedAt", r.decided_by_name as "decidedByName", r.decided_note as "decidedNote"`;

export type DayRequestRow = {
  id: string; workerId: string; workerName: string; date: string; kind: DayRequestKind; atTime: string | null; note: string | null;
  status: DayRequestStatus; createdVia: string; createdAt: string; decidedAt: string | null; decidedByName: string | null; decidedNote: string | null;
};

const STATUSES = ['open', 'done', 'not_possible', 'withdrawn', 'all'] as const;
const MAX_DAYS = 62;

/**
 * Requests for a day from the app (David, 3 Nov, answer 3: Steve's "R"; migration 0080), for the office: the App
 * requests panel on the roster, and marking each done or not possible (the person is told once: push in the app,
 * else email).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class DayRequestsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * Requests from `from` to `to` (local dates; default today and the next 13 days), waiting ones by default
   * (`status` open / done / not_possible / withdrawn / all). `facilityId`: people with a shift at that site in the
   * period or the 90 days before. Each row carries `line` and the person's shifts that day, with `breaks` when a
   * shift doesn't fit the request.
   */
  @Roles(...OFFICE_ROLES)
  @Get('day-requests')
  list(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const status = (STATUSES as readonly string[]).includes(q.status) ? q.status : 'open';
    const facilityId = q.facilityId && UUID.test(q.facilityId) ? q.facilityId : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const today = todayIn((await loadSettings(db, t.tenantId)).timezone);
      const from = date({ from: q.from }, 'from') ?? today;
      const to = date({ to: q.to }, 'to') ?? addDays(from, 13);
      if (to < from) throw new BadRequestException('The end date is before the start date');
      if (addDays(from, MAX_DAYS) < to) throw new BadRequestException(`Choose ${MAX_DAYS} days or fewer`);
      const rows = (await db.query<DayRequestRow>(
        `select ${DAY_REQUEST_COLS} from day_requests r join workers w on w.id = r.worker_id
          where r.on_date between $1 and $2 and ($3 = 'all' or r.status = $3)
            and ($4::uuid is null or exists (
              select 1 from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
               where sa.worker_id = r.worker_id and sa.resource_kind = 'worker' and s.facility_id = $4
                 and (s.starts_at at time zone f.timezone)::date between $1::date - 90 and $2))
          order by r.on_date, r.created_at`, [from, to, status, facilityId])).rows;
      return { from, to, status, requests: await withShifts(db, rows) };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Post('day-requests/:id/done')
  @HttpCode(200)
  done(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.decide(t, auth, id, 'done', body ?? {});
  }

  @Roles(...OFFICE_ROLES)
  @Post('day-requests/:id/not-possible')
  @HttpCode(200)
  notPossible(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.decide(t, auth, id, 'not_possible', body ?? {});
  }

  private decide(t: Membership, auth: AuthContext, id: string, outcome: 'done' | 'not_possible', body: Record<string, unknown>) {
    const note = text(body, 'note', { max: 300 });
    const tell = bool(body, 'tell') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<DayRequestRow & { email: string | null; firstName: string }>(
        `select ${DAY_REQUEST_COLS}, w.email, coalesce(w.preferred_name, w.first_name) as "firstName"
           from day_requests r join workers w on w.id = r.worker_id where r.id = $1 for update of r`, [id])).rows[0];
      if (!r) throw new NotFoundException('Request not found');
      const refusal = decideRefusal(r.status);
      if (refusal) throw new ConflictException(refusal);
      const actor = actorOf(auth);
      await db.query(
        `update day_requests set status = $2, decided_at = now(), decided_by = $3, decided_by_name = $4, decided_note = $5 where id = $1`,
        [id, outcome, auth.userId, actor.name, note]);
      let told: 'app' | 'email' | null = null;
      if (tell) {
        const w = await wordsFor(db);
        const business = (await db.query<{ name: string }>('select name from tenants where id = $1', [t.tenantId])).rows[0]?.name ?? 'CROP';
        const m = answeredMessage(r.firstName, r.date, fillWords(requestLine(r), w), outcome, note, business);
        const n = await queuePush(db, t.tenantId, { workerId: r.workerId, template: 'day_request_answered', title: m.push.title, body: m.push.body, dedupeKey: `day-request:${id}`, createdBy: auth.userId });
        if (n > 0) told = 'app';
        else if (r.email) {
          await queueNotification(db, t.tenantId, {
            channel: 'email', to: r.email, template: 'day_request_answered', subject: m.email.subject, body: m.email.body,
            workerId: r.workerId, dedupeKey: `day-request:${id}:email`, createdBy: auth.userId,
          });
          told = 'email';
        }
      }
      const row = (await db.query<DayRequestRow>(`select ${DAY_REQUEST_COLS} from day_requests r join workers w on w.id = r.worker_id where r.id = $1`, [id])).rows[0];
      return { ...(await withShifts(db, [row]))[0], told };
    });
  }
}

/** Adds each request's `line` (in the business's words) and the person's shifts that day, marking those that don't fit. */
export async function withShifts(db: PoolClient, rows: DayRequestRow[]) {
  if (!rows.length) return [];
  const w = await wordsFor(db);
  const shifts = (await db.query<{ workerId: string; date: string; id: string; facilityName: string; role: string; localStart: string; localEnd: string }>(
    `select sa.worker_id as "workerId", to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as date, s.id, f.name as "facilityName", s.role,
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd"
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
       join (select distinct * from unnest($1::uuid[], $2::date[]) as u(worker_id, on_date)) x on x.worker_id = sa.worker_id and (s.starts_at at time zone f.timezone)::date = x.on_date
      where sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
      order by s.starts_at`, [rows.map(r => r.workerId), rows.map(r => r.date)])).rows;
  return rows.map(r => ({
    ...r, line: fillWords(requestLine(r), w),
    shifts: shifts.filter(s => s.workerId === r.workerId && s.date === r.date)
      .map(({ workerId: _w, date: _d, ...s }) => ({ ...s, breaks: breaksRequest(r, s.localStart, s.localEnd) })),
  }));
}
