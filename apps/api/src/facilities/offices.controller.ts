import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, text } from '../common/validate.js';
import { COUNTRIES } from '../common/countries.js';
import { APP_POOL } from '../database/database.module.js';
import { loadSettings } from '../workforce/settings.js';
import { peopleProblem } from './offices.js';

type OfficeRow = { id: string; name: string; state: string | null; active: boolean; createdAt: string };

const duplicate = (err: unknown) => {
  if ((err as { code?: string }).code === '23505') throw new BadRequestException('There is already an office with that name');
  throw err;
};

/** The office's state: checked against the business's country's list where it has one (AU, US), else free text. */
async function officeState(db: PoolClient, tenantId: string, body: Record<string, unknown>): Promise<string | null> {
  const v = text(body, 'state', { max: 60 });
  if (!v) return null;
  const c = COUNTRIES[(await loadSettings(db, tenantId)).country];
  if (!c.regions) return v;
  const up = v.toUpperCase();
  if (!c.regions.includes(up)) throw new BadRequestException(`Choose a ${c.regionLabel.toLowerCase()} in ${c.name}`);
  return up;
}

/** The ids of the business's office people (owners, admins, allocators). */
export async function officePeople(db: PoolClient): Promise<Map<string, string>> {
  return new Map((await db.query<{ user_id: string; name: string }>('select user_id, name from app_office_team()')).rows.map(r => [r.user_id, r.name]));
}

/** The offices the person works in (empty when none are set). */
export async function myOffices(db: PoolClient, userId: string): Promise<Set<string>> {
  return new Set((await db.query<{ office_id: string }>(
    `select m.office_id from member_offices m join offices o on o.id = m.office_id where m.user_id = $1 and o.active`, [userId])).rows.map(r => r.office_id));
}

/**
 * Offices (David, 3 Nov 2026, answer 1; migration 0077): the business's branches. Sites belong to at most one office
 * (`PATCH /facilities/:id {officeId}`), office people are attached with `PUT /offices/:id/people`. Owners and
 * administrators change them; every office person can read them. Switched off, never deleted.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('offices')
export class OfficesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Every office with its sites and people; `mine` = the caller works in it. */
  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const offices = (await db.query<OfficeRow>(
        `select id, name, state, active, created_at as "createdAt" from offices order by active desc, lower(name)`)).rows;
      const sites = (await db.query<{ id: string; name: string; officeId: string; active: boolean }>(
        `select id, name, office_id as "officeId", active from facilities where office_id is not null order by name`)).rows;
      const team = await officePeople(db);
      const members = (await db.query<{ office_id: string; user_id: string }>('select office_id, user_id from member_offices')).rows;
      return offices.map(o => ({
        ...o,
        sites: sites.filter(s => s.officeId === o.id).map(s => ({ id: s.id, name: s.name, active: s.active })),
        siteCount: sites.filter(s => s.officeId === o.id && s.active).length,
        people: members.filter(m => m.office_id === o.id && team.has(m.user_id))
          .map(m => ({ userId: m.user_id, name: team.get(m.user_id)! })).sort((a, b) => a.name.localeCompare(b.name)),
        mine: members.some(m => m.office_id === o.id && m.user_id === auth.userId),
      }));
    });
  }

  /** The office people who can be attached to offices (owners and admins, for the Offices screen). */
  @Roles('owner', 'admin')
  @Get('people')
  people(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query<{ user_id: string; name: string; role: string }>(
      'select user_id, name, role::text as role from app_office_team()')).rows.map(r => ({ userId: r.user_id, name: r.name, role: r.role })));
  }

  /** `{ name, state? }` */
  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 120 });
    return withTenant(this.pool, t.tenantId, async db => {
      const state = await officeState(db, t.tenantId, body);
      return (await db.query<OfficeRow>(
        `insert into offices(tenant_id, name, state) values ($1,$2,$3) returning id, name, state, active, created_at as "createdAt"`,
        [t.tenantId, name, state]).catch(duplicate)).rows[0];
    });
  }

  /** `{ name?, state?|null, active? }`; switching an office off leaves its sites and people where they are. */
  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { max: 120 });
    const active = bool(body, 'active');
    const hasState = Boolean(body && 'state' in body);
    return withTenant(this.pool, t.tenantId, async db => {
      const state = hasState ? await officeState(db, t.tenantId, body) : null;
      const row = (await db.query<OfficeRow>(
        `update offices set name = coalesce($2, name), state = case when $3 then $4 else state end, active = coalesce($5, active), updated_at = now()
          where id = $1 returning id, name, state, active, created_at as "createdAt"`,
        [id, name, hasState, state, active]).catch(duplicate)).rows[0];
      if (!row) throw new NotFoundException('Office not found');
      return row;
    });
  }

  /** `{ userIds }`: the office people who work in this office, replaced as a set. */
  @Roles('owner', 'admin')
  @Put(':id/people')
  @HttpCode(200)
  setPeople(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const raw = body?.userIds;
    if (!Array.isArray(raw) || raw.length > 500 || raw.some(x => typeof x !== 'string')) throw new BadRequestException('Choose the people for this office');
    const userIds = [...new Set(raw as string[])];
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from offices where id = $1', [id])).rowCount) throw new NotFoundException('Office not found');
      const team = await officePeople(db);
      const problem = peopleProblem(userIds, new Set(team.keys()));
      if (problem) throw new BadRequestException(problem);
      await db.query('delete from member_offices where office_id = $1 and not (user_id = any($2::uuid[]))', [id, userIds]);
      await db.query(
        `insert into member_offices(tenant_id, user_id, office_id, set_by) select $1, u, $2, $3 from unnest($4::uuid[]) u
         on conflict do nothing`, [t.tenantId, id, auth.userId, userIds]);
      return { officeId: id, people: userIds.map(u => ({ userId: u, name: team.get(u)! })).sort((a, b) => a.name.localeCompare(b.name)) };
    });
  }
}
