import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { email, oneOf, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { normaliseAbn } from './abn.js';

const STATUSES = ['active', 'on_hold', 'inactive'] as const;
const COLS = `c.id, c.name, c.abn, c.status, c.billing_contact_name as "billingContactName", c.billing_email as "billingEmail",
  c.phone, c.notes, c.created_at as "createdAt"`;

function abn(body: Record<string, unknown>): string | null | undefined {
  if (!body || !('abn' in body)) return undefined;
  const v = text(body, 'abn', { max: 20 });
  if (v === null) return null;
  const n = normaliseAbn(v);
  if (!n) throw new BadRequestException('ABN is not valid (11 digits)');
  return n;
}

const duplicate = (err: unknown) => {
  if ((err as { code?: string }).code === '23505') throw new BadRequestException('There is already a client with that name');
  throw err;
};

/** Clients: the organisations your agency supplies workers to (spec ORG-2). */
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get()
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${COLS}, (select count(*)::int from facilities f where f.client_id = c.id and f.active) as "facilityCount"
         from clients c order by c.status, c.name`,
    )).rows);
  }

  @Roles('owner', 'admin')
  @Post()
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const values = [t.tenantId, text(body, 'name', { required: true, max: 200 }), abn(body) ?? null,
      text(body, 'billingContactName', { max: 200 }), email(body, 'billingEmail'), text(body, 'phone', { max: 30 }), text(body, 'notes', { max: 2000 })];
    return withTenant(this.pool, t.tenantId, async db =>
      (await db.query(
        `insert into clients as c (tenant_id, name, abn, billing_contact_name, billing_email, phone, notes)
         values ($1,$2,$3,$4,$5,$6,$7) returning ${COLS}`, values,
      ).catch(duplicate)).rows[0]);
  }

  @Roles(...OFFICE_ROLES)
  @Get(':id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const client = (await db.query(`select ${COLS} from clients c where c.id = $1`, [id])).rows[0];
      if (!client) throw new NotFoundException('client not found');
      const facilities = (await db.query(
        `select f.id, f.name, f.suburb, f.state, f.timezone, f.active,
                (select count(*)::int from areas a where a.facility_id = f.id and a.active) as "areaCount"
           from facilities f where f.client_id = $1 order by f.active desc, f.name`, [id],
      )).rows;
      return { ...client, facilities };
    });
  }

  @Roles('owner', 'admin')
  @Patch(':id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const has = (k: string) => Boolean(body && k in body);
    const a = abn(body);
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query(
        `update clients as c set
           name = coalesce($2, name), status = coalesce($3::client_status, status),
           abn = case when $4 then $5 else abn end,
           billing_contact_name = case when $6 then $7 else billing_contact_name end,
           billing_email = case when $8 then $9 else billing_email end,
           phone = case when $10 then $11 else phone end,
           notes = case when $12 then $13 else notes end, updated_at = now()
         where id = $1 returning ${COLS}`,
        [id, text(body, 'name', { max: 200 }), oneOf(body, 'status', STATUSES), a !== undefined, a ?? null,
          has('billingContactName'), text(body, 'billingContactName', { max: 200 }), has('billingEmail'), email(body, 'billingEmail'),
          has('phone'), text(body, 'phone', { max: 30 }), has('notes'), text(body, 'notes', { max: 2000 })],
      ).catch(duplicate)).rows[0];
      if (!row) throw new NotFoundException('client not found');
      return row;
    });
  }
}
