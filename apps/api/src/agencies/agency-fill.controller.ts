import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { int, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { rosterChangeRefusal } from '../roster/offers-data.js';
import { shiftById } from '../roster/roster.controller.js';
import { T, wordsFor } from '../terms/words.js';
import { BAND_WORDS, DEFAULT_AGENCY_TIMING, agencyFillProblem, agencyRules, escalationMinutes, minutesWords, timingBand, type AgencyTiming, inWords, localWhen, placementChangedEmail, placementWords, pulledOutEmail, putForwardEmail, requestArrivedEmail, roundSchedule, roundState, type InboxShift, type Notice, type Placement, type SnapshotRequirement } from './requests.js';
import { eligibilityForFacts, rankCandidates } from '../roster/eligibility-data.js';

type Delivery = { agency_tenant_id: string; inbox_id: string };

export const INBOX_COLS = `id, connection_id as "connectionId", employer_name as "employerName", site_name as "siteName", site_region as "siteRegion",
  site_timezone as "siteTimezone", area_name as "areaName", role, starts_at as "startsAt", ends_at as "endsAt", break_minutes as "breakMinutes",
  duties, requirements, note, gender_requested as "genderRequested", status, received_at as "receivedAt", closed_at as "closedAt", closed_reason as "closedReason",
  placed_worker_id as "placedWorkerId", placed_name as "placedName", placed_by_name as "placedByName", placed_at as "placedAt", placement, placement_at as "placementAt"`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboxRow = InboxShift & { id: string; connectionId: string; siteRegion: string | null; breakMinutes: number; status: string; receivedAt: Date; closedAt: Date | null; closedReason: string | null;
  placedWorkerId: string | null; placedName: string | null; placedByName: string | null; placedAt: Date | null; placement: Placement | null; placementAt: Date | null };

/**
 * Agency side: this business's people (or just `workerIds`) for one request it was sent, checked against the
 * employer's requirements as matched to this business's credentials and its own rules for each person. Ranked.
 */
export async function peopleForRequest(db: PoolClient, tenantId: string, inboxId: string, workerIds?: string[], opts: { evenIfClosed?: boolean } = {}) {
  const r = (await db.query<{ connection_id: string; employer_name: string; role: string; starts_at: Date; ends_at: Date; status: string;
    requirements: SnapshotRequirement[]; local_date: string; local_start: string; hours: number; gender_requested: 'F' | 'M' | null }>(
    `select connection_id, employer_name, role, starts_at, ends_at, status, requirements, gender_requested,
            to_char(starts_at at time zone site_timezone, 'YYYY-MM-DD') as local_date,
            to_char(starts_at at time zone site_timezone, 'HH24:MI') as local_start,
            (extract(epoch from (ends_at - starts_at)) / 3600 - break_minutes / 60.0)::float8 as hours
       from agency_inbox where id = $1`, [inboxId])).rows[0];
  if (!r) throw new NotFoundException('Request not found');
  const live = new Map((await db.query<{ employer_credential_type_id: string; credential_type_id: string }>(
    'select employer_credential_type_id, credential_type_id from agency_credential_maps where connection_id = $1', [r.connection_id])).rows
    .map(m => [m.employer_credential_type_id, m.credential_type_id]));
  const names = new Map((await db.query<{ id: string; name: string }>('select id, name from credential_types where active')).rows.map(c => [c.id, c.name]));
  const { rules, blockAll, unmatched } = agencyRules(r.requirements, live, names, r.employer_name);
  // `evenIfClosed`: checking the person already put forward (Needs attention); the placement itself is this shift (`id`), so it isn't double booking.
  const people = r.status !== 'open' && !opts.evenIfClosed ? [] : rankCandidates(await eligibilityForFacts(db, tenantId,
    { id: inboxId, role: r.role, startsAt: r.starts_at, endsAt: r.ends_at, localDate: r.local_date, localStart: r.local_start, hours: r.hours,
      genderRequested: r.gender_requested },
    { onlyRules: rules, roleWarnOnly: true, blockAll, workerIds }));
  // (Asking about one person: whether they are active is checked when they are put forward.)
  return { status: r.status, unmatched, people };
}

/** Emails the employer's owners and admins that an agency put someone forward. Runs in the employer's own business. */
export async function tellEmployer(pool: Pool, employerTenantId: string, placementId: string) {
  await withTenant(pool, employerTenantId, async db => {
    const p = (await db.query<{ agencyName: string; personName: string; role: string; siteName: string; areaName: string | null; startsAt: Date; endsAt: Date;
      siteTimezone: string; status: string; shiftId: string; weekStart: string }>(
      `select p.agency_name as "agencyName", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "personName", s.role, f.name as "siteName",
              a.name as "areaName", s.starts_at as "startsAt", s.ends_at as "endsAt", f.timezone as "siteTimezone", p.status, s.id as "shiftId",
              to_char(date_trunc('week', s.starts_at at time zone f.timezone), 'YYYY-MM-DD') as "weekStart"
         from agency_placements p join workers w on w.id = p.worker_id join shifts s on s.id = p.shift_id
         join facilities f on f.id = s.facility_id left join areas a on a.id = s.area_id
        where p.id = $1`, [placementId])).rows[0];
    if (!p) return;
    const w = await wordsFor(db);
    const { subject, body } = putForwardEmail({ ...p, booked: p.status === 'booked' }, process.env.APP_URL || null, w);
    const emails = (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows;
    for (const e of emails) {
      await queueNotification(db, employerTenantId, { channel: 'email', to: e.email, template: 'agency_put_forward', subject, body, dedupeKey: `agency-put-forward:${placementId}:${e.email.toLowerCase()}` });
    }
  });
}

/** Emails the employer's owners and admins that an agency took its person back. Runs in the employer's own business. */
async function tellEmployerPulledOut(pool: Pool, employerTenantId: string, placementId: string) {
  await withTenant(pool, employerTenantId, async db => {
    const p = (await db.query<{ agencyName: string; personName: string; role: string; siteName: string; areaName: string | null; startsAt: Date; endsAt: Date;
      siteTimezone: string; reason: string | null; shiftId: string; weekStart: string }>(
      `select p.agency_name as "agencyName", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "personName", s.role, f.name as "siteName",
              a.name as "areaName", s.starts_at as "startsAt", s.ends_at as "endsAt", f.timezone as "siteTimezone", p.pulled_out_reason as reason,
              s.id as "shiftId", to_char(date_trunc('week', s.starts_at at time zone f.timezone), 'YYYY-MM-DD') as "weekStart"
         from agency_placements p join workers w on w.id = p.worker_id join shifts s on s.id = p.shift_id
         join facilities f on f.id = s.facility_id left join areas a on a.id = s.area_id
        where p.id = $1`, [placementId])).rows[0];
    if (!p) return;
    const w = await wordsFor(db);
    const { subject, body } = pulledOutEmail(p, process.env.APP_URL || null, w);
    const emails = (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows;
    for (const e of emails) {
      await queueNotification(db, employerTenantId, { channel: 'email', to: e.email, template: 'agency_pulled_out', subject, body, dedupeKey: `agency-pulled-out:${placementId}:${e.email.toLowerCase()}` });
    }
  });
}

/**
 * Emails agencies about what the employer did with the people they put forward (approved, declined, taken off,
 * recorded as pulled out, shift cancelled). The employer's change marks the agency's copy; each mark is taken and
 * its email queued in one transaction in the agency's own business. Returns how many were told.
 */
export async function tellPlacementChanges(pool: Pool, limit = 50): Promise<number> {
  const pending = (await pool.query<{ agency_tenant_id: string; inbox_id: string }>('select agency_tenant_id, inbox_id from app_agency_placement_notices($1)', [limit])).rows;
  let told = 0;
  for (const n of pending) {
    await withTenant(pool, n.agency_tenant_id, async db => {
      const notice = (await db.query<{ notice: Notice | 'waiting' | null }>('select app_agency_take_notice($1) as notice', [n.inbox_id])).rows[0]?.notice;
      if (!notice || notice === 'waiting') return;
      const taken = Date.now();
      const row = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [n.inbox_id])).rows[0];
      if (!row?.placedName) return;
      const w = await wordsFor(db);
      const { subject, body } = placementChangedEmail({ ...row, personName: row.placedName, placement: notice }, process.env.APP_URL || null, w);
      const emails = (await db.query<{ email: string }>('select email from app_agency_office_emails()')).rows;
      for (const e of emails) {
        await queueNotification(db, n.agency_tenant_id, { channel: 'email', to: e.email, template: 'agency_placement_changed', subject, body,
          // A shift can change more than once; each change's notice is taken once, so each gets its own email.
          dedupeKey: `agency-placement:${n.inbox_id}:${notice === 'changed' ? `changed:${taken}` : notice}:${e.email.toLowerCase()}` });
      }
      told++;
    });
  }
  return told;
}

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

/** This business's agency fill timing (migration 0045), or David's defaults when it has no settings row. */
export async function agencyTimingOf(db: PoolClient): Promise<AgencyTiming> {
  const r = (await db.query<AgencyTiming>(
    `select agency_step_soon_minutes as "soonMinutes", agency_step_today_minutes as "todayMinutes", agency_step_later_minutes as "laterMinutes"
       from tenant_settings where tenant_id = app_tenant_id()`)).rows[0];
  return r ?? { ...DEFAULT_AGENCY_TIMING };
}

type RoundRow = { id: string; connectionId: string; agencyName: string; position: number; dueAt: Date; sentAt: Date | null; sentHow: string | null; skippedAt: Date | null; skippedReason: string | null };

async function fillState(db: PoolClient, shiftId: string, now = new Date()) {
  const shift = await shiftById(db, shiftId);
  const request = (await db.query<{ id: string; status: string; note: string | null; stepMinutes: number | null; createdByName: string | null; createdAt: Date; closedAt: Date | null; closedReason: string | null }>(
    `select id, status, note, step_minutes as "stepMinutes", created_by_name as "createdByName", created_at as "createdAt", closed_at as "closedAt", closed_reason as "closedReason"
       from agency_requests where shift_id = $1 order by created_at desc limit 1`, [shiftId])).rows[0] ?? null;
  const rounds = request ? (await db.query<RoundRow>(
    `select id, connection_id as "connectionId", agency_name as "agencyName", position, due_at as "dueAt", sent_at as "sentAt", sent_how as "sentHow",
            skipped_at as "skippedAt", skipped_reason as "skippedReason"
       from agency_request_rounds where request_id = $1 order by position`, [request.id])).rows : [];
  const counts = (await db.query<{ anywhere: number; here: number }>(
    `select count(*)::int as anywhere, count(*) filter (where facility_ids is null or $1 = any(facility_ids))::int as here
       from agency_connections where side = 'employer' and status = 'active'`, [shift.facilityId])).rows[0];
  const active = counts.here;
  const w = await wordsFor(db);
  const problem = agencyFillProblem({ status: shift.status, equipmentOnly: shift.equipmentOnly, startsAt: new Date(shift.startsAt) }, active, request?.status === 'open', now, w, counts.anywhere);
  const placement = request ? (await db.query<{ id: string; agencyName: string; workerName: string; status: Placement; putForwardByName: string | null; createdAt: Date; decidedAt: Date | null; confirmedCredentials: string[] }>(
    `select p.id, p.agency_name as "agencyName", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName", p.status,
            p.put_forward_by_name as "putForwardByName", p.created_at as "createdAt", p.decided_at as "decidedAt",
            coalesce((select array_agg(ct.name order by ct.name) from credential_types ct where ct.id = any(p.credential_type_ids)), '{}') as "confirmedCredentials"
       from agency_placements p join workers w on w.id = p.worker_id where p.request_id = $1`, [request.id])).rows[0] ?? null : null;
  const next = request?.status === 'open' ? rounds.find(r => roundState(r) === 'waiting') ?? null : null;
  const band = timingBand(new Date(shift.startsAt), now, shift.timezone);
  const defaultMinutes = escalationMinutes(new Date(shift.startsAt), now, shift.timezone, await agencyTimingOf(db));
  return {
    shiftId,
    request,
    placement: placement ? { ...placement, state: placementWords(placement.status) } : null,
    rounds: rounds.map(r => ({ ...r, state: roundState(r), dueIn: roundState(r) === 'waiting' ? inWords(new Date(r.dueAt).getTime() - now.getTime()) : null })),
    next: next ? { agencyName: next.agencyName, dueAt: next.dueAt, dueIn: inWords(new Date(next.dueAt).getTime() - now.getTime()) } : null,
    activeAgencies: active,
    /** The gap between agencies if it were sent now: the business's setting for this shift's band (Settings → Agencies). */
    timing: { band, bandWords: BAND_WORDS[band], defaultMinutes, defaultWords: minutesWords(defaultMinutes) },
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
   * Send an open shift to agencies (`{ note?, stepMinutes? }`): the first agency in the business's order gets it now,
   * each next one a step later. The step is `stepMinutes` (1–1440) when given, else the business's timing for how soon
   * the shift starts (Settings → Agencies; defaults 10 minutes within 2 hours, 1 hour later today, 2 hours after).
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/agency-fill')
  async request(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const note = text(body ?? {}, 'note', { max: 300 });
    const chosenStep = int(body ?? {}, 'stepMinutes', 1, 1440);
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
          where side = 'employer' and status = 'active' and (facility_ids is null or $1 = any(facility_ids))`, [shift.facilityId])).rows;
      const step = chosenStep ?? escalationMinutes(new Date(shift.startsAt), now, shift.timezone, await agencyTimingOf(db));
      const plan = roundSchedule(links, now, step);
      const req = (await db.query<{ id: string }>(
        `insert into agency_requests(tenant_id, shift_id, note, step_minutes, created_by_name) values ($1,$2,$3,$4,$5) returning id`,
        [t.tenantId, id, note, step, actor.name ?? null])).rows[0];
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
        placementState: r.placement ? placementWords(r.placement, r.employerName) : null,
      }));
    });
  }

  /**
   * Agency side: this business's people for a request, checked against the employer's requirements (as matched to
   * this business's credentials) and its own rules for each person (right to work, visa hours, leave, availability,
   * double booking, rest, end of employment). Ready first, then fewest hours that week. A different role name is a
   * warning, since businesses name roles differently. Reads only this business's rows.
   */
  @Roles(...OFFICE_ROLES)
  @Get('agency-requests/:id/people')
  people(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const { status, unmatched, people } = await peopleForRequest(db, t.tenantId, id);
      return {
        requestId: id, status, unmatched,
        ready: people.filter(p => p.eligible).length,
        people: people.map(p => ({ workerId: p.workerId, name: p.name, roles: p.roles, employmentType: p.employmentType, weekHours: p.weekHours,
          available: p.available, eligible: p.eligible, blocks: p.blocks, warnings: p.warnings })),
      };
    });
  }

  /**
   * Agency side: put one of this business's people forward for a request (`{ workerId }`). They must meet the
   * employer's requirements and this business's own rules (as on the list); then they go onto the employer's shift,
   * booked straight away or waiting for the employer's approval (the employer's choice for this agency), and the
   * request closes for every agency. The employer's office is emailed.
   */
  @Roles(...OFFICE_ROLES)
  @Post('agency-requests/:id/put-forward')
  @HttpCode(200)
  async putForward(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const workerId = text(body ?? {}, 'workerId', { required: true, max: 40 })!;
    if (!UUID.test(workerId)) throw new BadRequestException('Choose a person');
    const placed = await withTenant(this.pool, t.tenantId, async db => {
      const inboxRow = (await db.query<{ status: string; placed_name: string | null; closed_reason: string | null }>(
        'select status, placed_name, closed_reason from agency_inbox where id = $1', [id])).rows[0];
      if (!inboxRow) throw new NotFoundException('Request not found');
      if (inboxRow.placed_name) throw new ConflictException(`You have already put ${inboxRow.placed_name} forward for this ${(await wordsFor(db)).lower(T.shift)}`);
      if (inboxRow.status !== 'open') throw new BadRequestException(`This request has closed${inboxRow.closed_reason ? `: ${inboxRow.closed_reason}` : ''}`);
      // Lock the person first, so their own roster and another request can't take the same time meanwhile.
      if (!(await db.query('select 1 from workers where id = $1 for update', [workerId])).rowCount) throw new BadRequestException('Choose a person');
      const { status, people } = await peopleForRequest(db, t.tenantId, id, [workerId]);
      const p = people[0];
      if (!p) throw new BadRequestException('Choose a person');
      if (!p.eligible) throw new ConflictException(`${p.name} can't go: ${p.blocks.map(b => b.message).join('. ')}`);
      return (await db.query<{ employer_tenant_id: string; placement_id: string; booked: boolean }>(
        'select * from app_agency_put_forward($1, $2)', [id, workerId])).rows[0];
    }, actorOf(auth));
    await tellEmployer(this.pool, placed.employer_tenant_id, placed.placement_id);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [id])).rows[0];
      return { ...r, when: localWhen(r), placementState: r.placement ? placementWords(r.placement, r.employerName) : null, booked: placed.booked };
    });
  }

  /**
   * Agency side: take back the person this business put forward for a request (`{ reason? }`, which the employer
   * sees), before the shift starts. The employer's shift opens again with them shown as pulled out, and the
   * employer's office is emailed. Refused only when the employer has locked the week.
   */
  @Roles(...OFFICE_ROLES)
  @Post('agency-requests/:id/pull-out')
  @HttpCode(200)
  async pullOut(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body ?? {}, 'reason', { max: 300 });
    const done = await withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from agency_inbox where id = $1', [id])).rowCount) throw new NotFoundException('Request not found');
      return (await db.query<{ employer_tenant_id: string; placement_id: string }>('select * from app_agency_pull_out($1, $2)', [id, reason ?? null])).rows[0];
    }, actorOf(auth));
    await tellEmployerPulledOut(this.pool, done.employer_tenant_id, done.placement_id);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [id])).rows[0];
      return { ...r, when: localWhen(r), placementState: r.placement ? placementWords(r.placement, r.employerName) : null };
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
 * next agency when its time comes, and emails agencies about their people's placements changing. Off with AGENCY_ESCALATE=off or NOTIFY_DISPATCH=off (tests call runOnce).
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
      // What employers did with the people agencies put forward.
      await tellPlacementChanges(this.pool);
      return sent.length;
    } finally {
      this.running = false;
    }
  }
}
