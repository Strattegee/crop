import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { type IndustryPack } from './packs.js';
import { packByIdFor, packsFor } from './local.js';
import { industriesOf } from './catalogue.js';
import { applyPack } from './apply-pack.js';

/** The business's country (tenant_settings; Australia when nothing is set). */
async function countryOf(db: PoolClient): Promise<string> {
  return (await db.query<{ country: string }>('select country from tenant_settings where tenant_id = app_tenant_id()')).rows[0]?.country ?? 'AU';
}

const summary = (p: IndustryPack) => ({
  id: p.id, name: p.name, description: p.description,
  counts: { roles: p.roles.length, credentials: p.credentials.length, shiftCodes: p.shiftCodes.length, equipmentTypes: p.equipmentTypes.length, items: p.items.length, duties: p.duties.length },
});

/** Industry templates: pick one or more when setting up a business, then adjust (backlog: industry packs). */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class IndustryController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('industry-packs')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      const country = await countryOf(db);
      const applied = new Map((await db.query<{ pack_id: string; applied_at: Date }>('select pack_id, applied_at from industry_pack_applications')).rows.map(r => [r.pack_id, r.applied_at]));
      return packsFor(country).map(p => ({ ...summary(p), appliedAt: applied.get(p.id) ?? null }));
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('industry-packs/:id')
  get(@Tenant() t: Membership, @Param('id') id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const p = packByIdFor(id, await countryOf(db));
      if (!p) throw new NotFoundException('Industry template not found');
      return p;
    });
  }

  @Roles('owner', 'admin')
  @Post('industry-packs/:id/apply')
  @HttpCode(200)
  apply(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id') id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      // The business's own country's version of the template (local.ts).
      const p = packByIdFor(id, await countryOf(db));
      if (!p) throw new NotFoundException('Industry template not found');
      return { pack: p.id, added: await applyPack(db, t.tenantId, auth.userId, p) };
    });
  }

  /** The business's roles: from templates and added by hand. */
  @Roles(...OFFICE_ROLES)
  @Get('roles')
  roles(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select r.id, r.name, r.area, r.description, r.active, r.adults_only as "adultsOnly",
              (select count(*)::int from workers w where w.status = 'active' and r.name = any(w.roles)) as "workerCount", false as "fromPeople"
         from business_roles r
       union all
       -- Roles people have that aren't on the list yet (typed on a person), so every role in use can be picked.
       select null, x.role, null, null, true, false, count(*)::int, true
         from workers w, unnest(w.roles) as x(role)
        where w.status = 'active' and w.agency_connection_id is null
          and not exists (select 1 from business_roles r where lower(r.name) = lower(x.role))
        group by x.role
       order by 5 desc, 3 nulls last, 2`)).rows
      .map((r: { id: string | null; name: string }) => ({ ...r, id: r.id ?? `name:${r.name}` }))
      .map((r: { name: string }) => ({ ...r, industries: industriesOf('role', r.name) })));
  }

  @Roles('owner', 'admin')
  @Post('roles')
  addRole(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 60 })!;
    const area = text(body, 'area', { max: 60 });
    const adultsOnly = bool(body, 'adultsOnly') ?? false;
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `insert into business_roles(tenant_id, name, area, adults_only) values ($1,$2,$3,$4) on conflict do nothing
         returning id, name, area, active, adults_only as "adultsOnly"`, [t.tenantId, name, area, adultsOnly]);
      if (!r.rowCount) throw new BadRequestException(`There is already a role called ${name}`);
      return r.rows[0];
    });
  }

  /** Sets a role on the business's list as 18 and over only (migration 0082): under-18s on it get a warning. */
  @Roles('owner', 'admin')
  @Patch('roles/:id')
  updateRole(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const adultsOnly = bool(body, 'adultsOnly');
    if (adultsOnly === null) throw new BadRequestException('Say whether the role is 18 and over only');
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `update business_roles set adults_only = $2 where id = $1 returning id, name, area, active, adults_only as "adultsOnly"`, [id, adultsOnly]);
      if (!r.rowCount) throw new NotFoundException('{Role} not found');
      return r.rows[0];
    });
  }
}
