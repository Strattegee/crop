import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, isLimited, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, date, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { wordsFor } from '../terms/words.js';
import { addDays, todayIn } from '../workforce/compliance.js';
import {
  joinRefusal, leaving, makeUpLine, memberState, parseMakeUp, shortLine, shortTodayLine, sortMembers, teamGaps,
  type MakeUpRow, type MemberState,
} from './teams.js';

const DEFAULT_ZONE = 'Australia/Melbourne';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The business's role names: its role list and the roles its own active people have (as `GET /roles`). */
async function knownRoles(db: PoolClient): Promise<string[]> {
  return (await db.query<{ name: string }>(
    `select name from business_roles
     union
     select x.role from workers w, unnest(w.roles) as x(role) where w.status = 'active' and w.agency_connection_id is null and w.outside_agency_id is null
     order by 1`)).rows.map(r => r.name);
}

async function businessToday(db: PoolClient): Promise<string> {
  // tenant_settings shows only this business's row (row-level security); CROP's default zone when it has none.
  const z = (await db.query<{ timezone: string }>('select timezone from tenant_settings limit 1')).rows[0]?.timezone;
  return todayIn(z ?? DEFAULT_ZONE);
}

interface TeamRow { id: string; name: string; description: string | null; active: boolean; createdAt: string }
interface MemberRow {
  id: string; teamId: string; workerId: string; name: string; role: string; workerStatus: string; workerRoles: string[];
  startsOn: string; endsOn: string | null; endReason: string | null; onLeave: boolean;
}

const TEAM_COLS = `t.id, t.name, t.description, t.active, t.created_at as "createdAt"`;

/** Live members of these teams (not removed; ended ones only when `withEnded`), with approved leave on `today`. */
async function membersOf(db: PoolClient, teamIds: string[], today: string, withEnded: boolean): Promise<MemberRow[]> {
  if (!teamIds.length) return [];
  return (await db.query<MemberRow>(
    `select m.id, m.team_id as "teamId", m.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name,
            m.role, w.status as "workerStatus", w.roles as "workerRoles",
            to_char(m.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(m.ends_on, 'YYYY-MM-DD') as "endsOn", m.end_reason as "endReason",
            exists (select 1 from leave_records l where l.worker_id = m.worker_id and l.status = 'approved'
                     and l.starts_on <= $2::date and l.ends_on >= $2::date) as "onLeave"
       from team_members m join workers w on w.id = m.worker_id
      where m.team_id = any($1) and m.removed_at is null and ($3 or m.ends_on is null or m.ends_on >= $2::date)
      order by m.starts_on`, [teamIds, today, withEnded])).rows;
}

async function makeUpOf(db: PoolClient, teamIds: string[]): Promise<Map<string, MakeUpRow[]>> {
  const out = new Map<string, MakeUpRow[]>();
  if (!teamIds.length) return out;
  for (const r of (await db.query<{ team_id: string; role: string; count: number }>(
    'select team_id, role, count from team_roles where team_id = any($1) order by team_id, position, role', [teamIds])).rows) {
    out.set(r.team_id, [...(out.get(r.team_id) ?? []), { role: r.role, count: r.count }]);
  }
  return out;
}

function memberOut(m: MemberRow, today: string) {
  const state: MemberState = memberState(m.startsOn, m.endsOn, today);
  const active = m.workerStatus === 'active';
  return {
    id: m.id, workerId: m.workerId, name: m.name, role: m.role, startsOn: m.startsOn, endsOn: m.endsOn, endReason: m.endReason, state,
    // Why they aren't there today (never the leave kind): approved leave, or no longer an active person.
    away: !active ? 'not_active' as const : m.onLeave && state === 'current' ? 'on_leave' as const : null,
    // The person no longer has the role they fill in the team (their roles changed since).
    roleMissing: !m.workerRoles.includes(m.role),
  };
}

/** A team with its make-up, people, gaps and who is away today. What a later project stage copies. */
function teamOut(t: TeamRow, makeUp: MakeUpRow[], rows: MemberRow[], today: string) {
  const all = rows.map(m => memberOut(m, today));
  const members = sortMembers(all.filter(m => m.state !== 'ended'), makeUp);
  const earlier = all.filter(m => m.state === 'ended').sort((a, b) => (b.endsOn ?? '').localeCompare(a.endsOn ?? '')).slice(0, 20);
  const gaps = teamGaps(makeUp, members.map(m => ({ role: m.role, state: m.state, active: m.away !== 'not_active', onLeave: m.away === 'on_leave' })));
  const current = members.filter(m => m.state === 'current');
  return {
    ...t, roles: makeUp, makeUpLine: makeUpLine(makeUp), needed: makeUp.reduce((n, r) => n + r.count, 0),
    members, earlier, gaps: gaps.filter(g => g.short > 0 || g.shortToday > 0),
    shortLine: shortLine(gaps), shortTodayLine: shortTodayLine(gaps),
    awayToday: current.filter(m => m.away !== null).map(m => ({ workerId: m.workerId, name: m.name, role: m.role, away: m.away })),
    counts: { current: current.length, upcoming: members.length - current.length },
  };
}

/** Teams are business-wide: someone limited to some sites can't use them (they'd see people from every site). */
function everySite(t: Membership) {
  if (isLimited(t)) throw new ForbiddenException('{Teams} cover every {site}, so only people who see every {site} can use them');
}

/**
 * Standing teams (David, 5 Nov; migration 0092): the business's own teams with a make-up of roles and named people.
 * Office roles (owners, admins, allocators who see every site). Not the project team (`/facilities/:id/team`).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class TeamsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async load(db: PoolClient, ids: string[] | null, status: 'active' | 'archived' | 'all', withEnded: boolean) {
    const today = await businessToday(db);
    const teams = (await db.query<TeamRow>(
      `select ${TEAM_COLS} from teams t where ($1::uuid[] is null or t.id = any($1))
          and ($2 = 'all' or t.active = ($2 = 'active')) order by lower(t.name)`, [ids, status])).rows;
    const tids = teams.map(t => t.id);
    const makeUp = await makeUpOf(db, tids);
    const members = await membersOf(db, tids, today, withEnded);
    return { today, teams: teams.map(t => teamOut(t, makeUp.get(t.id) ?? [], members.filter(m => m.teamId === t.id), today)) };
  }

  private async one(db: PoolClient, id: string) {
    const t = (await this.load(db, [id], 'all', true)).teams[0];
    if (!t) throw new NotFoundException('{Team} not found');
    return t;
  }

  private async liveTeam(db: PoolClient, id: string): Promise<TeamRow> {
    const t = (await db.query<TeamRow>(`select ${TEAM_COLS} from teams t where t.id = $1 for update`, [id])).rows[0];
    if (!t) throw new NotFoundException('{Team} not found');
    if (!t.active) throw new ConflictException('This {team} is put away. Bring it back first.');
    return t;
  }

  private async nameFree(db: PoolClient, name: string, exceptId: string | null) {
    if ((await db.query('select 1 from teams where active and lower(trim(name)) = lower(trim($1)) and ($2::uuid is null or id <> $2)', [name, exceptId])).rowCount) {
      throw new ConflictException(`There's already a {team} called ${name}`);
    }
  }

  /** The business's teams (`status` active (default) | archived | all) with make-up, people, gaps and who is away today. */
  @Roles(...OFFICE_ROLES)
  @Get('teams')
  list(@Tenant() t: Membership, @Query('status') status?: string) {
    everySite(t);
    const s = status === 'archived' || status === 'all' ? status : 'active';
    return withTenant(this.pool, t.tenantId, async db => (await this.load(db, null, s, false)));
  }

  /** One team, with people who have left it (`earlier`, latest 20). */
  @Roles(...OFFICE_ROLES)
  @Get('teams/:id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    everySite(t);
    return withTenant(this.pool, t.tenantId, db => this.one(db, id));
  }

  /** A new team: `name`, `description`, optional `roles` [{role, count}]. */
  @Roles(...OFFICE_ROLES)
  @Post('teams')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    everySite(t);
    const name = text(body, 'name', { required: true, max: 80 })!;
    const description = text(body, 'description', { max: 1000 });
    return withTenant(this.pool, t.tenantId, async db => {
      await this.nameFree(db, name, null);
      let roles: MakeUpRow[] = [];
      if (body && body.roles !== undefined && body.roles !== null) {
        const p = parseMakeUp(body.roles, await knownRoles(db), await wordsFor(db));
        if ('problem' in p) throw new BadRequestException(p.problem);
        roles = p.roles;
      }
      const id = (await db.query<{ id: string }>(
        'insert into teams(tenant_id, name, description, created_by) values ($1,$2,$3,$4) returning id', [t.tenantId, name, description, auth.userId])).rows[0].id;
      for (const [at, r] of roles.entries()) {
        await db.query('insert into team_roles(tenant_id, team_id, role, count, position) values ($1,$2,$3,$4,$5)', [t.tenantId, id, r.role, r.count, at]);
      }
      return this.one(db, id);
    });
  }

  /** Renames, describes, puts away (`active: false`) or brings back a team. */
  @Roles(...OFFICE_ROLES)
  @Patch('teams/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    everySite(t);
    const has = (k: string) => Boolean(body && k in body);
    const name = has('name') ? text(body, 'name', { required: true, max: 80 }) : null;
    const description = has('description') ? text(body, 'description', { max: 1000 }) : undefined;
    const active = bool(body, 'active');
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = (await db.query<TeamRow>(`select ${TEAM_COLS} from teams t where t.id = $1 for update`, [id])).rows[0];
      if (!cur) throw new NotFoundException('{Team} not found');
      const nextName = name ?? cur.name;
      const nextActive = active ?? cur.active;
      if (nextActive && (nextName !== cur.name || !cur.active)) await this.nameFree(db, nextName, id);
      await db.query(
        `update teams set name = $2, description = case when $3 then $4 else description end, active = $5, updated_at = now() where id = $1`,
        [id, nextName, description !== undefined, description ?? null, nextActive]);
      return this.one(db, id);
    });
  }

  /** Replaces the make-up: `roles` [{role, count}] ([] = none). Role names must be the business's. */
  @Roles(...OFFICE_ROLES)
  @Put('teams/:id/roles')
  setRoles(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    everySite(t);
    return withTenant(this.pool, t.tenantId, async db => {
      await this.liveTeam(db, id);
      const p = parseMakeUp(body?.roles, await knownRoles(db), await wordsFor(db));
      if ('problem' in p) throw new BadRequestException(p.problem);
      const now = (await db.query<{ role: string; count: number; position: number }>('select role, count, position from team_roles where team_id = $1', [id])).rows;
      // crop_app can't update team_roles: a changed line is deleted and inserted again (the audit log keeps each version).
      for (const r of now) {
        const at = p.roles.findIndex(x => x.role === r.role);
        if (at < 0 || p.roles[at].count !== r.count || at !== r.position) await db.query('delete from team_roles where team_id = $1 and role = $2', [id, r.role]);
      }
      for (const [at, r] of p.roles.entries()) {
        if (now.some(n => n.role === r.role && n.count === r.count && n.position === at)) continue;
        await db.query('insert into team_roles(tenant_id, team_id, role, count, position) values ($1,$2,$3,$4,$5)', [t.tenantId, id, r.role, r.count, at]);
      }
      return this.one(db, id);
    });
  }

  /** Puts someone on the team in one of their roles: `workerId`, `role`, `startsOn` (default today). Active people only. */
  @Roles(...OFFICE_ROLES)
  @Post('teams/:id/members')
  addMember(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    everySite(t);
    const workerId = text(body, 'workerId', { required: true, max: 40 })!;
    if (!UUID.test(workerId)) throw new BadRequestException('Choose a person');
    const role = text(body, 'role', { required: true, max: 80 })!;
    const startsOn = date(body, 'startsOn');
    return withTenant(this.pool, t.tenantId, async db => {
      await this.liveTeam(db, id);
      const p = (await db.query<{ name: string; status: string; roles: string[] }>(
        `select coalesce(preferred_name, first_name) || ' ' || last_name as name, status, roles from workers
          where id = $1 and agency_connection_id is null and outside_agency_id is null for update`, [workerId])).rows[0];
      if (!p) throw new BadRequestException('Choose a person');
      const why = joinRefusal(p, role, await wordsFor(db));
      if (why) throw new BadRequestException(why);
      if ((await db.query('select 1 from team_members where team_id = $1 and worker_id = $2 and removed_at is null and ends_on is null', [id, workerId])).rowCount) {
        throw new ConflictException(`${p.name} is already on this {team}`);
      }
      await db.query(
        'insert into team_members(tenant_id, team_id, worker_id, role, starts_on, added_by) values ($1,$2,$3,$4,$5,$6)',
        [t.tenantId, id, workerId, role, startsOn ?? await businessToday(db), auth.userId]);
      return this.one(db, id);
    });
  }

  /**
   * Takes someone off the team. They leave with a last day (`lastDay`, default yesterday, kept as history, `reason`
   * optional); someone who hadn't started yet (or joined today) is removed as a mistaken entry.
   */
  @Roles(...OFFICE_ROLES)
  @Post('team-members/:id/remove')
  removeMember(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    everySite(t);
    const reason = text(body, 'reason', { max: 200 });
    const lastDay = date(body, 'lastDay');
    return withTenant(this.pool, t.tenantId, async db => {
      const m = (await db.query<{ team_id: string; starts_on: string }>(
        `select team_id, to_char(starts_on, 'YYYY-MM-DD') as starts_on from team_members where id = $1 and removed_at is null and ends_on is null`, [id])).rows[0];
      if (!m) throw new NotFoundException('{Team} member not found');
      const today = await businessToday(db);
      const l = leaving(m.starts_on, today, lastDay, addDays(today, -1));
      if ('problem' in l) throw new BadRequestException(l.problem);
      if ('remove' in l) await db.query('update team_members set removed_at = now(), end_reason = $2 where id = $1', [id, reason]);
      else await db.query('update team_members set ends_on = $2, end_reason = $3 where id = $1', [id, l.endsOn, reason]);
      return this.one(db, m.team_id);
    });
  }

  /** The standing teams a person is on now or later (not the project teams: those are `GET /workers/:id/teams`). */
  @Roles(...OFFICE_ROLES)
  @Get('workers/:id/standing-teams')
  forWorker(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    everySite(t);
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from workers where id = $1', [id])).rowCount) throw new NotFoundException('Person not found');
      const today = await businessToday(db);
      return (await db.query<{ id: string; teamId: string; teamName: string; teamActive: boolean; role: string; startsOn: string; endsOn: string | null }>(
        `select m.id, t.id as "teamId", t.name as "teamName", t.active as "teamActive", m.role,
                to_char(m.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(m.ends_on, 'YYYY-MM-DD') as "endsOn"
           from team_members m join teams t on t.id = m.team_id
          where m.worker_id = $1 and m.removed_at is null and (m.ends_on is null or m.ends_on >= $2::date)
          order by t.active desc, lower(t.name)`, [id, today])).rows
        .map(r => ({ ...r, state: memberState(r.startsOn, r.endsOn, today) }));
    });
  }
}
