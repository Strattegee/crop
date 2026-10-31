import {
  BadRequestException, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { acceptOffer, declineOffer } from '../roster/offer-replies.js';
import { shiftLabel } from '../roster/bank-fill.js';
import { T, wordsFor } from '../terms/words.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { onboardingProgress } from '../workforce/onboarding.controller.js';
import { appAccessRefusal, appAccessState, removeAccessRefusal, MAX_MY_DAYS, myOnboardingLine, myShiftState, myStep, notLinkedMessage } from './worker-app.js';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

interface LinkedWorker { id: string; firstName: string; name: string; status: string }

/**
 * The person (worker row) the signed-in account belongs to in this business, or null.
 * The first time, the link comes from the invitation the office sent for that person (accepted at a verified
 * sign-in), and is then kept on workers.user_id.
 */
export async function linkedWorker(db: PoolClient, userId: string): Promise<LinkedWorker | null> {
  const cols = `id, coalesce(preferred_name, first_name) as "firstName", coalesce(preferred_name, first_name) || ' ' || last_name as name, status`;
  const linked = (await db.query<LinkedWorker>(`select ${cols} from workers where user_id = $1`, [userId])).rows[0];
  if (linked) return linked;
  const inv = (await db.query<{ worker_id: string }>(
    `select i.worker_id from invitations i join workers w on w.id = i.worker_id
      where i.accepted_user_id = $1 and w.user_id is null and w.status <> 'agency'
      order by i.accepted_at desc limit 1`, [userId])).rows[0];
  if (!inv) return null;
  await db.query('update workers set user_id = $1, updated_at = now() where id = $2 and user_id is null', [userId, inv.worker_id]);
  return (await db.query<LinkedWorker>(`select ${cols} from workers where id = $1 and user_id = $2`, [inv.worker_id, userId])).rows[0] ?? null;
}

export async function requireLinked(db: PoolClient, auth: AuthContext): Promise<LinkedWorker> {
  const w = await linkedWorker(db, auth.userId);
  if (!w) throw new NotFoundException(notLinkedMessage(auth.tenant!.tenantName));
  return w;
}

const MY_SHIFT_COLS = `s.id, s.role, f.name as site, a.name as area, f.timezone, s.starts_at as "startsAt", s.ends_at as "endsAt",
  to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as date,
  to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as start,
  to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "end", s.break_minutes as "breakMinutes",
  coalesce((select json_agg(d.name order by lower(d.name)) from shift_duty_links dl join shift_duties d on d.id = dl.duty_id
             where dl.shift_id = s.id), '[]'::json) as duties`;

type ShiftRow = { id: string; role: string; site: string; area: string | null; timezone: string; startsAt: Date; endsAt: Date;
  date: string; start: string; end: string; breakMinutes: number; duties: string[] };
const label = (r: ShiftRow) => shiftLabel({ role: r.role, localDate: r.date, localStart: r.start, localEnd: r.end, facilityName: r.site, areaName: r.area });

/**
 * Giving someone the worker app (office). Owners and admins invite the person's email as a worker of the business;
 * they get in at their first sign-in where the identity provider has verified that email.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('workers/:workerId/app-access')
export class AppAccessController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async state(db: PoolClient, workerId: string) {
    const w = (await db.query<{ id: string; user_id: string | null; email: string | null; status: string; name: string }>(
      `select id, user_id, email, status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1`, [workerId])).rows[0];
    if (!w) throw new NotFoundException('Worker not found');
    // Linked already, or an accepted invitation for them waiting to be linked at their first use of the app.
    const userId = w.user_id ?? (await db.query<{ u: string }>(
      `select accepted_user_id as u from invitations where worker_id = $1 and accepted_user_id is not null order by accepted_at desc limit 1`,
      [workerId])).rows[0]?.u ?? null;
    const memberRole = userId ? (await db.query<{ role: string }>('select role from memberships where user_id = $1', [userId])).rows[0]?.role ?? null : null;
    const member = !!memberRole;
    const pending = (await db.query<{ email: string; created_at: Date }>(
      `select email, created_at from invitations where worker_id = $1 and accepted_at is null order by created_at desc limit 1`, [workerId])).rows[0];
    return {
      state: appAccessState({ member, pendingInvite: !!pending }),
      email: pending?.email ?? w.email,
      invitedAt: pending?.created_at ?? null,
      refusal: member || pending ? null : appAccessRefusal(w),
      userId, memberRole, name: w.name,
    };
  }

  private async view(db: PoolClient, workerId: string) {
    const { userId: _u, memberRole: _r, name: _n, ...shown } = await this.state(db, workerId);
    return shown;
  }

  @Roles(...OFFICE_ROLES)
  @Get()
  get(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, db => this.view(db, workerId));
  }

  @Roles('owner', 'admin')
  @Post()
  give(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = (await db.query<{ email: string | null; status: string; name: string }>(
        `select email, status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`, [workerId])).rows[0];
      if (!w) throw new NotFoundException('Worker not found');
      const now = await this.state(db, workerId);
      if (now.state === 'active') throw new ConflictException(`${w.name} already has the app`);
      const refusal = appAccessRefusal(w);
      if (refusal) throw new ConflictException(refusal);
      // One waiting invitation per email: if one is already waiting (for any role), it now also links this person.
      const waiting = (await db.query<{ id: string; worker_id: string | null }>(
        'select id, worker_id from invitations where email = $1 and accepted_at is null for update', [w.email])).rows[0];
      if (waiting && waiting.worker_id && waiting.worker_id !== workerId) throw new ConflictException('Someone else is already invited with this email');
      if (waiting) await db.query('update invitations set worker_id = $2 where id = $1', [waiting.id, workerId]);
      else await db.query(`insert into invitations(tenant_id, email, role, worker_id) values ($1, $2, 'worker', $3)`, [t.tenantId, w.email, workerId]);
      return this.view(db, workerId);
    });
  }

  /**
   * Takes the app away (owners and admins, David 31 Oct): ends their worker sign-in to this business, or cancels the
   * invitation still waiting. Their record, shifts and history stay; the audit log records who did it; the app stops
   * working for them at their next request. They can be given the app again (with the same or a new email).
   */
  @Roles('owner', 'admin')
  @Post('remove')
  @HttpCode(200)
  remove(@Tenant() t: Membership, @Param('workerId', ParseUUIDPipe) workerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1 for update', [workerId])).rowCount) throw new NotFoundException('Worker not found');
      const now = await this.state(db, workerId);
      const refusal = removeAccessRefusal(now);
      if (refusal) throw new ConflictException(refusal);
      if (now.userId) await db.query(`delete from memberships where user_id = $1 and role = 'worker'`, [now.userId]);
      await db.query('delete from invitations where worker_id = $1 and accepted_at is null', [workerId]);
      // Unlinked, so giving the app again (perhaps to a new email) links whoever accepts that invitation.
      await db.query('update workers set user_id = null, updated_at = now() where id = $1 and user_id is not null', [workerId]);
      return this.view(db, workerId);
    });
  }
}

/**
 * The person's own onboarding, worded for them (null when they aren't being onboarded). Shared by GET /my/onboarding
 * and GET /my/credentials (credential steps still to do are things they can add).
 */
export async function myOnboarding(db: PoolClient, tenantId: string, workerId: string, credentialsWord = 'Credentials') {
  const live = (await db.query<{ id: string }>(
    'select id from worker_onboardings where worker_id = $1 and finished_at is null', [workerId])).rows[0];
  if (!live) return null;
  const p = await onboardingProgress(db, tenantId, live.id);
  const steps = p.steps.map(s => myStep(s, credentialsWord));
  return {
    checklistName: p.checklistName, startedAt: p.startedAt,
    done: p.summary.done, total: p.summary.total, ready: p.summary.ready,
    line: myOnboardingLine(p.summary.done, p.summary.total),
    steps,
  };
}

/** The worker app's own view (any signed-in member linked to a person here): their shifts and offers. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('my')
export class MyController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Get()
  me(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const words = await wordsFor(db);
      const settings = await loadSettings(db, t.tenantId);
      return {
        business: t.tenantName, firstName: w.firstName, name: w.name, today: todayIn(settings.timezone),
        word: { one: words.one(T.shift), many: words.many(T.shift), lower: words.lower(T.shift), lowerMany: words.lower(T.shift, true) },
        credentialWord: { one: words.one(T.credential), many: words.many(T.credential), lower: words.lower(T.credential), lowerMany: words.lower(T.credential, true) },
      };
    });
  }

  /**
   * Shifts the person is on, from today (business time) for 28 days by default. Only weeks the office has
   * published, plus any shift the person accepted an offer for, so a draft roster isn't shown before it's ready.
   */
  @Get('shifts')
  shifts(@Tenant() t: Membership, @Auth() auth: AuthContext, @Query('from') qFrom?: string, @Query('to') qTo?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const from = date({ startDate: qFrom }, 'startDate') ?? todayIn((await loadSettings(db, t.tenantId)).timezone);
      const to = date({ endDate: qTo }, 'endDate') ?? addDays(from, 27);
      if (to < from) throw new BadRequestException('The end date is before the start date');
      if (daysBetween(from, to) >= MAX_MY_DAYS) throw new BadRequestException(`Choose ${MAX_MY_DAYS} days or fewer`);
      const rows = (await db.query<ShiftRow & { assignmentStatus: string }>(
        `select ${MY_SHIFT_COLS}, sa.status as "assignmentStatus"
           from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
           left join areas a on a.id = s.area_id
          where sa.worker_id = $1 and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
            and (s.starts_at at time zone f.timezone)::date between $2 and $3
            and (exists (select 1 from roster_publications p where p.facility_id = s.facility_id
                          and p.week_start = date_trunc('week', s.starts_at at time zone f.timezone)::date)
                 or exists (select 1 from shift_offers o where o.shift_id = s.id and o.worker_id = $1 and o.status = 'accepted'))
          order by s.starts_at`, [w.id, from, to])).rows;
      return {
        from, to,
        shifts: rows.map(({ assignmentStatus, ...r }) => ({ ...r, label: label(r), state: myShiftState(assignmentStatus) })),
      };
    });
  }

  /**
   * Getting started: the person's onboarding checklist while they are being onboarded, worded for them (what they can
   * add in the app, what is waiting for the office). `onboarding` is null otherwise.
   */
  @Get('onboarding')
  onboarding(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const words = await wordsFor(db);
      return { onboarding: await myOnboarding(db, t.tenantId, w.id, words.many(T.credential)) };
    });
  }

  /** Offers waiting for the person's answer (pending, not expired, the shift still open and not started). */
  @Get('offers')
  offers(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const w = await requireLinked(db, auth);
      const rows = (await db.query<ShiftRow & { offerId: string; expiresAt: Date | null; offeredAt: Date }>(
        `select o.id as "offerId", o.expires_at as "expiresAt", o.created_at as "offeredAt", ${MY_SHIFT_COLS}
           from shift_offers o join shifts s on s.id = o.shift_id join facilities f on f.id = s.facility_id
           left join areas a on a.id = s.area_id
          where o.worker_id = $1 and o.status = 'pending' and (o.expires_at is null or o.expires_at > now())
            and s.status = 'open' and s.starts_at > now()
          order by s.starts_at`, [w.id])).rows;
      return {
        offers: rows.map(({ offerId, expiresAt, offeredAt, ...r }) => ({ id: offerId, expiresAt, offeredAt, shift: { ...r, label: label(r) } })),
      };
    });
  }

  private async ownOffer(db: PoolClient, workerId: string, offerId: string) {
    if (!(await db.query('select 1 from shift_offers where id = $1 and worker_id = $2', [offerId, workerId])).rowCount) {
      throw new NotFoundException('Offer not found');
    }
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reply(t, auth, id, async db => {
      const r = await acceptOffer(db, { tenantId: t.tenantId, tenantName: t.tenantName }, id, auth.userId, 'app');
      return { status: 'accepted', shiftId: r.shiftId };
    });
  }

  @Post('offers/:id/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reply(t, auth, id, async db => {
      const shiftId = await declineOffer(db, id, auth.userId, 'app');
      return { status: 'declined', shiftId };
    });
  }

  private async reply<R>(t: Membership, auth: AuthContext, offerId: string, fn: (db: PoolClient) => Promise<R>) {
    // The person is found first (in its own transaction, as linking may write), then the reply runs with them as the actor.
    const w = await withTenant(this.pool, t.tenantId, db => requireLinked(db, auth));
    return withTenant(this.pool, t.tenantId, async db => {
      await this.ownOffer(db, w.id, offerId);
      return fn(db);
    }, { id: auth.userId, name: w.name, via: 'app', role: t.role });
  }
}
