import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { acrossSites, withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import type { AuthContext, Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { actorOf } from '../roster/publishing.js';
import { fillWords, wordsFor } from '../terms/words.js';
import { accessProblem, siteChanges, sitesFor, sitesWords } from './site-access.js';

type Person = { userId: string; name: string; email: string; role: string };
type Site = { id: string; name: string; kind: string; active: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadAccess(db: PoolClient) {
  // Every site, whoever asks (only owners and admins reach this, and they are never limited anyway).
  return acrossSites(db, async () => {
    const people = (await db.query<Person>(
      `select user_id as "userId", name, email, role::text as role from app_office_team()`)).rows;
    const sites = (await db.query<Site>(
      `select id, name, kind, active from facilities order by active desc, lower(name)`)).rows;
    const chosen = new Map<string, string[]>();
    for (const r of (await db.query<{ user_id: string; facility_id: string }>('select user_id, facility_id from member_sites')).rows) {
      chosen.set(r.user_id, [...(chosen.get(r.user_id) ?? []), r.facility_id]);
    }
    return { people, sites, chosen };
  });
}

/**
 * Team access (David, 4 Nov 2026; migration 0086): owners and admins choose which sites and projects each allocator
 * and supervisor works on, and switch someone between allocator and supervisor. Owners and admins always see every
 * site. The sites are enforced by the database for everything the person does (row-level security).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller('site-access')
export class SiteAccessController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Office people with their role and sites, and every site to choose from. */
  @Roles('owner', 'admin')
  @Get()
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      const { people, sites, chosen } = await loadAccess(db);
      const w = await wordsFor(db);
      const nameOf = new Map(sites.map(s => [s.id, s.name]));
      return {
        sites,
        people: people.map(p => {
          const ids = chosen.get(p.userId) ?? [];
          const limit = sitesFor(p.role, ids);
          return {
            ...p, facilityIds: limit ?? [], limited: limit !== null, canChange: p.role === 'allocator' || p.role === 'supervisor',
            sitesWords: fillWords(sitesWords(p.role, ids.map(id => nameOf.get(id) ?? '?')), w),
          };
        }),
      };
    });
  }

  /**
   * Sets someone's sites (replaced as a set; [] = every site for an allocator, nothing for a supervisor) and, with
   * `role`, switches them between allocator and supervisor. Their next request uses the new access.
   */
  @Roles('owner', 'admin')
  @Put(':userId')
  set(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: Record<string, unknown>) {
    const ids = body?.facilityIds;
    if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string' || !UUID.test(x)) || ids.length > 500) {
      throw new BadRequestException('Choose {sites}');
    }
    const facilityIds = [...new Set(ids as string[])];
    const newRole = body.role === undefined || body.role === null ? null : String(body.role);
    return withTenant(this.pool, t.tenantId, async db => {
      const { people, sites, chosen } = await loadAccess(db);
      const person = people.find(p => p.userId === userId);
      if (!person) throw new NotFoundException('They are not one of your office people');
      const problem = accessProblem({ currentRole: person.role, newRole, facilityIds, known: new Set(sites.map(s => s.id)) });
      if (problem) throw new BadRequestException(problem);
      if (newRole && newRole !== person.role) await db.query('select app_set_member_role($1, $2)', [userId, newRole]);
      const { add, remove } = siteChanges(chosen.get(userId) ?? [], facilityIds);
      if (remove.length) await db.query('delete from member_sites where user_id = $1 and facility_id = any($2)', [userId, remove]);
      for (const f of add) {
        await db.query('insert into member_sites(tenant_id, user_id, facility_id, set_by) values ($1, $2, $3, $4)', [t.tenantId, userId, f, auth.userId]);
      }
      const role = newRole ?? person.role;
      const w = await wordsFor(db);
      const nameOf = new Map(sites.map(s => [s.id, s.name]));
      const limit = sitesFor(role, facilityIds);
      return { ...person, role, facilityIds: limit ?? [], limited: limit !== null, sitesWords: fillWords(sitesWords(role, facilityIds.map(id => nameOf.get(id) ?? '?')), w) };
    }, actorOf(auth));
  }
}
