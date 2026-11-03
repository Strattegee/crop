import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { OFFICE_ROLES, type Membership } from '../auth/auth.types.js';
import { Roles, Tenant } from '../auth/decorators.js';
import { bool, email, int, oneOf, text } from '../common/validate.js';
import { parseContact } from './client-orders.js';
import { APP_POOL } from '../database/database.module.js';
import { businessNumberProblem, normaliseBusinessNumber } from './business-number.js';
import { loadSettings } from '../workforce/settings.js';
import type { PoolClient } from 'pg';

const STATUSES = ['active', 'on_hold', 'inactive'] as const;
const COLS = `c.id, c.name, c.abn, c.abn as "businessNumber", c.status, c.billing_contact_name as "billingContactName", c.billing_email as "billingEmail",
  c.phone, c.notes, c.confirms_bookings as "confirmsBookings", c.rank, c.created_at as "createdAt"`;

/**
 * The business number sent (`businessNumber`, or `abn` as before), checked against the business's own country's form:
 * undefined when not sent, null when cleared. Read inside the transaction so the country is the business's.
 */
async function businessNumber(db: PoolClient, tenantId: string, body: Record<string, unknown>): Promise<string | null | undefined> {
  const key = body && 'businessNumber' in body ? 'businessNumber' : body && 'abn' in body ? 'abn' : null;
  if (!key) return undefined;
  const v = text(body, key, { max: 20 });
  if (v === null) return null;
  const { country } = await loadSettings(db, tenantId);
  const n = normaliseBusinessNumber(country, v);
  if (!n) throw new BadRequestException(businessNumberProblem(country));
  return n;
}

const CONTACT_COLS = `k.id, k.client_id as "clientId", k.name, k.position, k.email, k.phone, k.notes, k.active, k.updated_at as "updatedAt"`;

const duplicateContact = (err: unknown) => {
  if ((err as { code?: string }).code === '23505') throw new BadRequestException('This {client} already has a contact of that name');
  throw err;
};

const duplicate = (err: unknown) => {
  if ((err as { code?: string }).code === '23505') throw new BadRequestException('There is already a client with that name');
  throw err;
};

/**
 * Clients: the organisations your agency supplies workers to (spec ORG-2). Set-up (David, 2 Nov; migration 0069):
 * `confirmsBookings` (the client confirms each booking before it counts as filled) and `rank` (1 = most loyal …
 * 7 = a fill-in, last option; null = not ranked), which orders the allocation screen.
 */
@ApiBearerAuth()
@Controller()
export class ClientsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Roles(...OFFICE_ROLES)
  @Get('clients')
  list(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${COLS}, (select count(*)::int from facilities f where f.client_id = c.id and f.active) as "facilityCount"
         from clients c order by c.status, c.name`,
    )).rows);
  }

  @Roles('owner', 'admin')
  @Post('clients')
  create(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const values = [t.tenantId, text(body, 'name', { required: true, max: 200 }), null,
      text(body, 'billingContactName', { max: 200 }), email(body, 'billingEmail'), text(body, 'phone', { max: 30 }), text(body, 'notes', { max: 2000 }),
      bool(body, 'confirmsBookings') ?? false, int(body, 'rank', 1, 7)];
    return withTenant(this.pool, t.tenantId, async db => {
      values[2] = (await businessNumber(db, t.tenantId, body)) ?? null;
      return (await db.query(
        `insert into clients as c (tenant_id, name, abn, billing_contact_name, billing_email, phone, notes, confirms_bookings, rank)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COLS}`, values,
      ).catch(duplicate)).rows[0];
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('clients/:id')
  get(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const client = (await db.query(`select ${COLS} from clients c where c.id = $1`, [id])).rows[0];
      if (!client) throw new NotFoundException('client not found');
      const facilities = (await db.query(
        `select f.id, f.name, f.suburb, f.state, f.timezone, f.active,
                (select count(*)::int from areas a where a.facility_id = f.id and a.active) as "areaCount"
           from facilities f where f.client_id = $1 order by f.active desc, f.name`, [id],
      )).rows;
      const contacts = (await db.query(`select ${CONTACT_COLS} from client_contacts k where k.client_id = $1 order by k.active desc, k.name`, [id])).rows;
      return { ...client, facilities, contacts };
    });
  }

  @Roles('owner', 'admin')
  @Patch('clients/:id')
  update(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const has = (k: string) => Boolean(body && k in body);
    return withTenant(this.pool, t.tenantId, async db => {
      const a = await businessNumber(db, t.tenantId, body);
      const row = (await db.query(
        `update clients as c set
           name = coalesce($2, name), status = coalesce($3::client_status, status),
           abn = case when $4 then $5 else abn end,
           billing_contact_name = case when $6 then $7 else billing_contact_name end,
           billing_email = case when $8 then $9 else billing_email end,
           phone = case when $10 then $11 else phone end,
           notes = case when $12 then $13 else notes end,
           confirms_bookings = coalesce($14, confirms_bookings),
           rank = case when $15 then $16 else rank end, updated_at = now()
         where id = $1 returning ${COLS}`,
        [id, text(body, 'name', { max: 200 }), oneOf(body, 'status', STATUSES), a !== undefined, a ?? null,
          has('billingContactName'), text(body, 'billingContactName', { max: 200 }), has('billingEmail'), email(body, 'billingEmail'),
          has('phone'), text(body, 'phone', { max: 30 }), has('notes'), text(body, 'notes', { max: 2000 }),
          bool(body, 'confirmsBookings'), has('rank'), int(body, 'rank', 1, 7)],
      ).catch(duplicate)).rows[0];
      if (!row) throw new NotFoundException('client not found');
      return row;
    });
  }

  /**
   * Saved contacts (migration 0072): the client's people who order shifts, picked when taking an order. Every office
   * role, since allocators take the orders. Active clients' live contacts, by client then name.
   */
  @Roles(...OFFICE_ROLES)
  @Get('client-contacts')
  contacts(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => (await db.query(
      `select ${CONTACT_COLS}, c.name as "clientName" from client_contacts k join clients c on c.id = k.client_id
        where k.active and c.status = 'active' order by c.name, k.name`,
    )).rows);
  }

  @Roles(...OFFICE_ROLES)
  @Post('clients/:id/contacts')
  addContact(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const c = parseContact(body ?? {});
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from clients where id = $1', [id])).rowCount) throw new NotFoundException('{Client} not found');
      return (await db.query(
        `insert into client_contacts as k (tenant_id, client_id, name, position, email, phone, notes) values ($1,$2,$3,$4,$5,$6,$7) returning ${CONTACT_COLS}`,
        [t.tenantId, id, c.name, c.position, c.email, c.phone, c.notes],
      ).catch(duplicateContact)).rows[0];
    });
  }

  /** Changes a contact's details or switches it off or on (never deleted; orders keep their own copy of who asked). */
  @Roles(...OFFICE_ROLES)
  @Patch('client-contacts/:id')
  updateContact(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const b = body ?? {};
    const has = (k: string) => k in b;
    if (has('name') && !text(b, 'name', { max: 120 })) throw new BadRequestException('Name is required');
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query(
        `update client_contacts as k set
           name = coalesce($2, name),
           position = case when $3 then $4 else position end,
           email = case when $5 then $6 else email end,
           phone = case when $7 then $8 else phone end,
           notes = case when $9 then $10 else notes end,
           active = coalesce($11, active), updated_at = now()
         where id = $1 returning ${CONTACT_COLS}`,
        [id, text(b, 'name', { max: 120 }), has('position'), text(b, 'position', { max: 120 }), has('email'), email(b, 'email'),
          has('phone'), text(b, 'phone', { max: 40 }), has('notes'), text(b, 'notes', { max: 500 }), bool(b, 'active')],
      ).catch(duplicateContact)).rows[0];
      if (!row) throw new NotFoundException('Contact not found');
      return row;
    });
  }
}
