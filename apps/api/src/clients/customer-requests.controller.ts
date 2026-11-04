import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Public, Roles, Tenant } from '../auth/decorators.js';
import { bool, text } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { actorOf } from '../roster/publishing.js';
import { todayIn } from '../workforce/compliance.js';
import { loadSettings } from '../workforce/settings.js';
import { tellOffice } from '../worker-app/tell-office.js';
import {
  customerRequestEmail, decideRefusal, floodRefusal, looksAutomated, parseCustomerRequest, placeLine, requestLine, RequestProblem,
  type RequestStatus,
} from './customer-requests.js';

const SLUG = /^[a-z0-9-]{2,40}$/;
const NOT_AVAILABLE = "This page isn't available. Check the address, or contact the business directly.";
const TEMPLATE = 'customer_request';

const COLS = `r.id, r.business_name as "businessName", r.contact_name as "contactName", r.email, r.phone, r.frequency,
  r.site_name as "siteName", r.address, r.suburb, r.region, r.postcode, r.role, to_char(r.work_date, 'YYYY-MM-DD') as date,
  to_char(r.start_time, 'HH24:MI') as "startTime", to_char(r.end_time, 'HH24:MI') as "endTime", r.people, r.notes, r.status,
  r.created_at as "createdAt", r.decided_at as "decidedAt", r.decided_by_name as "decidedByName", r.decided_note as "decidedNote",
  r.client_id as "clientId", c.name as "clientName", o.id as "orderId", o.facility_id as "orderFacilityId",
  (select count(*)::int from shifts s where s.client_order_id = o.id) as "orderShifts"`;

interface Row {
  id: string; businessName: string; date: string; startTime: string; endTime: string; role: string; people: number;
  siteName: string | null; address: string; suburb: string | null; region: string | null; postcode: string | null; status: RequestStatus;
}

/** Page settings: whether the public page takes requests and its welcome line. */
async function pageSettings(db: PoolClient, tenantId: string) {
  const r = (await db.query<{ open: boolean; intro: string | null }>(
    'select customer_requests_open as open, customer_requests_intro as intro from tenant_settings where tenant_id = $1', [tenantId])).rows[0];
  return { open: r?.open ?? false, intro: r?.intro ?? null };
}

/**
 * The public "request staff" page (David, 3 Nov, answer 4): a new or occasional customer registers and asks for
 * staff without signing in. Only for a business that has switched it on; anything else is "not available", so the
 * page never says which businesses exist. Requests wait for the office; nothing is booked here.
 */
@Controller('request-page')
export class PublicRequestPageController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async business(slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException(NOT_AVAILABLE);
    const t = (await this.pool.query<{ id: string; name: string }>('select id, name from tenants where slug = $1', [slug])).rows[0];
    if (!t) throw new NotFoundException(NOT_AVAILABLE);
    return t;
  }

  @Public()
  @Get(':slug')
  async view(@Param('slug') slug: string) {
    const t = await this.business(slug);
    return withTenant(this.pool, t.id, async db => {
      const p = await pageSettings(db, t.id);
      if (!p.open) throw new NotFoundException(NOT_AVAILABLE);
      const s = await loadSettings(db, t.id);
      return { business: t.name, intro: p.intro, country: s.country, today: todayIn(s.timezone) };
    });
  }

  @Public()
  @Post(':slug')
  @HttpCode(200)
  async send(@Param('slug') slug: string, @Body() body: Record<string, unknown>) {
    const t = await this.business(slug);
    return withTenant(this.pool, t.id, async db => {
      const p = await pageSettings(db, t.id);
      if (!p.open) throw new NotFoundException(NOT_AVAILABLE);
      if (looksAutomated(body)) return { received: true };
      const s = await loadSettings(db, t.id);
      let r;
      try {
        r = parseCustomerRequest(body, todayIn(s.timezone));
      } catch (e) {
        if (e instanceof RequestProblem) throw new BadRequestException(e.message);
        throw e;
      }
      // One at a time per business, so the limits below hold under a burst.
      await db.query(`select pg_advisory_xact_lock(hashtextextended('customer-requests:' || $1, 0))`, [t.id]);
      const c = (await db.query<{ hour: number; email: number }>(
        `select count(*) filter (where created_at > now() - interval '1 hour')::int as hour,
                count(*) filter (where lower(email) = $1 and created_at > now() - interval '1 day')::int as email
           from customer_requests where created_at > now() - interval '1 day'`, [r.email])).rows[0];
      const refusal = floodRefusal(c.hour, c.email);
      if (refusal) throw new ConflictException(refusal);
      const id = (await db.query<{ id: string }>(
        `insert into customer_requests (tenant_id, business_name, contact_name, email, phone, frequency, site_name, address, suburb, region, postcode,
           role, work_date, start_time, end_time, people, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [t.id, r.businessName, r.contactName, r.email, r.phone, r.frequency, r.siteName, r.address, r.suburb, r.region, r.postcode,
          r.role, r.date, r.startTime, r.endTime, r.people, r.notes])).rows[0].id;
      const m = customerRequestEmail(r, process.env.APP_URL ?? '');
      await tellOffice(db, t.id, { subject: m.subject, body: m.body, template: TEMPLATE, dedupeKey: `customer-request:${id}`, createdBy: null });
      return { received: true };
    });
  }
}

/** The office side: the requests waiting, accepting (as a client) or declining them, and the page's settings. */
@ApiBearerAuth()
@Controller()
export class CustomerRequestsController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** `status` = new (default) or all (new first, then the last 90 days). */
  @Roles(...OFFICE_ROLES)
  @Get('customer-requests')
  list(@Tenant() t: Membership, @Query('status') status?: string) {
    const all = status === 'all';
    return withTenant(this.pool, t.tenantId, async db => {
      const s = await loadSettings(db, t.tenantId);
      const year = todayIn(s.timezone).slice(0, 4);
      const rows = (await db.query<Row>(
        `select ${COLS} from customer_requests r left join clients c on c.id = r.client_id
                 left join client_orders o on o.customer_request_id = r.id
          where ${all ? `(r.status = 'new' or r.created_at > now() - interval '90 days')` : `r.status = 'new'`}
          order by (r.status = 'new') desc, r.created_at desc limit 300`)).rows;
      const waiting = (await db.query<{ n: number }>(`select count(*)::int as n from customer_requests where status = 'new'`)).rows[0].n;
      const page = await pageSettings(db, t.tenantId);
      return {
        open: page.open, waiting,
        requests: rows.map(r => ({ ...r, line: requestLine(r, year), place: placeLine(r) })),
      };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('customer-request-page')
  page(@Tenant() t: Membership) {
    return withTenant(this.pool, t.tenantId, async db => ({ ...(await pageSettings(db, t.tenantId)), slug: t.tenantSlug }));
  }

  /** Owners and admins switch the public page on or off and set its welcome line (blank clears it). */
  @Roles('owner', 'admin')
  @Put('customer-request-page')
  setPage(@Tenant() t: Membership, @Body() body: Record<string, unknown>) {
    const open = bool(body, 'open');
    const hasIntro = !!body && 'intro' in body;
    const intro = text(body, 'intro', { max: 500 });
    return withTenant(this.pool, t.tenantId, async db => {
      const cur = await pageSettings(db, t.tenantId);
      await db.query(
        `insert into tenant_settings (tenant_id, customer_requests_open, customer_requests_intro) values ($1,$2,$3)
         on conflict (tenant_id) do update set customer_requests_open = excluded.customer_requests_open, customer_requests_intro = excluded.customer_requests_intro`,
        [t.tenantId, open ?? cur.open, hasIntro ? intro : cur.intro]);
      return { ...(await pageSettings(db, t.tenantId)), slug: t.tenantSlug };
    });
  }

  private async locked(db: PoolClient, id: string) {
    const r = (await db.query<{ status: RequestStatus; business_name: string; contact_name: string; email: string; phone: string | null }>(
      'select status, business_name, contact_name, email, phone from customer_requests where id = $1 for update', [id])).rows[0];
    if (!r) throw new NotFoundException('Request not found');
    const refusal = decideRefusal(r.status);
    if (refusal) throw new ConflictException(refusal);
    return r;
  }

  /**
   * Accepts a request: with `clientId` it belongs to a client the business already has (a repeat customer);
   * without, a new client is made from what they sent, with their contact saved. Then the office adds the site and
   * takes the order as usual.
   */
  @Roles('owner', 'admin')
  @Post('customer-requests/:id/accept')
  @HttpCode(200)
  accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const clientId = text(body, 'clientId', { max: 40 });
    if (clientId && !/^[0-9a-f-]{36}$/i.test(clientId)) throw new BadRequestException('Choose a {client}');
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await this.locked(db, id);
      let cid = clientId;
      let created = false;
      if (cid) {
        const c = (await db.query('select 1 from clients where id = $1', [cid])).rows[0];
        if (!c) throw new NotFoundException('{Client} not found');
      } else {
        const clash = (await db.query<{ id: string }>('select id from clients where lower(name) = lower($1)', [r.business_name])).rows[0];
        if (clash) throw new ConflictException(`There is already a {client} called ${r.business_name}: choose it instead`);
        cid = (await db.query<{ id: string }>(
          `insert into clients (tenant_id, name, billing_contact_name, billing_email, phone) values ($1,$2,$3,$4,$5) returning id`,
          [t.tenantId, r.business_name, r.contact_name, r.email, r.phone])).rows[0].id;
        created = true;
      }
      const hasContact = (await db.query('select 1 from client_contacts where client_id = $1 and lower(name) = lower($2)', [cid, r.contact_name])).rows[0];
      if (!hasContact) {
        await db.query('insert into client_contacts (tenant_id, client_id, name, email, phone) values ($1,$2,$3,$4,$5)',
          [t.tenantId, cid, r.contact_name, r.email, r.phone]);
      }
      await db.query(
        `update customer_requests set status = 'accepted', client_id = $2, decided_at = now(), decided_by = $3, decided_by_name = $4 where id = $1`,
        [id, cid, auth.userId, actor.name]);
      return { clientId: cid, createdClient: created, contactSaved: !hasContact };
    }, actor);
  }

  /** Declines a request (a short note for the office's record; the customer isn't emailed by CROP). */
  @Roles('owner', 'admin')
  @Post('customer-requests/:id/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const note = text(body, 'note', { max: 300 });
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      await this.locked(db, id);
      await db.query(
        `update customer_requests set status = 'declined', decided_at = now(), decided_by = $2, decided_by_name = $3, decided_note = $4 where id = $1`,
        [id, auth.userId, actor.name, note]);
      return { declined: true };
    }, actor);
  }
}
