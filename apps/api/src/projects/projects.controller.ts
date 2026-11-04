import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { acrossSites, withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, SITE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { date, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { fmtDate, mondayOf } from '../roster/eligibility.js';
import { currentChecks } from '../roster/equipment-data.js';
import { overallCheckState } from '../roster/equipment.js';
import { isLow } from '../items/items.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import {
  allocationClashMessage, clashingAllocation, PROJECT_STATUSES, projectDates, rangeLine, rangeProblem, STATUS_LABEL, TEAM_ROLES,
  type AllocationFact, type DateRange, type ProjectStatus,
} from './projects.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The site's time zone and today's date there. 404 when it isn't the business's. */
async function siteToday(db: PoolClient, facilityId: string): Promise<{ zone: string; today: string; name: string }> {
  const f = (await db.query<{ timezone: string; name: string }>('select timezone, name from facilities where id = $1', [facilityId])).rows[0];
  if (!f) throw new NotFoundException('{Site} not found');
  return { zone: f.timezone, today: todayIn(f.timezone), name: f.name };
}

async function areaOf(db: PoolClient, body: Record<string, unknown>, facilityId: string): Promise<string | null | undefined> {
  if (!body || !('areaId' in body)) return undefined;
  const id = text(body, 'areaId', { max: 40 });
  if (id === null) return null;
  if (!UUID.test(id) || !(await db.query('select 1 from areas where id = $1 and facility_id = $2', [id, facilityId])).rowCount) {
    throw new BadRequestException('Choose {an area} of that {site}');
  }
  return id;
}

/** "current" (covers today), "upcoming" (starts later) or "ended". */
const stateOf = (r: DateRange, today: string) => (r.from > today ? 'upcoming' : r.to !== null && r.to < today ? 'ended' : 'current');

const MEMBER_COLS = `m.id, m.facility_id as "facilityId", f.name as "siteName", f.kind as "siteKind", f.status as "siteStatus", f.code as "siteCode",
  m.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name, w.roles, w.status as "workerStatus",
  m.team_role as "teamRole", m.area_id as "areaId", a.name as "areaName",
  to_char(m.starts_on, 'YYYY-MM-DD') as "from", to_char(m.ends_on, 'YYYY-MM-DD') as "to", f.timezone`;
const MEMBER_FROM = `site_members m join facilities f on f.id = m.facility_id join workers w on w.id = m.worker_id left join areas a on a.id = m.area_id`;
type MemberRow = { id: string; facilityId: string; siteName: string; siteKind: string; siteStatus: ProjectStatus | null; siteCode: string | null;
  workerId: string; name: string; roles: string[]; workerStatus: string; teamRole: string; areaId: string | null; areaName: string | null;
  from: string; to: string | null; timezone: string };
const memberOut = ({ timezone, ...m }: MemberRow) => {
  const today = todayIn(timezone);
  return { ...m, startsOn: m.from, endsOn: m.to, state: stateOf(m, today), line: rangeLine(m, today) };
};

const ALLOC_COLS = `x.id, x.equipment_id as "equipmentId", e.name as "equipmentName", et.name as "typeName", e.status as "equipmentStatus",
  x.facility_id as "facilityId", f.name as "siteName", f.kind as "siteKind", x.area_id as "areaId", a.name as "areaName", x.note,
  to_char(x.starts_on, 'YYYY-MM-DD') as "from", to_char(x.ends_on, 'YYYY-MM-DD') as "to", f.timezone`;
const ALLOC_FROM = `equipment_site_allocations x join equipment e on e.id = x.equipment_id join equipment_types et on et.id = e.equipment_type_id
  join facilities f on f.id = x.facility_id left join areas a on a.id = x.area_id`;
type AllocRow = { id: string; equipmentId: string; equipmentName: string; typeName: string; equipmentStatus: string; facilityId: string; siteName: string;
  siteKind: string; areaId: string | null; areaName: string | null; note: string | null; from: string; to: string | null; timezone: string };
const allocOut = ({ timezone, ...x }: AllocRow) => {
  const today = todayIn(timezone);
  return { ...x, startsOn: x.from, endsOn: x.to, state: stateOf(x, today), line: rangeLine(x, today) };
};

/** The equipment's other live allocations (any site). */
async function liveAllocations(db: PoolClient, equipmentId: string): Promise<AllocationFact[]> {
  return (await db.query<AllocationFact>(
    `select a.id, a.facility_id as "facilityId", f.name as "siteName", to_char(a.starts_on, 'YYYY-MM-DD') as "from", to_char(a.ends_on, 'YYYY-MM-DD') as "to"
       from equipment_site_allocations a join facilities f on f.id = a.facility_id
      where a.equipment_id = $1 and a.removed_at is null order by a.starts_on`, [equipmentId])).rows;
}

/**
 * Bookings of the equipment on shifts at other sites, not yet ended, whose local start date falls in the range: an
 * allocation can't start while they stand (they would become double bookings across projects).
 */
async function bookingsElsewhere(db: PoolClient, equipmentId: string, facilityId: string, r: DateRange): Promise<{ label: string; siteName: string }[]> {
  return (await db.query<{ label: string; siteName: string }>(
    `select to_char(s.starts_at at time zone f.timezone, 'Dy DD Mon HH24:MI') as label, f.name as "siteName"
       from shift_assignments sa join shifts s on s.id = sa.shift_id join facilities f on f.id = s.facility_id
      where sa.equipment_id = $1 and sa.resource_kind = 'equipment' and sa.status in ('assigned', 'confirmed') and s.status <> 'cancelled'
        and s.facility_id <> $2 and s.ends_at > now()
        and (s.starts_at at time zone f.timezone)::date >= $3 and ($4::date is null or (s.starts_at at time zone f.timezone)::date <= $4)
      order by s.starts_at`, [equipmentId, facilityId, r.from, r.to])).rows;
}

function bookingsMessage(name: string, list: { label: string; siteName: string }[]): string {
  const first = list[0];
  return `${name} is booked on ${list.length === 1 ? '1 {shift}' : `${list.length} {shifts}`} at other places in those dates `
    + `(first: ${first.label} at ${first.siteName}). Take it off ${list.length === 1 ? 'that {shift}' : 'those {shifts}'} first.`;
}

/** Checks a new or changed allocation, with plain reasons (409). */
async function checkAllocation(db: PoolClient, equipment: { id: string; name: string }, facilityId: string, r: DateRange, exceptId?: string) {
  const p = rangeProblem(r);
  if (p) throw new BadRequestException(p);
  // Every site (migration 0086): someone limited to some sites must still be stopped by another site's allocation or booking.
  const clash = clashingAllocation(r, await acrossSites(db, () => liveAllocations(db, equipment.id)), exceptId);
  if (clash) throw new ConflictException(allocationClashMessage(equipment.name, clash));
  const booked = await acrossSites(db, () => bookingsElsewhere(db, equipment.id, facilityId, r));
  if (booked.length) throw new ConflictException(bookingsMessage(equipment.name, booked));
}

/**
 * Projects (David and Steve, 4 Nov): a project is a site of kind `project` (set with POST/PATCH /facilities). This
 * controller lists them with what the office needs at a glance, and gives one project's overview.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('projects')
export class ProjectsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /**
   * Every project (archived ones only with `status=archived` or `status=all`), with its team size today, its
   * {shifts} this week (Monday to Sunday in the project's dates) and those still unfilled in the next 7 days.
   */
  @Roles(...SITE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Query('status') statusQ?: string) {
    const status = statusQ === 'all' ? 'all' : (PROJECT_STATUSES as readonly string[]).includes(statusQ ?? '') ? statusQ! : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const rows = (await db.query<{
        id: string; name: string; code: string | null; status: ProjectStatus; startsOn: string | null; endsOn: string | null; clientName: string | null;
        managerName: string | null; officeName: string | null; timezone: string; teamSize: number; shiftsThisWeek: number; unfilledThisWeek: number;
        unfilledNext7: number; equipmentCount: number; areaCount: number;
      }>(
        `with p as (
           select f.*, (now() at time zone f.timezone)::date as today from facilities f
            where f.kind = 'project' and ($1::text = 'all' or ($1::text is null and f.status <> 'archived') or f.status = $1)
         )
         select p.id, p.name, p.code, p.status, to_char(p.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(p.ends_on, 'YYYY-MM-DD') as "endsOn",
                c.name as "clientName", o.name as "officeName", p.timezone,
                (select t.name from app_office_team() t where t.user_id = p.manager_user_id) as "managerName",
                (select count(*)::int from site_members m where m.facility_id = p.id and m.removed_at is null
                   and m.starts_on <= p.today and (m.ends_on is null or m.ends_on >= p.today)) as "teamSize",
                (select count(*)::int from shifts s where s.facility_id = p.id and s.needs_person and s.status <> 'cancelled'
                   and (s.starts_at at time zone p.timezone)::date between date_trunc('week', p.today)::date and date_trunc('week', p.today)::date + 6) as "shiftsThisWeek",
                (select count(*)::int from shifts s where s.facility_id = p.id and s.needs_person and s.status = 'open'
                   and (s.starts_at at time zone p.timezone)::date between date_trunc('week', p.today)::date and date_trunc('week', p.today)::date + 6) as "unfilledThisWeek",
                (select count(*)::int from shifts s where s.facility_id = p.id and s.needs_person and s.status = 'open'
                   and s.ends_at > now() and s.starts_at < now() + interval '7 days') as "unfilledNext7",
                (select count(*)::int from equipment_site_allocations x where x.facility_id = p.id and x.removed_at is null
                   and x.starts_on <= p.today and (x.ends_on is null or x.ends_on >= p.today)) as "equipmentCount",
                (select count(*)::int from areas a where a.facility_id = p.id and a.active) as "areaCount"
           from p left join clients c on c.id = p.client_id left join offices o on o.id = p.office_id
          order by case p.status when 'active' then 0 when 'on_hold' then 1 when 'planned' then 2 when 'completed' then 3 else 4 end,
                   lower(p.name)`, [status])).rows;
      return rows.map(({ timezone, ...r }) => ({ ...r, statusLabel: STATUS_LABEL[r.status], dates: projectDates(r.startsOn, r.endsOn, todayIn(timezone).slice(0, 4)) }));
    });
  }

  /**
   * One project at a glance: the site's details, its work areas, the team today and coming, today's and tomorrow's
   * {shifts} (rostered, filled, unfilled), the equipment on it (with its state) and low stock there.
   */
  @Roles(...SITE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const p = (await db.query<{ id: string; name: string; kind: string; code: string | null; description: string | null; status: ProjectStatus | null;
        startsOn: string | null; endsOn: string | null; clientId: string | null; clientName: string | null; officeId: string | null; officeName: string | null;
        managerUserId: string | null; managerName: string | null; timezone: string; addressLine: string | null; suburb: string | null; state: string | null;
        postcode: string | null; country: string; active: boolean }>(
        `select f.id, f.name, f.kind, f.code, f.description, f.status, to_char(f.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(f.ends_on, 'YYYY-MM-DD') as "endsOn",
                f.client_id as "clientId", c.name as "clientName", f.office_id as "officeId", o.name as "officeName", f.manager_user_id as "managerUserId",
                (select t.name from app_office_team() t where t.user_id = f.manager_user_id) as "managerName", f.timezone,
                f.address_line as "addressLine", f.suburb, f.state, f.postcode, f.country, f.active
           from facilities f left join clients c on c.id = f.client_id left join offices o on o.id = f.office_id where f.id = $1`, [id])).rows[0];
      if (!p) throw new NotFoundException('{Site} not found');
      const today = todayIn(p.timezone);
      const tomorrow = addDays(today, 1);
      const areas = (await db.query(`select id, name, specialty, active from areas where facility_id = $1 order by active desc, name`, [id])).rows;
      const team = (await db.query<MemberRow>(
        `select ${MEMBER_COLS} from ${MEMBER_FROM} where m.facility_id = $1 and m.removed_at is null and (m.ends_on is null or m.ends_on >= $2)
          order by m.team_role, lower(w.last_name), lower(w.first_name)`, [id, today])).rows.map(memberOut);
      const days = (await db.query<{ day: string; rostered: number; filled: number; unfilled: number }>(
        `select to_char(d.day, 'YYYY-MM-DD') as day, count(s.id)::int as rostered,
                count(s.id) filter (where s.status in ('assigned', 'booked'))::int as filled,
                count(s.id) filter (where s.status = 'open')::int as unfilled
           from unnest(array[$2::date, $3::date]) as d(day)
           left join shifts s on s.facility_id = $1 and s.needs_person and s.status <> 'cancelled'
                and (s.starts_at at time zone $4)::date = d.day
          group by d.day order by d.day`, [id, today, tomorrow, p.timezone])).rows;
      const equipment = (await db.query<AllocRow>(
        `select ${ALLOC_COLS} from ${ALLOC_FROM} where x.facility_id = $1 and x.removed_at is null and (x.ends_on is null or x.ends_on >= $2)
          order by x.starts_on, e.name`, [id, today])).rows.map(allocOut);
      const settings = await loadSettings(db, t.tenantId);
      const checks = await currentChecks(db, equipment.map(e => e.equipmentId));
      const equipmentRows = equipment.map(e => ({
        ...e, checks: checks.get(e.equipmentId) ?? [], checkState: overallCheckState(checks.get(e.equipmentId) ?? [], today, settings.expiringWindowDays),
      }));
      const stock = (await db.query<{ itemId: string; name: string; unit: string; onHand: number; reorderLevel: number | null }>(
        `select i.id as "itemId", i.name, i.unit, coalesce(sum(m.quantity), 0)::float8 as "onHand", i.reorder_level::float8 as "reorderLevel"
           from items i join stock_movements m on m.item_id = i.id
          where i.tracks_stock and i.active and m.facility_id = $1 group by i.id order by i.name`, [id])).rows
        .map(s => ({ ...s, low: isLow(s.onHand, s.reorderLevel) }));
      const weekFrom = mondayOf(today);
      const week = (await db.query<{ shifts: number; unfilled: number }>(
        `select count(*)::int as shifts, count(*) filter (where status = 'open')::int as unfilled from shifts s
          where s.facility_id = $1 and s.needs_person and s.status <> 'cancelled' and (s.starts_at at time zone $2)::date between $3 and $4`,
        [id, p.timezone, weekFrom, addDays(weekFrom, 6)])).rows[0];
      return {
        ...p, statusLabel: p.status ? STATUS_LABEL[p.status] : null, dates: projectDates(p.startsOn, p.endsOn, today.slice(0, 4)), today, weekStart: weekFrom,
        areas, team, days, week, equipment: equipmentRows, stock,
        counts: {
          team: team.filter(m => m.state === 'current').length,
          equipment: equipmentRows.filter(e => e.state === 'current').length,
          equipmentUnavailable: equipmentRows.filter(e => e.state === 'current' && e.equipmentStatus !== 'active').length,
          equipmentChecks: equipmentRows.filter(e => e.state === 'current' && e.checkState !== 'ok').length,
          lowStock: stock.filter(s => s.low).length,
        },
      };
    });
  }
}

/** The team of a site or project (`site_members`), separate from who is on which {shift}. */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class SiteTeamController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Current and upcoming members (`all=true` adds those whose time on the team has ended). */
  @Roles(...SITE_ROLES)
  @Get('facilities/:id/team')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Query('all') all?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const { today } = await siteToday(db, id);
      return (await db.query<MemberRow>(
        `select ${MEMBER_COLS} from ${MEMBER_FROM} where m.facility_id = $1 and m.removed_at is null and ($3 or m.ends_on is null or m.ends_on >= $2)
          order by m.team_role, lower(w.last_name), lower(w.first_name), m.starts_on desc`, [id, today, all === 'true'])).rows.map(memberOut);
    });
  }

  /** Puts someone on the team: `workerId`, `teamRole` (supervisor | worker), `areaId`, `startsOn` (default today), `endsOn`. */
  @Roles(...SITE_ROLES)
  @Post('facilities/:id/team')
  add(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const workerId = text(body, 'workerId', { required: true, max: 40 })!;
    if (!UUID.test(workerId)) throw new BadRequestException('Choose a person');
    const teamRole = oneOf(body, 'teamRole', TEAM_ROLES) ?? 'worker';
    return withTenant(this.pool, t.tenantId, async db => {
      const { today } = await siteToday(db, id);
      const w = (await db.query<{ status: string }>('select status from workers where id = $1', [workerId])).rows[0];
      if (!w) throw new BadRequestException('Choose a person');
      if (!['active', 'onboarding'].includes(w.status)) throw new BadRequestException('Only your own active people (or people being onboarded) can join a team');
      const areaId = (await areaOf(db, body, id)) ?? null;
      const r = { from: date(body, 'startsOn') ?? today, to: date(body, 'endsOn') };
      const p = rangeProblem(r);
      if (p) throw new BadRequestException(p);
      const row = (await db.query<{ id: string }>(
        `insert into site_members(tenant_id, facility_id, worker_id, area_id, team_role, starts_on, ends_on, added_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [t.tenantId, id, workerId, areaId, teamRole, r.from, r.to, auth.userId])).rows[0];
      return memberOut((await db.query<MemberRow>(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.id = $1`, [row.id])).rows[0]);
    });
  }

  /** Changes someone's role, area or last day on the team (`endsOn` null = no end). */
  @Roles(...SITE_ROLES)
  @Patch('site-members/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const has = (k: string) => Boolean(body && k in body);
    const teamRole = oneOf(body, 'teamRole', TEAM_ROLES);
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = (await db.query<{ facility_id: string; starts_on: string; ends_on: string | null }>(
        `select facility_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
           from site_members where id = $1 and removed_at is null`, [id])).rows[0];
      if (!cur) throw new NotFoundException('Team member not found');
      const areaId = await areaOf(db, body, cur.facility_id);
      const endsOn = has('endsOn') ? date(body, 'endsOn') : cur.ends_on;
      const p = rangeProblem({ from: cur.starts_on, to: endsOn });
      if (p) throw new BadRequestException(p);
      await db.query(
        `update site_members set team_role = coalesce($2, team_role), area_id = case when $3 then $4::uuid else area_id end, ends_on = $5 where id = $1`,
        [id, teamRole, areaId !== undefined, areaId ?? null, endsOn]);
      return memberOut((await db.query<MemberRow>(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.id = $1`, [id])).rows[0]);
    });
  }

  /** Takes a mistaken entry off the team list (kept on file as removed). Someone who left gets an end date instead. */
  @Roles(...SITE_ROLES)
  @Post('site-members/:id/remove')
  remove(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { max: 200 });
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query('update site_members set removed_at = now(), removed_reason = $2 where id = $1 and removed_at is null', [id, reason]);
      if (!r.rowCount) throw new NotFoundException('Team member not found');
      return { removed: true };
    });
  }

  /** The teams a person is on (current and upcoming; `all=true` adds ended ones): one person record across projects. */
  @Roles(...SITE_ROLES)
  @Get('workers/:id/teams')
  teams(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Query('all') all?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1', [id])).rowCount) throw new NotFoundException('Person not found');
      return (await db.query<MemberRow>(
        `select ${MEMBER_COLS} from ${MEMBER_FROM} where m.worker_id = $1 and m.removed_at is null
           and ($2 or m.ends_on is null or m.ends_on >= (now() at time zone f.timezone)::date)
          order by m.starts_on desc, f.name`, [id, all === 'true'])).rows.map(memberOut);
    });
  }
}

/**
 * Equipment given to a site or project for a period (`equipment_site_allocations`). While it is allocated, booking it
 * onto a {shift} anywhere else is a hard block (`equipmentForShift`). Moving it ends one allocation and starts the next.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class EquipmentAllocationsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private one(db: PoolClient, id: string) {
    return db.query<AllocRow>(`select ${ALLOC_COLS} from ${ALLOC_FROM} where x.id = $1`, [id]).then(r => allocOut(r.rows[0]));
  }

  /** Equipment allocated to a site (current and upcoming; `all=true` adds ended ones). */
  @Roles(...SITE_ROLES)
  @Get('facilities/:id/equipment')
  atSite(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Query('all') all?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const { today } = await siteToday(db, id);
      return (await db.query<AllocRow>(
        `select ${ALLOC_COLS} from ${ALLOC_FROM} where x.facility_id = $1 and x.removed_at is null and ($3 or x.ends_on is null or x.ends_on >= $2)
          order by x.starts_on desc, e.name`, [id, today, all === 'true'])).rows.map(allocOut);
    });
  }

  /** Where a piece of equipment has been and is going (every live allocation, latest first). */
  @Roles(...SITE_ROLES)
  @Get('equipment/:id/allocations')
  forEquipment(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from equipment where id = $1', [id])).rowCount) throw new NotFoundException('{Equipment} not found');
      return (await db.query<AllocRow>(
        `select ${ALLOC_COLS} from ${ALLOC_FROM} where x.equipment_id = $1 and x.removed_at is null order by x.starts_on desc`, [id])).rows.map(allocOut);
    });
  }

  /**
   * Allocates equipment to a site: `facilityId`, `areaId`, `startsOn` (default today there), `endsOn` (null = until
   * further notice), `note`. Refused for retired equipment, an overlapping allocation, or bookings at other places in
   * those dates.
   */
  @Roles(...SITE_ROLES)
  @Post('equipment/:id/allocations')
  add(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const facilityId = text(body, 'facilityId', { required: true, max: 40 })!;
    if (!UUID.test(facilityId)) throw new BadRequestException('Choose {a site}');
    return withTenant(this.pool, t.tenantId, async db => {
      const e = (await db.query<{ id: string; name: string; status: string }>('select id, name, status from equipment where id = $1 for update', [id])).rows[0];
      if (!e) throw new NotFoundException('{Equipment} not found');
      if (e.status === 'retired') throw new ConflictException(`${e.name} is retired`);
      const site = (await db.query<{ timezone: string; active: boolean }>('select timezone, active from facilities where id = $1', [facilityId])).rows[0];
      if (!site?.active) throw new BadRequestException('Choose {a site}');
      const areaId = (await areaOf(db, body, facilityId)) ?? null;
      const r = { from: date(body, 'startsOn') ?? todayIn(site.timezone), to: date(body, 'endsOn') };
      await checkAllocation(db, e, facilityId, r);
      const row = (await db.query<{ id: string }>(
        `insert into equipment_site_allocations(tenant_id, equipment_id, facility_id, area_id, starts_on, ends_on, note, added_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [t.tenantId, id, facilityId, areaId, r.from, r.to, text(body, 'note', { max: 300 }), auth.userId])).rows[0];
      return this.one(db, row.id);
    });
  }

  /** Sets the last day of an allocation (`lastDay`, or null = until further notice). Extending it is checked like a new one. */
  @Roles(...SITE_ROLES)
  @Post('equipment-allocations/:id/end')
  end(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const lastDay = date(body, 'lastDay');
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = await this.live(db, id);
      const r = { from: cur.from, to: lastDay };
      const p = rangeProblem(r);
      if (p) throw new BadRequestException(p);
      const extends_ = cur.to !== null && (lastDay === null || lastDay > cur.to);
      if (extends_) await checkAllocation(db, { id: cur.equipmentId, name: cur.equipmentName }, cur.facilityId, { from: addDays(cur.to!, 1), to: lastDay }, id);
      await db.query('update equipment_site_allocations set ends_on = $2 where id = $1', [id, lastDay]);
      return this.one(db, id);
    });
  }

  /**
   * Moves equipment to another site from `onDate` (default today at the new site): the current allocation ends the
   * day before, a new one starts that day and runs to the old end date.
   */
  @Roles(...SITE_ROLES)
  @Post('equipment-allocations/:id/move')
  move(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const facilityId = text(body, 'facilityId', { required: true, max: 40 })!;
    if (!UUID.test(facilityId)) throw new BadRequestException('Choose {a site}');
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = await this.live(db, id);
      if (facilityId === cur.facilityId) throw new BadRequestException(`${cur.equipmentName} is already allocated there`);
      const site = (await db.query<{ timezone: string; active: boolean }>('select timezone, active from facilities where id = $1', [facilityId])).rows[0];
      if (!site?.active) throw new BadRequestException('Choose {a site}');
      const onDate = date(body, 'onDate') ?? todayIn(site.timezone);
      if (onDate <= cur.from) throw new BadRequestException(`Move it after the allocation started (${fmtDate(cur.from)}), or take that allocation off instead`);
      if (cur.to !== null && onDate > cur.to) throw new BadRequestException(`That allocation already ends ${fmtDate(cur.to)}; allocate it to the new place instead`);
      const areaId = (await areaOf(db, body, facilityId)) ?? null;
      await db.query('select 1 from equipment where id = $1 for update', [cur.equipmentId]);
      await db.query('update equipment_site_allocations set ends_on = $2 where id = $1', [id, addDays(onDate, -1)]);
      const r = { from: onDate, to: cur.to };
      await checkAllocation(db, { id: cur.equipmentId, name: cur.equipmentName }, facilityId, r);
      const row = (await db.query<{ id: string }>(
        `insert into equipment_site_allocations(tenant_id, equipment_id, facility_id, area_id, starts_on, ends_on, note, added_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [t.tenantId, cur.equipmentId, facilityId, areaId, r.from, r.to, text(body, 'note', { max: 300 }), auth.userId])).rows[0];
      return { ended: await this.one(db, id), started: await this.one(db, row.id) };
    });
  }

  /** Takes a mistaken allocation off (kept on file as removed). */
  @Roles(...SITE_ROLES)
  @Post('equipment-allocations/:id/remove')
  remove(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const reason = text(body, 'reason', { max: 200 });
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query('update equipment_site_allocations set removed_at = now(), removed_reason = $2 where id = $1 and removed_at is null', [id, reason]);
      if (!r.rowCount) throw new NotFoundException('Allocation not found');
      return { removed: true };
    });
  }

  private async live(db: PoolClient, id: string) {
    const row = (await db.query<AllocRow>(`select ${ALLOC_COLS} from ${ALLOC_FROM} where x.id = $1 and x.removed_at is null`, [id])).rows[0];
    if (!row) throw new NotFoundException('Allocation not found');
    return row;
  }
}
