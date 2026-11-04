import { BadRequestException, Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { ACCESS_WORDS, DOC_WORDS, accessList, accessOf, parseAccess, type Access, type AccessField } from './field-access.js';

/** The business's field-access settings, CROP's defaults filling the gaps. */
export async function loadFieldAccess(db: PoolClient): Promise<Record<AccessField, Access>> {
  return accessOf((await db.query<{ field: string; person: string }>('select field, person from field_access')).rows);
}

/**
 * Who can see and change each piece of a person's details (David, 3 Nov 2026, answer 5; migration 0085). The office
 * always can; these settings say what the person gets in the app. Every office person can read them; owners and
 * administrators change them. The person's own view and changes are in `detail-changes.controller.ts`.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class FieldAccessController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** `{ fields: [{field, group, label, person, isDefault, defaultPerson, allowed, note}], words, docWords }`. */
  @Roles(...OFFICE_ROLES)
  @Get('field-access')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => ({ fields: accessList(await loadFieldAccess(db)), words: ACCESS_WORDS, docWords: DOC_WORDS }));
  }

  /** `{ fields: { mobile: 'approve', doc_vaccination: 'hidden', … } }` (any subset). */
  @Roles('owner', 'admin')
  @Put('field-access')
  save(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const parsed = parseAccess(body ?? {});
    if ('problem' in parsed) throw new BadRequestException(parsed.problem);
    return withTenant(this.pool, t.tenantId, async db => {
      const now = await loadFieldAccess(db);
      for (const [field, person] of Object.entries(parsed.changes) as [AccessField, Access][]) {
        if (now[field] === person) continue;
        await db.query(
          `insert into field_access(tenant_id, field, person) values ($1, $2, $3)
             on conflict (tenant_id, field) do update set person = excluded.person, updated_at = now()`, [t.tenantId, field, person]);
      }
      return { fields: accessList(await loadFieldAccess(db)), words: ACCESS_WORDS, docWords: DOC_WORDS };
    });
  }
}
