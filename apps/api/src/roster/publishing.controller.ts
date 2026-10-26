import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { todayIn } from '../workforce/compliance.js';
import { actorOf, changeSummary, mondayOf, weekState, type ChangeKind } from './publishing.js';
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
  publishedByName: string | null; changesSincePublish: number; shifts: number;
}

/** Each site's week: draft, live or history, when it was last published and what changed since. */
async function weeks(db: PoolClient, weekStart: string, facilityId: string | null) {
  const rows = (await db.query<WeekRow>(
    `select f.id as "facilityId", f.name as "facilityName", f.timezone, p.version, p.published_at as "publishedAt",
            p.published_by_name as "publishedByName",
            (select count(*)::int from shift_changes c where c.facility_id = f.id and c.week_start = $1
                and p.published_at is not null and c.at > p.published_at) as "changesSincePublish",
            (select count(*)::int from shifts s where s.facility_id = f.id and s.status <> 'cancelled'
                and (s.starts_at at time zone f.timezone)::date between $1 and $1::date + 6) as shifts
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
  list(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const weekStart = weekStartOf(q);
    return withTenant(this.pool, t.tenantId, db => weeks(db, weekStart, facilityOf(q.facilityId)));
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
      for (const w of toPublish) {
        await db.query(
          `insert into roster_publications(tenant_id, facility_id, week_start, version, published_by, published_by_name)
           values ($1, $2, $3, $4, $5, $6)`,
          [t.tenantId, w.facilityId, weekStart, (w.version ?? 0) + 1, auth.userId, actor.name]);
      }
      return { published: toPublish.length, weeks: await weeks(db, weekStart, facilityId) };
    });
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
