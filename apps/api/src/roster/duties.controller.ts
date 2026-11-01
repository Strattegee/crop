import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { eligibilityForShift } from './eligibility-data.js';
import { actorOf } from './publishing.js';
import { industriesOf } from '../industry/catalogue.js';
import { shiftById } from './roster.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUIREMENTS = 20;
const MAX_DUTIES_PER_SHIFT = 20;

const DUTY_COLS = `d.id, d.name, d.description, d.active,
  coalesce((select json_agg(json_build_object('credentialTypeId', r.credential_type_id, 'typeName', ct.name, 'severity', r.severity) order by ct.name)
              from shift_duty_requirements r join credential_types ct on ct.id = r.credential_type_id where r.duty_id = d.id), '[]'::json) as requirements`;

type Requirement = { credentialTypeId: string; severity: 'hard' | 'warning' | 'optional' };

/** `requirements: [{ credentialTypeId, severity }]` — severity hard (blocks), warning, or optional (listed, never checked); defaults to hard. */
function requirementsField(body: Record<string, unknown>): Requirement[] | null {
  const v = body?.requirements;
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new BadRequestException('Requirements must be a list');
  if (v.length > MAX_REQUIREMENTS) throw new BadRequestException(`Choose ${MAX_REQUIREMENTS} credentials or fewer`);
  const seen = new Set<string>();
  return v.map(x => {
    const r = (x ?? {}) as Record<string, unknown>;
    if (typeof r.credentialTypeId !== 'string' || !UUID.test(r.credentialTypeId)) throw new BadRequestException('Choose a credential for each requirement');
    const severity = r.severity === undefined || r.severity === null ? 'hard' : r.severity;
    if (severity !== 'hard' && severity !== 'warning' && severity !== 'optional') throw new BadRequestException('Each requirement must be "must have", "should have" or "optional"');
    if (seen.has(r.credentialTypeId)) throw new BadRequestException('Each credential can only be listed once');
    seen.add(r.credentialTypeId);
    return { credentialTypeId: r.credentialTypeId, severity };
  });
}

async function setRequirements(db: PoolClient, tenantId: string, dutyId: string, reqs: Requirement[]) {
  if (reqs.length) {
    const found = (await db.query<{ n: number }>('select count(*)::int as n from credential_types where id = any($1)', [reqs.map(r => r.credentialTypeId)])).rows[0].n;
    if (found !== reqs.length) throw new BadRequestException('One of the credentials no longer exists');
  }
  await db.query('delete from shift_duty_requirements where duty_id = $1', [dutyId]);
  for (const r of reqs) {
    await db.query('insert into shift_duty_requirements(tenant_id, duty_id, credential_type_id, severity) values ($1,$2,$3,$4)',
      [tenantId, dutyId, r.credentialTypeId, r.severity]);
  }
}

async function dutyById(db: PoolClient, id: string) {
  const row = (await db.query(`select ${DUTY_COLS} from shift_duties d where d.id = $1`, [id])).rows[0];
  if (!row) throw new NotFoundException('Duty not found');
  return row;
}

const duplicate = (err: unknown, name: string | null) => {
  if ((err as { code?: string }).code === '23505') return new BadRequestException(`There is already a duty called ${name}`);
  return err;
};

/**
 * Shift duties (conditional requirements): things a shift may involve, such as "Serves alcohol", each with the
 * credentials it needs. Whoever works a shift must meet its duties' rules as well as the usual ones.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class ShiftDutiesController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('shift-duties')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query<{ name: string }>(`select ${DUTY_COLS} from shift_duties d order by d.active desc, lower(d.name)`)).rows
      .map(r => ({ ...r, industries: industriesOf('duty', r.name) })));
  }

  @Roles('owner', 'admin')
  @Post('shift-duties')
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { required: true, max: 80 })!;
    const description = text(body, 'description', { max: 300 });
    const reqs = requirementsField(body) ?? [];
    return withTenant(this.pool, t.tenantId, async db => {
      let id: string;
      try {
        id = (await db.query<{ id: string }>('insert into shift_duties(tenant_id, name, description) values ($1,$2,$3) returning id', [t.tenantId, name, description])).rows[0].id;
      } catch (err) { throw duplicate(err, name); }
      await setRequirements(db, t.tenantId, id, reqs);
      return dutyById(db, id);
    });
  }

  /** Change the name, description, whether it's in use, or (replacing the list) what it needs. */
  @Roles('owner', 'admin')
  @Patch('shift-duties/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const name = text(body, 'name', { max: 80 });
    const description = body && 'description' in body ? text(body, 'description', { max: 300 }) : undefined;
    const active = bool(body, 'active');
    const reqs = requirementsField(body);
    return withTenant(this.pool, t.tenantId, async db => {
      try {
        const n = (await db.query(
          `update shift_duties set name = coalesce($2, name), description = case when $3 then $4 else description end, active = coalesce($5, active)
            where id = $1`, [id, name, description !== undefined, description ?? null, active])).rowCount;
        if (!n) throw new NotFoundException('Duty not found');
      } catch (err) { throw duplicate(err, name); }
      if (reqs) await setRequirements(db, t.tenantId, id, reqs);
      return dutyById(db, id);
    });
  }

  /**
   * Sets the duties on a shift (the whole list). Each change is logged and follows the after-publishing rule.
   * If someone is already on the shift, any rule they now don't meet comes back in `personProblems` (the shift
   * is changed anyway; the roster's Needs attention list shows it too).
   */
  @Roles(...OFFICE_ROLES)
  @Put('shifts/:id/duties')
  @HttpCode(200)
  setForShift(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const v = body?.dutyIds;
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !UUID.test(x))) throw new BadRequestException('Choose the duties for this {shift}');
    const dutyIds = [...new Set(v as string[])];
    if (dutyIds.length > MAX_DUTIES_PER_SHIFT) throw new BadRequestException(`Choose ${MAX_DUTIES_PER_SHIFT} duties or fewer`);
    return withTenant(this.pool, t.tenantId, async db => {
      const shift = (await db.query<{ status: string }>('select status from shifts where id = $1 for update', [id])).rows[0];
      if (!shift) throw new NotFoundException('{Shift} not found');
      if (shift.status === 'cancelled') throw new BadRequestException('This {shift} is cancelled');
      const current = (await db.query<{ duty_id: string }>('select duty_id from shift_duty_links where shift_id = $1', [id])).rows.map(r => r.duty_id);
      const adding = dutyIds.filter(d => !current.includes(d));
      if (adding.length) {
        const ok = (await db.query<{ n: number }>('select count(*)::int as n from shift_duties where id = any($1) and active', [adding])).rows[0].n;
        if (ok !== adding.length) throw new BadRequestException('One of those duties is switched off or no longer exists');
      }
      const removing = current.filter(d => !dutyIds.includes(d));
      if (removing.length) await db.query('delete from shift_duty_links where shift_id = $1 and duty_id = any($2)', [id, removing]);
      for (const d of adding) await db.query('insert into shift_duty_links(tenant_id, shift_id, duty_id) values ($1,$2,$3)', [t.tenantId, id, d]);
      const after = await shiftById(db, id);
      let personProblems: string[] = [];
      if (after.workerId && (adding.length || removing.length)) {
        const [c] = await eligibilityForShift(db, t.tenantId, id, [after.workerId]);
        personProblems = (c?.blocks ?? []).filter(b => b.code === 'credential').map(b => b.message);
      }
      return { ...after, personProblems };
    }, actorOf(auth));
  }
}
