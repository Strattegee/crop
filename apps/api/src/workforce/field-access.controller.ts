import { BadRequestException, Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { requireLinked } from '../worker-app/worker-app.controller.js';
import { listFor } from './addresses.controller.js';
import { ACCESS_WORDS, FIELD_RULES, PERSON_FIELDS, accessList, accessOf, parseAccess, personCan, type Access, type PersonField } from './field-access.js';

/** The business's field-access settings, CROP's defaults filling the gaps. */
export async function loadFieldAccess(db: PoolClient): Promise<Record<PersonField, Access>> {
  return accessOf((await db.query<{ field: string; person: string }>('select field, person from field_access')).rows);
}

const GENDER_WORD: Record<string, string> = { F: 'Female', M: 'Male' };

/**
 * Who can see and change each piece of a person's details (David, 3 Nov 2026, answer 5; migration 0085). The office
 * always can; these settings say what the person gets in the app. Every office person can read them; owners and
 * administrators change them. `GET /my/details` is the person's own view, showing only what they may see.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class FieldAccessController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** `{ fields: [{field, label, person, isDefault, defaultPerson, allowed, note}], words }`. */
  @Roles(...OFFICE_ROLES)
  @Get('field-access')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => ({ fields: accessList(await loadFieldAccess(db)), words: ACCESS_WORDS }));
  }

  /** `{ fields: { mobile: 'approve', … } }` (any subset). */
  @Roles('owner', 'admin')
  @Put('field-access')
  save(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const parsed = parseAccess(body ?? {});
    if ('problem' in parsed) throw new BadRequestException(parsed.problem);
    return withTenant(this.pool, t.tenantId, async db => {
      const now = await loadFieldAccess(db);
      for (const [field, person] of Object.entries(parsed.changes) as [PersonField, Access][]) {
        if (now[field] === person) continue;
        await db.query(
          `insert into field_access(tenant_id, field, person) values ($1, $2, $3)
             on conflict (tenant_id, field) do update set person = excluded.person, updated_at = now()`, [t.tenantId, field, person]);
      }
      return { fields: accessList(await loadFieldAccess(db)), words: ACCESS_WORDS };
    });
  }

  /**
   * The person's own details as the business lets them see them: each field they may see with its value and whether
   * they can change it (and whether the office approves), plus their addresses when those are shown. Never the date
   * of birth, the office's notes or anything the office keeps to itself.
   */
  @Get('my/details')
  mine(@Tenant() t: Membership, @Auth() auth: AuthContext) {
    return withTenant(this.pool, t.tenantId, async db => {
      const me = await requireLinked(db, auth);
      const access = await loadFieldAccess(db);
      const w = (await db.query<{ first_name: string; last_name: string; preferred_name: string | null; email: string | null; phone: string | null; gender: string | null }>(
        'select first_name, last_name, preferred_name, email, phone, gender from workers where id = $1', [me.id])).rows[0];
      const value: Record<Exclude<PersonField, 'addresses'>, string | null> = {
        name: `${w.first_name} ${w.last_name}`, preferred_name: w.preferred_name, email: w.email, mobile: w.phone,
        gender: w.gender ? GENDER_WORD[w.gender] ?? null : null,
      };
      const fields = PERSON_FIELDS.filter(f => f !== 'addresses' && personCan(access[f]).see).map(f => {
        const can = personCan(access[f]);
        return { field: f, label: FIELD_RULES[f].label, value: value[f as Exclude<PersonField, 'addresses'>], canChange: can.change, needsApproval: can.needsApproval };
      });
      const addr = personCan(access.addresses);
      let addresses = null;
      if (addr.see) {
        const list = await listFor(db, t.tenantId, me.id);
        const shown = (a: NonNullable<typeof list.current>) => ({ id: a.id, label: a.label, line: a.line, current: a.current });
        addresses = {
          canChange: addr.change, needsApproval: addr.needsApproval,
          list: [...(list.current ? [shown(list.current)] : []), ...list.others.map(shown)],
        };
      }
      return { fields, addresses };
    });
  }
}
