import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { todayIn } from '../workforce/compliance.js';
import { queueNotification } from '../notifications/notify.js';
import { CHANGE_REQUEST_KINDS, requestArrivedEmail, requestDecidedEmail, requestProblem, requestSummary, type ChangeRequestKind, type ChangeRequestStatus, type RequestForEmail } from './change-requests.js';
import { eligibilityForShift } from './eligibility-data.js';
import { rosterChangeRefusal } from './offers-data.js';
import { actorOf, mondayOf, weekState } from './publishing.js';
import { shiftById } from './roster.controller.js';
import { assignWorker, cancelShift, confirmWorker, removeWorker } from './shift-actions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: Array<ChangeRequestStatus | 'all'> = ['pending', 'approved', 'declined', 'withdrawn', 'all'];
const DECIDERS = new Set(['owner', 'admin']);

const COLS = `r.id, r.shift_id as "shiftId", r.kind, r.worker_id as "workerId", r.reason, r.status,
  r.requested_by as "requestedBy", r.requested_by_name as "requestedByName", r.created_at as "createdAt",
  r.decided_by_name as "decidedByName", r.decided_at as "decidedAt", r.decision_note as "decisionNote",
  case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName",
  (select coalesce(cw.preferred_name, cw.first_name) || ' ' || cw.last_name from shift_assignments ca join workers cw on cw.id = ca.worker_id
    where ca.shift_id = s.id and ca.resource_kind = 'worker' and ca.status in ('assigned', 'confirmed') limit 1) as "currentName",
  r.facility_id as "facilityId", to_char(r.week_start, 'YYYY-MM-DD') as "weekStart",
  s.role, s.status as "shiftStatus", f.name as "facilityName", a.name as "areaName",
  to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
  to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
  to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd"`;
const FROM = `roster_change_requests r join shifts s on s.id = r.shift_id join facilities f on f.id = r.facility_id
  left join areas a on a.id = s.area_id left join workers w on w.id = r.worker_id`;

type Row = Record<string, unknown> & { kind: ChangeRequestKind; status: ChangeRequestStatus; requestedBy: string; workerName: string | null; currentName: string | null; reason: string | null };

function present(rows: Row[], auth: AuthContext) {
  const decider = DECIDERS.has(auth.tenant?.role ?? '');
  return rows.map(r => ({
    ...r,
    // While it waits, describe it against who is on the shift now; afterwards the shift has changed, so stay general.
    summary: requestSummary({ ...r, currentName: r.status === 'pending' ? r.currentName : null }),
    canDecide: r.status === 'pending' && decider,
    canWithdraw: r.status === 'pending' && (decider || r.requestedBy === auth.userId),
  }));
}

async function oneRequest(db: PoolClient, id: string, lock = false) {
  const r = (await db.query<{ id: string; shift_id: string; kind: ChangeRequestKind; worker_id: string | null; reason: string | null; status: ChangeRequestStatus; requested_by: string }>(
    `select id, shift_id, kind, worker_id, reason, status, requested_by from roster_change_requests where id = $1 ${lock ? 'for update' : ''}`, [id])).rows[0];
  if (!r) throw new NotFoundException('Change request not found');
  return r;
}

/** The request as an email describes it, worded against the shift as it is now (call before changing the shift). */
async function forEmail(db: PoolClient, id: string): Promise<{ r: RequestForEmail; email: string | null; requestedBy: string }> {
  const row = (await db.query<Row & RequestForEmail & { requestedByEmail: string | null }>(
    `select ${COLS}, r.requested_by_email as "requestedByEmail" from ${FROM} where r.id = $1`, [id])).rows[0];
  return { r: { ...row, summary: requestSummary(row) }, email: row.requestedByEmail, requestedBy: row.requestedBy };
}

/** Tells the person who asked how their request was decided, unless they decided it themselves. */
async function tellAsker(db: PoolClient, tenantId: string, id: string, before: Awaited<ReturnType<typeof forEmail>>,
  outcome: 'approved' | 'declined' | 'withdrawn', auth: AuthContext, decidedByName: string | null, note: string | null) {
  if (!before.email || before.requestedBy === auth.userId) return;
  const m = requestDecidedEmail(before.r, outcome, decidedByName, note, process.env.APP_URL ?? '');
  await queueNotification(db, tenantId, {
    channel: 'email', to: before.email, template: 'change_request_decided', subject: m.subject, body: m.body,
    createdBy: auth.userId, dedupeKey: `change-request:${id}:${outcome}`,
  });
}

/**
 * Asking for a change to a published roster, and approving it (backlog item 2, Steve's answer 5; migration 0025).
 * Used when the business's after-publishing rule stops someone making the change themselves.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class ChangeRequestsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * Ask for a change to a shift on a live week: `change` = assign (with `workerId`), confirm, remove, pulled_out, cancel or
   * other (both with `reason`). Only when the after-publishing rule stops this person making it themselves.
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/change-requests')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const kind = text(body, 'change', { required: true, max: 20 }) as ChangeRequestKind;
    if (!CHANGE_REQUEST_KINDS.includes(kind)) throw new BadRequestException('Choose the change you need');
    const reason = text(body, 'reason', { required: kind === 'cancel' || kind === 'other', max: 300 });
    const rawWorker = text(body, 'workerId', { required: kind === 'assign', max: 40 });
    if (rawWorker !== null && !UUID.test(rawWorker)) throw new BadRequestException('Choose a person');
    const workerId = kind === 'assign' ? rawWorker : null;
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      // Lock the shift so the request is checked against it as it is now.
      const s = (await db.query<{ facility_id: string; status: string; needs_person: boolean; timezone: string; local_date: string; has_person: boolean }>(
        `select s.facility_id, s.status, s.needs_person, f.timezone,
                to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as local_date,
                exists (select 1 from shift_assignments sa where sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')) as has_person
           from shifts s join facilities f on f.id = s.facility_id where s.id = $1 for update of s`, [id])).rows[0];
      if (!s) throw new NotFoundException('Shift not found');
      const week = mondayOf(s.local_date);
      if (weekState(week, true, todayIn(s.timezone)) === 'history') throw new ConflictException('This week is over, so its roster can no longer be changed');
      const refusal = await rosterChangeRefusal(db, id);
      if (!refusal) throw new ConflictException('You can make this change yourself.');
      const problem = requestProblem(kind, { status: s.status, equipmentOnly: !s.needs_person, hasPerson: s.has_person });
      if (problem) throw new ConflictException(problem);
      if (workerId) {
        const w = (await db.query<{ status: string; name: string }>(
          `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1`, [workerId])).rows[0];
        if (!w) throw new BadRequestException('Choose a person');
        if (w.status !== 'active') throw new BadRequestException(`${w.name} isn't active`);
        const [check] = await eligibilityForShift(db, t.tenantId, id, [workerId]);
        if (!check.eligible) throw new ConflictException(check.blocks.map(b => b.message).join('. '));
      }
      try {
        const newId = (await db.query<{ id: string }>(
          `insert into roster_change_requests(tenant_id, shift_id, facility_id, week_start, kind, worker_id, reason, requested_by, requested_by_name, requested_by_email)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [t.tenantId, id, s.facility_id, week, kind, workerId, reason, auth.userId, actor.name, auth.email || null])).rows[0].id;
        // Owners and admins hear about it straight away (not the asker, if they are one).
        const { r } = await forEmail(db, newId);
        const m = requestArrivedEmail(r, process.env.APP_URL ?? '');
        const mine = (auth.email ?? '').trim().toLowerCase();
        for (const o of (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows) {
          if (!o.email || o.email.trim().toLowerCase() === mine) continue;
          await queueNotification(db, t.tenantId, {
            channel: 'email', to: o.email, template: 'change_request', subject: m.subject, body: m.body,
            createdBy: auth.userId, dedupeKey: `change-request:${newId}:arrived:${o.email.trim().toLowerCase()}`,
          });
        }
        return present((await db.query<Row>(`select ${COLS} from ${FROM} where r.id = $1`, [newId])).rows, auth)[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('A change to this shift is already waiting for approval');
        throw e;
      }
    }, actor);
  }

  /** Requests for a week (any date in it), newest first; `status` defaults to pending (`all` for every one). */
  @Roles(...OFFICE_ROLES)
  @Get('roster/change-requests')
  list(@Tenant() t: Membership, @Auth() auth: AuthContext, @Query() q: Record<string, string>) {
    const weekStart = mondayOf(date(q, 'weekStart', { required: true })!);
    const facilityId = q.facilityId && UUID.test(q.facilityId) ? q.facilityId : null;
    const status = (q.status ?? 'pending') as ChangeRequestStatus | 'all';
    if (!STATUSES.includes(status)) throw new BadRequestException('Status must be pending, approved, declined, withdrawn or all');
    return withTenant(this.pool, t.tenantId, async db => present((await db.query<Row>(
      `select ${COLS} from ${FROM}
        where r.week_start = $1 and ($2::uuid is null or r.facility_id = $2) and ($3 = 'all' or r.status = $3)
        order by r.created_at desc limit 200`, [weekStart, facilityId, status])).rows, auth));
  }

  /** Every request made for one shift, oldest first. */
  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/change-requests')
  forShift(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await shiftById(db, id);
      return present((await db.query<Row>(`select ${COLS} from ${FROM} where r.shift_id = $1 order by r.created_at`, [id])).rows, auth);
    });
  }

  /**
   * An owner or admin approves: the change is made now, as theirs, with the same checks as making it directly
   * (eligibility, the after-publishing rule). If it can't be made, nothing changes and the request stays waiting.
   */
  @Roles('owner', 'admin')
  @Post('change-requests/:id/approve')
  @HttpCode(200)
  approve(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const note = text(body ?? {}, 'note', { max: 300 });
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await oneRequest(db, id, true);
      if (r.status !== 'pending') throw new ConflictException(`This request has already been ${r.status}`);
      const before = await forEmail(db, id);
      let warnings: string[] = [];
      switch (r.kind) {
        case 'assign': warnings = await assignWorker(db, t.tenantId, auth.userId, r.shift_id, r.worker_id!); break;
        case 'confirm': await confirmWorker(db, r.shift_id); break;
        case 'remove': await removeWorker(db, r.shift_id, false); break;
        case 'pulled_out': await removeWorker(db, r.shift_id, true); break;
        case 'cancel': await cancelShift(db, auth.userId, r.shift_id, r.reason!); break;
        case 'other': break; // described in words: the approver makes it on the shift
      }
      await db.query(
        `update roster_change_requests set status = 'approved', decided_by = $2, decided_by_name = $3, decided_at = now(), decision_note = $4 where id = $1`,
        [id, auth.userId, actor.name, note]);
      await tellAsker(db, t.tenantId, id, before, 'approved', auth, actor.name ?? null, note);
      const [row] = present((await db.query<Row>(`select ${COLS} from ${FROM} where r.id = $1`, [id])).rows, auth);
      return { ...row, warnings, applied: r.kind !== 'other' };
    }, actor);
  }

  /** An owner or admin declines, optionally saying why. */
  @Roles('owner', 'admin')
  @Post('change-requests/:id/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.close(t, auth, id, 'declined', text(body ?? {}, 'note', { max: 300 }));
  }

  /** The person who asked (or an owner or admin) takes the request back. */
  @Roles(...OFFICE_ROLES)
  @Post('change-requests/:id/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.close(t, auth, id, 'withdrawn', null);
  }

  private close(t: Membership, auth: AuthContext, id: string, status: 'declined' | 'withdrawn', note: string | null) {
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await oneRequest(db, id, true);
      if (r.status !== 'pending') throw new ConflictException(`This request has already been ${r.status}`);
      if (status === 'withdrawn' && r.requested_by !== auth.userId && !DECIDERS.has(t.role)) {
        throw new ForbiddenException('Only the person who asked, or an owner or admin, can withdraw this request');
      }
      await db.query(
        `update roster_change_requests set status = $2, decided_by = $3, decided_by_name = $4, decided_at = now(), decision_note = $5 where id = $1`,
        [id, status, auth.userId, actor.name, note]);
      await tellAsker(db, t.tenantId, id, await forEmail(db, id), status, auth, actor.name ?? null, note);
      return present((await db.query<Row>(`select ${COLS} from ${FROM} where r.id = $1`, [id])).rows, auth)[0];
    }, actor);
  }
}
