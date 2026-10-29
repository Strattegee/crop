import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { PACKS, packById, type IndustryPack } from './packs.js';
import { applyPackTerms } from '../terms/terms.controller.js';

const summary = (p: IndustryPack) => ({
  id: p.id, name: p.name, description: p.description,
  counts: { roles: p.roles.length, credentials: p.credentials.length, shiftCodes: p.shiftCodes.length, equipmentTypes: p.equipmentTypes.length, items: p.items.length, duties: p.duties.length },
});

/** Adds what's missing from a pack, matched by name (or code). Returns how many of each were added. */
async function applyPack(db: PoolClient, tenantId: string, userId: string, pack: IndustryPack) {
  const added = { roles: 0, credentials: 0, requirements: 0, shiftCodes: 0, equipmentTypes: 0, items: 0, duties: 0, words: 0 };
  const typeIds = new Map<string, string>();
  for (const cr of pack.credentials) {
    const found = (await db.query<{ id: string; catalogue_code: string | null }>(
      'select id, catalogue_code from credential_types where lower(name) = lower($1) limit 1', [cr.name])).rows[0];
    if (found) {
      typeIds.set(cr.name, found.id);
      // A credential of the same name that has no catalogue code yet (made before codes, migration 0038) gets the
      // pack's, unless another of the business's credentials already carries it. Nothing else about it changes.
      if (!found.catalogue_code) {
        await db.query(`update credential_types set catalogue_code = $2 where id = $1 and catalogue_code is null
                          and not exists (select 1 from credential_types o where o.catalogue_code = $2)`, [found.id, cr.code]);
      }
      continue;
    }
    const r = (await db.query<{ id: string }>(
      `insert into credential_types(tenant_id, name, category, has_number, has_expiry, needs_evidence, verification_method, catalogue_code)
       values ($1,$2,$3,$4,$5,true,$6,
               case when exists (select 1 from credential_types o where o.catalogue_code = $7) then null else $7 end) returning id`,
      [tenantId, cr.name, cr.category, cr.number, cr.expiry, cr.method, cr.code])).rows[0];
    typeIds.set(cr.name, r.id);
    added.credentials++;
  }
  for (const role of pack.roles) {
    const r = await db.query(
      `insert into business_roles(tenant_id, name, area) values ($1,$2,$3) on conflict do nothing`, [tenantId, role.name, role.area]);
    added.roles += r.rowCount ?? 0;
    for (const [list, severity] of [[role.must ?? [], 'hard'], [role.should ?? [], 'warning'], [role.optional ?? [], 'optional']] as const) {
      for (const name of list) {
        const typeId = typeIds.get(name);
        if (!typeId) continue;
        const q = await db.query(
          `insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,'role',$3,$4)
           on conflict do nothing`, [tenantId, typeId, role.name, severity]);
        added.requirements += q.rowCount ?? 0;
      }
    }
  }
  for (const sc of pack.shiftCodes) {
    const r = await db.query(
      `insert into shift_codes(tenant_id, code, name, start_time, end_time, break_minutes, letter) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [tenantId, sc.code, sc.name, sc.start, sc.end, sc.breakMinutes, sc.letter ?? null]);
    added.shiftCodes += r.rowCount ?? 0;
  }
  for (const et of pack.equipmentTypes) {
    const op = et.operatorCredential ? typeIds.get(et.operatorCredential) ?? null : null;
    const r = await db.query(
      `insert into equipment_types(tenant_id, name, operator_credential_type_id) values ($1,$2,$3) on conflict do nothing`, [tenantId, et.name, op]);
    added.equipmentTypes += r.rowCount ?? 0;
  }
  for (const it of pack.items) {
    const r = await db.query(
      `insert into items(tenant_id, name, category, unit, unit_cost_cents, tracks_stock, reorder_level)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [tenantId, it.name, it.category, it.unit, it.costCents, it.category !== 'fuel', it.reorderLevel ?? null]);
    added.items += r.rowCount ?? 0;
  }
  // Shift duties: added with what they need only when the business has no duty of that name (theirs is never changed).
  for (const d of pack.duties) {
    const r = (await db.query<{ id: string }>(
      `insert into shift_duties(tenant_id, name, description) values ($1,$2,$3) on conflict do nothing returning id`,
      [tenantId, d.name, d.description])).rows[0];
    if (!r) continue;
    added.duties++;
    for (const [list, severity] of [[d.must ?? [], 'hard'], [d.should ?? [], 'warning'], [d.optional ?? [], 'optional']] as const) {
      for (const name of list) {
        const typeId = typeIds.get(name);
        if (typeId) await db.query('insert into shift_duty_requirements(tenant_id, duty_id, credential_type_id, severity) values ($1,$2,$3,$4) on conflict do nothing', [tenantId, r.id, typeId, severity]);
      }
    }
  }
  added.words = await applyPackTerms(db, tenantId, pack.id, userId);
  await db.query(
    `insert into industry_pack_applications(tenant_id, pack_id, applied_by) values ($1,$2,$3)
     on conflict (tenant_id, pack_id) do update set applied_at = now(), applied_by = excluded.applied_by`, [tenantId, pack.id, userId]);
  return added;
}

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
      const applied = new Map((await db.query<{ pack_id: string; applied_at: Date }>('select pack_id, applied_at from industry_pack_applications')).rows.map(r => [r.pack_id, r.applied_at]));
      return PACKS.map(p => ({ ...summary(p), appliedAt: applied.get(p.id) ?? null }));
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('industry-packs/:id')
  get(@Param('id') id: string) {
    const p = packById(id);
    if (!p) throw new NotFoundException('Industry template not found');
    return p;
  }

  @Roles('owner', 'admin')
  @Post('industry-packs/:id/apply')
  @HttpCode(200)
  apply(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id') id: string) {
    const p = packById(id);
    if (!p) throw new NotFoundException('Industry template not found');
    return withTenant(this.pool, t.tenantId, async db => ({ pack: p.id, added: await applyPack(db, t.tenantId, auth.userId, p) }));
  }

  /** The business's roles: from templates and added by hand. */
  @Roles(...OFFICE_ROLES)
  @Get('roles')
  roles(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select r.id, r.name, r.area, r.description, r.active,
              (select count(*)::int from workers w where w.status = 'active' and r.name = any(w.roles)) as "workerCount"
         from business_roles r order by r.active desc, r.area nulls last, r.name`)).rows);
  }

  @Roles('owner', 'admin')
  @Post('roles')
  addRole(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 60 })!;
    const area = text(body, 'area', { max: 60 });
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(
        `insert into business_roles(tenant_id, name, area) values ($1,$2,$3) on conflict do nothing
         returning id, name, area, active`, [t.tenantId, name, area]);
      if (!r.rowCount) throw new BadRequestException(`There is already a role called ${name}`);
      return r.rows[0];
    });
  }
}
