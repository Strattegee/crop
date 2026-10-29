import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { rosterChangeRefusal } from '../roster/offers-data.js';
import { shiftById } from '../roster/roster.controller.js';
import { wordsFor } from '../terms/words.js';
import { agencyFillProblem, escalationMinutes, inWords, localWhen, requestArrivedEmail, roundSchedule, roundState, type InboxShift } from './requests.js';

type Delivery = { agency_tenant_id: string; inbox_id: string };

const INBOX_COLS = `id, connection_id as "connectionId", employer_name as "employerName", site_name as "siteName", site_region as "siteRegion",
  site_timezone as "siteTimezone", area_name as "areaName", role, starts_at as "startsAt", ends_at as "endsAt", break_minutes as "breakMinutes",
  duties, requirements, note, status, received_at as "receivedAt", closed_at as "closedAt", closed_reason as "closedReason"`;

type InboxRow = InboxShift & { id: string; connectionId: string; siteRegion: string | null; breakMinutes: number; status: string; receivedAt: Date; closedAt: Date | null; closedReason: string | null };

/**
 * Emails the agency's owners and admins about requests it has just been sent. Runs in the agency's own business
 * (its inbox row and its office's emails), after the step that sent them has been saved.
 */
export async function tellAgencies(pool: Pool, deliveries: Delivery[]) {
  for (const d of deliveries) {
    await withTenant(pool, d.agency_tenant_id, async db => {
      const row = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [d.inbox_id])).rows[0];
      if (!row) return;
      const w = await wordsFor(db);
      const { subject, body } = requestArrivedEmail(row, process.env.APP_URL || null, w);
      const emails = (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows;
      for (const e of emails) {
        await queueNotification(db, d.agency_tenant_id, { channel: 'email', to: e.email, template: 'agency_request', subject, body, dedupeKey: `agency-request:${d.inbox_id}:${e.email.toLowerCase()}` });
      }
    });
  }
}

type RoundRow = { id: string; connectionId: string; agencyName: string; position: number; dueAt: Date; sentAt: Date | null; sentHow: string | null; skippedAt: Date | null; skippedReason: string | null };

async function fillState(db: PoolClient, shiftId: string, now = new Date()) {
  const shift = await shiftById(db, shiftId);
  const request = (await db.query<{ id: string; status: string; note: string | null; createdByName: string | null; createdAt: Date; closedAt: Date | null; closedReason: string | null }>(
    `select id, status, note, created_by_name as "createdByName", created_at as "createdAt", closed_at as "closedAt", closed_reason as "closedReason"
       from agency_requests where shift_id = $1 order by created_at desc limit 1`, [shiftId])).rows[0] ?? null;
  const rounds = request ? (await db.query<RoundRow>(
    `select id, connection_id as "connectionId", agency_name as "agencyName", position, due_at as "dueAt", sent_at as "sentAt", sent_how as "sentHow",
            skipped_at as "skippedAt", skipped_reason as "skippedReason"
       from agency_request_rounds where request_id = $1 order by position`, [request.id])).rows : [];
  const active = (await db.query<{ n: number }>(`select count(*)::int as n from agency_connections where side = 'employer' and status = 'active'`)).rows[0].n;
  const w = await wordsFor(db);
  const problem = agencyFillProblem({ status: shift.status, equipmentOnly: shift.equipmentOnly, startsAt: new Date(shift.startsAt) }, active, request?.status === 'open', now, w);
  const next = request?.status === 'open' ? rounds.find(r => roundState(r) === 'waiting') ?? null : null;
  return {
    shiftId,
    request,
    rounds: rounds.map(r => ({ ...r, state: roundState(r), dueIn: roundState(r) === 'waiting' ? inWords(new Date(r.dueAt).getTime() - now.getTime()) : null })),
    next: next ? { agencyName: next.agencyName, dueAt: next.dueAt, dueIn: inWords(new Date(next.dueAt).getTime() - now.getTime()) } : null,
    activeAgencies: active,
    canRequest: problem === null,
    problem,
  };
}

/**
 * Agency fill (backlog items 7–8, migration 0040). Employer side: send an open shift to the business's agencies
 * (first in order straight away, then the next ones on the timer), see who has it, bring the next one forward,
 * withdraw. Agency side: the requests it has been sent (Allocations). Cross-business steps are the checked
 * `app_agency_*` functions; everything read here is this business's own rows.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AgencyFillController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Where a shift's agency request stands: the latest request, each agency's turn, and whether it can be sent now. */
  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/agency-fill')
  state(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, db => fillState(db, id));
  }

  /**
   * Send an open shift to agencies (`{ note? }`): the first agency in the business's order gets it now, the next one
   * after 10 minutes (starts within 2 hours), 1 hour (later today) or 2 hours (tomorrow or later), and so on.
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/agency-fill')
  async request(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const note = text(body ?? {}, 'note', { max: 300 });
    const actor = actorOf(auth);
    const deliveries = await withTenant(this.pool, t.tenantId, async db => {
      await db.query('select 1 from shifts where id = $1 for update', [id]);
      const now = new Date();
      const st = await fillState(db, id, now);
      if (st.problem) throw new BadRequestException(st.problem);
      const refusal = await rosterChangeRefusal(db, id);
      if (refusal) throw new BadRequestException(refusal);
      const shift = await shiftById(db, id);
      const links = (await db.query<{ connectionId: string; preference: number | null; otherName: string }>(
        `select connection_id as "connectionId", preference, other_name as "otherName" from agency_connections
          where side = 'employer' and status = 'active'`)).rows;
      const plan = roundSchedule(links, now, escalationMinutes(new Date(shift.startsAt), now, shift.timezone));
      const req = (await db.query<{ id: string }>(
        `insert into agency_requests(tenant_id, shift_id, note, created_by_name) values ($1,$2,$3,$4) returning id`,
        [t.tenantId, id, note, actor.name ?? null])).rows[0];
      for (const p of plan) {
        await db.query(
          `insert into agency_request_rounds(tenant_id, request_id, connection_id, agency_name, position, due_at)
           values ($1,$2,$3,$4,$5, now() + make_interval(mins => $6))`,
          [t.tenantId, req.id, p.connectionId, p.otherName, p.position, Math.round((p.dueAt.getTime() - now.getTime()) / 60_000)]);
      }
      return (await db.query<Delivery>('select * from app_agency_send_due($1, $2)', [req.id, 'first'])).rows;
    }, actor);
    await tellAgencies(this.pool, deliveries);
    return withTenant(this.pool, t.tenantId, db => fillState(db, id));
  }

  /** Send the shift to the next agency now instead of waiting for the timer. */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/agency-fill/next')
  @HttpCode(200)
  async next(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const actor = actorOf(auth);
    const deliveries = await withTenant(this.pool, t.tenantId, async db => {
      const req = (await db.query<{ id: string }>(`select id from agency_requests where shift_id = $1 and status = 'open'`, [id])).rows[0];
      if (!req) {
        await shiftById(db, id);
        throw new BadRequestException("This shift isn't with agencies at the moment");
      }
      const next = (await db.query<{ id: string }>(
        `select id from agency_request_rounds where request_id = $1 and sent_at is null and skipped_at is null order by position limit 1 for update`, [req.id])).rows[0];
      if (!next) throw new BadRequestException('Every agency already has it');
      await db.query('update agency_request_rounds set due_at = least(due_at, clock_timestamp()) where id = $1', [next.id]);
      // Later agencies keep their gap after this one.
      return (await db.query<Delivery>('select * from app_agency_send_due($1, $2)', [req.id, 'manual'])).rows;
    }, actor);
    await tellAgencies(this.pool, deliveries);
    return withTenant(this.pool, t.tenantId, db => fillState(db, id));
  }

  /** Take the shift back from agencies (`{ reason? }`). Agencies see it as withdrawn. */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/agency-fill/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body ?? {}, 'reason', { max: 300 });
    return withTenant(this.pool, t.tenantId, async db => {
      const req = (await db.query<{ id: string }>(`select id from agency_requests where shift_id = $1 and status = 'open'`, [id])).rows[0];
      if (!req) {
        await shiftById(db, id);
        throw new BadRequestException("This shift isn't with agencies at the moment");
      }
      await db.query('select app_agency_withdraw_request($1, $2)', [req.id, reason]);
      return fillState(db, id);
    }, actorOf(auth));
  }

  /**
   * Agency side (Allocations): the requests this business has been sent by employers. `status=open` (default) or
   * `all` (closed ones from the last 30 days too). Open ones soonest first, then the most recently received.
   */
  @Roles(...OFFICE_ROLES)
  @Get('agency-requests')
  inbox(@Tenant() t: Membership, @Query('status') status?: string) {
    if (status !== undefined && status !== 'open' && status !== 'all') throw new BadRequestException('Status must be open or all');
    return withTenant(this.pool, t.tenantId, async db => {
      const rows = (await db.query<InboxRow>(
        `select ${INBOX_COLS} from agency_inbox
          where ${status === 'all' ? `status = 'open' or received_at > now() - interval '30 days'` : `status = 'open'`}
          order by status <> 'open', case when status = 'open' then starts_at end, received_at desc`)).rows;
      const now = Date.now();
      return rows.map(r => ({
        ...r,
        when: localWhen(r),
        startsIn: inWords(new Date(r.startsAt).getTime() - now),
        unmatched: r.requirements.filter(q => q.severity !== 'optional' && !q.credentialTypeId).length,
      }));
    });
  }

  /** For the menu: whether this business supplies any employer (an agency side link) and how many requests are open. */
  @Roles(...OFFICE_ROLES)
  @Get('allocations/summary')
  summary(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query<{ agencyLinks: number; open: number }>(
      `select (select count(*)::int from agency_connections where side = 'agency' and status <> 'ended') as "agencyLinks",
              (select count(*)::int from agency_inbox where status = 'open') as open`)).rows[0]);
  }

  @Roles(...OFFICE_ROLES)
  @Get('agency-requests/:id')
  one(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [id])).rows[0];
      if (!r) throw new NotFoundException('Request not found');
      return { ...r, when: localWhen(r), startsIn: inWords(new Date(r.startsAt).getTime() - Date.now()) };
    });
  }
}

/**
 * The agency fill timer: every minute, closes requests whose shift has started and sends each request on to the
 * next agency when its time comes. Off with AGENCY_ESCALATE=off or NOTIFY_DISPATCH=off (tests call runOnce).
 */
@Injectable()
export class AgencyEscalator implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('AgencyFill');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    if (process.env.AGENCY_ESCALATE === 'off' || process.env.NOTIFY_DISPATCH === 'off') return;
    const every = Number(process.env.AGENCY_ESCALATE_MS ?? 60_000);
    this.timer = setInterval(() => void this.runOnce().catch(err => this.log.error(err)), every);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends what has come due. Returns how many agencies were sent a request. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const sent = (await this.pool.query<Delivery>('select agency_tenant_id, inbox_id from app_agency_escalate(50)')).rows;
      await tellAgencies(this.pool, sent);
      return sent.length;
    } finally {
      this.running = false;
    }
  }
}
