import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { todayIn } from '../workforce/compliance.js';
import { actorOf, changeSummary, mondayOf, rosterMessage, weekState, type ChangeKind, type MyShift } from './publishing.js';
import { contacts } from './offer-replies.js';
import { queueNotification } from '../notifications/notify.js';
import { wordsFor } from '../terms/words.js';
import { shiftById } from './roster.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOG = 500;

function weekStartOf(v: Record<string, unknown>): string {
  const d = date(v, 'weekStart', { required: true })!;
  return mondayOf(d);
}

const facilityOf = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

interface WeekRow {
  facilityId: string; facilityName: string; timezone: string; version: number | null; publishedAt: string | null;
  publishedByName: string | null; changesSincePublish: number; shifts: number; changeRefusal: string | null; pendingRequests: number;
}

/** Each site's week: draft, live or history, when it was last published and what changed since. */
/**
 * Tells staff about a published week (David and Steve, 27 Oct). First publication: everyone on the site's week.
 * Published again: only people whose shifts changed since the last publication (including anyone taken off).
 * Returns the number of messages queued.
 */
async function tellStaff(db: PoolClient, t: Membership, userId: string, w: { facilityId: string; facilityName: string; version: number | null; publishedAt: string | null }, weekStart: string) {
  const version = (w.version ?? 0) + 1;
  const affected = w.version === null
    ? (await db.query<{ id: string }>(
      `select distinct sa.worker_id as id from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
        where s.facility_id = $1 and s.status <> 'cancelled' and s.needs_person and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
          and date_trunc('week', s.starts_at at time zone f.timezone)::date = $2`, [w.facilityId, weekStart])).rows
    : (await db.query<{ id: string }>(
      `select distinct coalesce(c.worker_id, sa.worker_id) as id from shift_changes c
         left join shift_assignments sa on c.worker_id is null and sa.shift_id = c.shift_id and sa.resource_kind = 'worker'
              and (sa.status in ('assigned', 'confirmed') or sa.ended_at >= $3)
        where c.facility_id = $1 and c.week_start = $2 and c.at > $3
          and c.kind in ('assigned', 'booked', 'confirmed', 'unassigned', 'pulled_out', 'cancelled', 'times_changed')`,
      [w.facilityId, weekStart, w.publishedAt])).rows;
  const ids = affected.map(r => r.id).filter(Boolean);
  if (!ids.length) return 0;
  const shifts = (await db.query<MyShift & { workerId: string }>(
    `select sa.worker_id as "workerId", to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
            to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart", to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
            s.role, a.name as "areaName", sa.status = 'confirmed' as confirmed
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id left join areas a on a.id = s.area_id
      where s.facility_id = $1 and s.status <> 'cancelled' and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
        and sa.worker_id = any($3) and date_trunc('week', s.starts_at at time zone f.timezone)::date = $2
      order by s.starts_at`, [w.facilityId, weekStart, ids])).rows;
  const who = await contacts(db, ids);
  const words = await wordsFor(db);
  let n = 0;
  for (const id of ids) {
    const c = who.get(id);
    if (!c) continue;
    const m = rosterMessage({ first: c.first, business: t.tenantName, site: w.facilityName, weekStart, updated: w.version !== null,
      shifts: shifts.filter(s => s.workerId === id) }, words);
    const key = `publish:${w.facilityId}:${weekStart}:v${version}:${id}`;
    if (c.email) { await queueNotification(db, t.tenantId, { channel: 'email', to: c.email, template: 'roster_published', subject: m.subject, body: m.email, workerId: id, dedupeKey: `${key}:email`, createdBy: userId }); n++; }
    if (c.phone) { await queueNotification(db, t.tenantId, { channel: 'sms', to: c.phone, template: 'roster_published', body: m.sms, workerId: id, dedupeKey: `${key}:sms`, createdBy: userId }); n++; }
  }
  return n;
}

async function weeks(db: PoolClient, weekStart: string, facilityId: string | null) {
  const rows = (await db.query<WeekRow>(
    `select f.id as "facilityId", f.name as "facilityName", f.timezone, p.version, p.published_at as "publishedAt",
            p.published_by_name as "publishedByName",
            (select count(*)::int from shift_changes c where c.facility_id = f.id and c.week_start = $1
                and p.published_at is not null and c.at > p.published_at) as "changesSincePublish",
            (select count(*)::int from shifts s where s.facility_id = f.id and s.status <> 'cancelled'
                and (s.starts_at at time zone f.timezone)::date between $1 and $1::date + 6) as shifts,
            -- Why the person asking couldn't change this week now (migration 0024), and requests waiting (0025).
            app_roster_change_refusal(f.id, $1) as "changeRefusal",
            (select count(*)::int from roster_change_requests r where r.facility_id = f.id and r.week_start = $1 and r.status = 'pending') as "pendingRequests"
       from facilities f
       left join lateral (select version, published_at, published_by_name from roster_publications rp
                           where rp.facility_id = f.id and rp.week_start = $1 order by version desc limit 1) p on true
      where ($2::uuid is null or f.id = $2)
      order by f.name`, [weekStart, facilityId])).rows;
  return rows.map(r => ({
    facilityId: r.facilityId,
    facilityName: r.facilityName,
    weekStart,
    state: weekState(weekStart, r.version !== null, todayIn(r.timezone)),
    version: r.version,
    publishedAt: r.publishedAt,
    publishedByName: r.publishedByName,
    changesSincePublish: r.changesSincePublish,
    shifts: r.shifts,
    changeRefusal: r.changeRefusal,
    pendingRequests: r.pendingRequests,
  }));
}

const LOG_COLS = `c.id::text as id, c.kind, c.detail, c.after_publish as "afterPublish", c.actor_name as "actorName", c.via, c.at,
  c.shift_id as "shiftId", s.role, a.name as "areaName", f.name as "facilityName",
  to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
  to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
  to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
  case when w.id is null then null else coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name end as "workerName",
  e.name as "equipmentName"`;
const LOG_FROM = `shift_changes c join shifts s on s.id = c.shift_id join facilities f on f.id = c.facility_id
  left join areas a on a.id = s.area_id left join workers w on w.id = c.worker_id left join equipment e on e.id = c.equipment_id`;

function withSummary(rows: Array<Record<string, unknown>>) {
  return rows.map(r => ({
    ...r,
    summary: changeSummary({
      kind: r.kind as ChangeKind, workerName: r.workerName as string | null, equipmentName: r.equipmentName as string | null,
      detail: r.detail as string | null, via: r.via as string,
    }),
  }));
}

/** Publishing the roster and its change log (Draft → Live → History, backlog item 2). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class PublishingController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Each site's state for the week starting `weekStart` (any date in the week works). */
  @Roles(...OFFICE_ROLES)
  @Get('roster/weeks')
  list(@Tenant() t: Membership, @Auth() auth: AuthContext, @Query() q: Record<string, string>) {
    const weekStart = weekStartOf(q);
    // With the person as actor, so changeRefusal says whether they could change the week themselves.
    return withTenant(this.pool, t.tenantId, db => weeks(db, weekStart, facilityOf(q.facilityId)), actorOf(auth));
  }

  /**
   * Publishes the week for one site, or every site when no site is given. Publishing again after changes
   * makes a new version. Past weeks can't be published, and a site with nothing new is left as it is.
   * Publishing doesn't send messages yet.
   */
  @Roles(...OFFICE_ROLES)
  @Post('roster/publish')
  publish(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const weekStart = weekStartOf(body ?? {});
    const facilityId = facilityOf(body?.facilityId);
    if (body?.facilityId && !facilityId) throw new BadRequestException('Choose a site');
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      // Locking the sites serialises two people publishing the same week.
      const sites = (await db.query<{ id: string }>(
        `select id from facilities where ($1::uuid is null or id = $1) order by id for update`, [facilityId])).rows;
      if (!sites.length) throw new BadRequestException('Choose a site');
      const before = await weeks(db, weekStart, facilityId);
      if (before.every(w => w.state === 'history')) throw new ConflictException('This week is over, so it can no longer be published');
      const toPublish = before.filter(w => w.state === 'draft' || (w.state === 'live' && w.changesSincePublish > 0));
      if (!toPublish.length) throw new ConflictException('Nothing has changed since this week was published');
      const notify = body?.notify !== false;
      let messages = 0;
      for (const w of toPublish) {
        if (notify) messages += await tellStaff(db, t, auth.userId, w, weekStart);
        await db.query(
          `insert into roster_publications(tenant_id, facility_id, week_start, version, published_by, published_by_name)
           values ($1, $2, $3, $4, $5, $6)`,
          [t.tenantId, w.facilityId, weekStart, (w.version ?? 0) + 1, auth.userId, actor.name]);
      }
      return { published: toPublish.length, messages, weeks: await weeks(db, weekStart, facilityId) };
    }, actor);
  }

  /** Everything that happened to the week's shifts, newest first. `sincePublish=true` for changes since it went live. */
  @Roles(...OFFICE_ROLES)
  @Get('roster/changes')
  changes(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const weekStart = weekStartOf(q);
    const facilityId = facilityOf(q.facilityId);
    return withTenant(this.pool, t.tenantId, async db => withSummary((await db.query(
      `select ${LOG_COLS} from ${LOG_FROM}
        where c.week_start = $1 and ($2::uuid is null or c.facility_id = $2) and (not $3 or c.after_publish)
        order by c.at desc, c.id desc limit ${MAX_LOG}`, [weekStart, facilityId, q.sincePublish === 'true'])).rows));
  }

  /** One shift's history, oldest first. */
  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/history')
  history(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await shiftById(db, id);
      return withSummary((await db.query(`select ${LOG_COLS} from ${LOG_FROM} where c.shift_id = $1 order by c.at, c.id`, [id])).rows);
    });
  }
}
