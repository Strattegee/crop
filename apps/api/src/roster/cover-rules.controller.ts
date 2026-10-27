import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { bool, date } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { addDays } from '../workforce/compliance.js';
import { coverGapsBetween } from './cover-data.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS = 62;

const RULE_COLS = `r.id, r.facility_id as "facilityId", f.name as "facilityName", r.credential_type_id as "credentialTypeId",
  ct.name as "typeName", r.active, r.created_at as "createdAt"`;
const RULE_FROM = `site_cover_rules r join credential_types ct on ct.id = r.credential_type_id left join facilities f on f.id = r.facility_id`;

async function ruleById(db: PoolClient, id: string) {
  const row = (await db.query(`select ${RULE_COLS} from ${RULE_FROM} where r.id = $1`, [id])).rows[0];
  if (!row) throw new NotFoundException('Rule not found');
  return row;
}

/**
 * Cover rules (migration 0030): whenever anyone is working at a site, at least one of them must hold a credential
 * (for example a food safety supervisor on every shift). Gaps are listed, never refused: no one person breaks
 * the rule on their own.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class CoverRulesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('cover-rules')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db =>
      (await db.query(`select ${RULE_COLS} from ${RULE_FROM} order by r.active desc, f.name nulls first, ct.name`)).rows);
  }

  /** `{ credentialTypeId, facilityId? }`: no site means every site. Adding a rule that was switched off switches it back on. */
  @Roles('owner', 'admin')
  @Post('cover-rules')
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const credentialTypeId = body?.credentialTypeId;
    if (typeof credentialTypeId !== 'string' || !UUID.test(credentialTypeId)) throw new BadRequestException('Choose a credential');
    const facilityId = body?.facilityId === undefined || body?.facilityId === null || body?.facilityId === '' ? null : body.facilityId;
    if (facilityId !== null && (typeof facilityId !== 'string' || !UUID.test(facilityId))) throw new BadRequestException('Choose a site');
    return withTenant(this.pool, t.tenantId, async db => {
      const ct = (await db.query<{ active: boolean }>('select active from credential_types where id = $1', [credentialTypeId])).rows[0];
      if (!ct?.active) throw new BadRequestException('That credential is switched off or no longer exists');
      if (facilityId && !(await db.query('select 1 from facilities where id = $1', [facilityId])).rowCount) throw new BadRequestException('Choose a site');
      const existing = (await db.query<{ id: string; active: boolean }>(
        'select id, active from site_cover_rules where credential_type_id = $1 and facility_id is not distinct from $2', [credentialTypeId, facilityId])).rows[0];
      if (existing?.active) throw new BadRequestException('There is already a rule for that credential there');
      const id = existing
        ? (await db.query<{ id: string }>('update site_cover_rules set active = true where id = $1 returning id', [existing.id])).rows[0].id
        : (await db.query<{ id: string }>('insert into site_cover_rules(tenant_id, facility_id, credential_type_id) values ($1,$2,$3) returning id',
            [t.tenantId, facilityId, credentialTypeId])).rows[0].id;
      return ruleById(db, id);
    });
  }

  /** Switch a rule off or on (`{ active }`). */
  @Roles('owner', 'admin')
  @Patch('cover-rules/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const active = bool(body, 'active');
    if (active === null) throw new BadRequestException('Say whether the rule is on or off');
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('update site_cover_rules set active = $2 where id = $1', [id, active])).rowCount) throw new NotFoundException('Rule not found');
      return ruleById(db, id);
    });
  }

  /**
   * Gaps in the cover rules for gaps starting on local dates `from` to `to` (up to 62 days), at one site or all:
   * times when someone is working but nobody working holds the credential.
   */
  @Roles(...OFFICE_ROLES)
  @Get('roster/cover-gaps')
  gaps(@Tenant() t: Membership, @Query() q: Record<string, string>) {
    const from = date(q, 'from', { required: true })!;
    const to = date(q, 'to', { required: true })!;
    if (to < from) throw new BadRequestException('The end date must be on or after the start date');
    if (to > addDays(from, MAX_DAYS - 1)) throw new BadRequestException(`Choose ${MAX_DAYS} days or fewer`);
    if (q.facilityId && !UUID.test(q.facilityId)) throw new BadRequestException('Choose a site');
    return withTenant(this.pool, t.tenantId, async db => {
      // Wide enough for any time zone; trimmed to the local dates asked for.
      const rows = await coverGapsBetween(db, new Date(`${addDays(from, -1)}T00:00:00Z`), new Date(`${addDays(to, 2)}T00:00:00Z`), q.facilityId || null);
      return rows.filter(g => g.localDate >= from && g.localDate <= to);
    });
  }
}
