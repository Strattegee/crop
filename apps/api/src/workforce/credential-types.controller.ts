import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { bool, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';

// Right to work has its own section (right-to-work.controller.ts), so it isn't offered as a credential category.
export const CATEGORIES = ['registration', 'check', 'training', 'vaccination', 'licence'] as const;
const TYPE_COLUMNS = `id, name, category, has_number as "hasNumber", has_expiry as "hasExpiry", needs_evidence as "needsEvidence",
  verification_method as "verificationMethod", verification_url as "verificationUrl", active`;

/** Starter list for a nursing agency (spec CRD-12), for CFY to confirm and adjust. */
const STARTER: Array<{ name: string; category: (typeof CATEGORIES)[number]; number?: boolean; expiry?: boolean; method?: string; url?: string }> = [
  { name: 'AHPRA registration', category: 'registration', method: 'Check the AHPRA public register and record the result', url: 'https://www.ahpra.gov.au/Registration/Registers-of-Practitioners.aspx' },
  { name: 'National Police Check', category: 'check', method: 'Sight the certificate' },
  { name: 'NDIS Worker Screening Check', category: 'check', method: 'Check the NDIS worker screening database' },
  { name: 'Working with Children Check', category: 'check', method: 'Check the state WWCC register' },
  { name: 'CPR', category: 'training', number: false, method: 'Sight the certificate' },
  { name: 'First Aid', category: 'training', number: false, method: 'Sight the certificate' },
  { name: 'Manual handling', category: 'training', number: false, method: 'Sight the certificate' },
  { name: 'Infection control training', category: 'training', number: false, method: 'Sight the certificate' },
  { name: 'Influenza vaccination', category: 'vaccination', number: false, method: 'Sight vaccination evidence' },
  { name: 'COVID-19 vaccination', category: 'vaccination', number: false, expiry: false, method: 'Sight vaccination evidence' },
  { name: 'Driver licence', category: 'licence', method: 'Sight the licence' },
];
/** Suggested rules to go with the starter list; CFY to confirm. */
const STARTER_RULES: Array<{ type: string; scope: 'all_workers' | 'role'; role?: string }> = [
  { type: 'National Police Check', scope: 'all_workers' },
  { type: 'AHPRA registration', scope: 'role', role: 'RN' },
  { type: 'AHPRA registration', scope: 'role', role: 'EN' },
];

@ApiBearerAuth()
@Controller('credential-types')
export class CredentialTypesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(`select ${TYPE_COLUMNS} from credential_types order by active desc, name`)).rows);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 120 })!;
    const category = oneOf(body, 'category', CATEGORIES, { required: true })!;
    const url = text(body, 'verificationUrl', { max: 300 });
    if (url && !url.startsWith('https://')) throw new BadRequestException('Verification link must start with https://');
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        return (await db.query(
          `insert into credential_types(tenant_id, name, category, has_number, has_expiry, needs_evidence, verification_method, verification_url)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${TYPE_COLUMNS}`,
          [t.tenantId, name, category, bool(body, 'hasNumber') ?? true, bool(body, 'hasExpiry') ?? true, bool(body, 'needsEvidence') ?? true,
            text(body, 'verificationMethod', { max: 300 }), url],
        )).rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new BadRequestException(`There is already a credential type called ${name}`);
        throw err;
      }
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const url = text(body, 'verificationUrl', { max: 300 });
    if (url && !url.startsWith('https://')) throw new BadRequestException('Verification link must start with https://');
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query(
        `update credential_types set
           name = coalesce($2, name), category = coalesce($3, category),
           has_number = coalesce($4, has_number), has_expiry = coalesce($5, has_expiry), needs_evidence = coalesce($6, needs_evidence),
           verification_method = coalesce($7, verification_method), verification_url = coalesce($8, verification_url), active = coalesce($9, active)
         where id = $1 returning ${TYPE_COLUMNS}`,
        [id, text(body, 'name', { max: 120 }), oneOf(body, 'category', CATEGORIES), bool(body, 'hasNumber'), bool(body, 'hasExpiry'),
          bool(body, 'needsEvidence'), text(body, 'verificationMethod', { max: 300 }), url, bool(body, 'active')],
      )).rows[0];
      if (!row) throw new NotFoundException('credential type not found');
      return row;
    });
  }

  /** Adds the nursing-agency starter list and suggested rules; skips any that already exist. */
  @Roles('owner', 'admin')
  @Post('starter-set')
  starterSet(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => {
      let types = 0;
      let rules = 0;
      for (const s of STARTER) {
        const r = await db.query(
          `insert into credential_types(tenant_id, name, category, has_number, has_expiry, verification_method, verification_url)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (tenant_id, lower(name)) do nothing`,
          [t.tenantId, s.name, s.category, s.number ?? true, s.expiry ?? true, s.method ?? null, s.url ?? null],
        );
        types += r.rowCount ?? 0;
      }
      for (const s of STARTER_RULES) {
        const r = await db.query(
          `insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity)
           select $1, id, $3, $4, 'hard' from credential_types where lower(name) = lower($2)
           on conflict do nothing`,
          [t.tenantId, s.type, s.scope, s.role ?? null],
        );
        rules += r.rowCount ?? 0;
      }
      return { typesAdded: types, rulesAdded: rules };
    });
  }
}

@ApiBearerAuth()
@Controller('credential-requirements')
export class CredentialRequirementsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select r.id, r.credential_type_id as "credentialTypeId", t.name as "typeName", r.scope, r.role, r.severity
         from credential_requirements r join credential_types t on t.id = r.credential_type_id
        order by t.name, r.scope, r.role`,
    )).rows);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const typeId = text(body, 'credentialTypeId', { required: true, max: 40 })!;
    const scope = oneOf(body, 'scope', ['all_workers', 'role'] as const, { required: true })!;
    const role = scope === 'role' ? text(body, 'role', { required: true, max: 40 }) : null;
    const severity = oneOf(body, 'severity', ['hard', 'warning'] as const) ?? 'hard';
    if (!/^[0-9a-f-]{36}$/i.test(typeId)) throw new BadRequestException('Choose a credential');
    return withTenant(this.pool, t.tenantId, async db => {
      const exists = await db.query('select 1 from credential_types where id = $1', [typeId]);
      if (!exists.rowCount) throw new NotFoundException('credential type not found');
      const row = (await db.query(
        `insert into credential_requirements(tenant_id, credential_type_id, scope, role, severity) values ($1,$2,$3,$4,$5)
         on conflict (tenant_id, credential_type_id, scope, coalesce(role, '')) do update set severity = excluded.severity
         returning id, credential_type_id as "credentialTypeId", scope, role, severity`,
        [t.tenantId, typeId, scope, role, severity],
      )).rows[0];
      return row;
    });
  }

  @Roles('owner', 'admin')
  @Delete(':id')
  async remove(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    const n = await withTenant(this.pool, t.tenantId, async db => (await db.query('delete from credential_requirements where id = $1', [id])).rowCount);
    if (!n) throw new NotFoundException('requirement not found');
    return { deleted: true };
  }
}
