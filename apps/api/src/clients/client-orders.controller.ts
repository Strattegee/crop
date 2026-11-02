import { BadRequestException, Body, Controller, Get, Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { SHIFT_COLS, SHIFT_FROM } from '../roster/roster.controller.js';
import { UUID, insertShifts, parseShiftRequest } from '../roster/shift-create.js';
import { wordsFor } from '../terms/words.js';
import { CHANNEL_WORDS, clientConfirmationEmail, clientShiftStage, orderPlaceProblem, orderSummary, parseOrder, type Channel, type OrderCounts } from './client-orders.js';

const whole = (v: string | undefined, def: number, min: number, max: number) => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`Choose ${min} to ${max} days`);
  return n;
};

/**
 * Client orders and the allocation screen (David, 2 Nov 2026; migration 0068): the office types in what a client
 * asked for (by email, phone or their portal), which makes ordinary shifts at the client's site linked to the order;
 * the Allocations page lists client shifts still to fill. Filling them uses the roster's tools (candidates, offers).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class ClientOrdersController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Records an order and makes its shifts, in one transaction. Same shift fields as `POST /shifts` (never equipment only). */
  @Roles(...OFFICE_ROLES)
  @Post('client-orders')
  create(@Tenant() t: Membership, @Auth() auth: AuthContext, @Body() body: Record<string, unknown>) {
    const b = body ?? {};
    const req = parseShiftRequest({ ...b, equipmentOnly: false });
    const order = parseOrder(b);
    return withTenant(this.pool, t.tenantId, async db => {
      const client = (await db.query<{ status: string }>('select status from clients where id = $1', [order.clientId])).rows[0];
      const site = (await db.query<{ clientId: string | null; active: boolean }>(
        'select client_id as "clientId", active from facilities where id = $1', [req.facilityId])).rows[0];
      const problem = orderPlaceProblem(client, site, order.clientId);
      if (problem) throw new BadRequestException(problem);
      const orderId = (await db.query<{ id: string }>(
        `insert into client_orders(tenant_id, client_id, facility_id, channel, requested_by_name, requested_by_email, requested_by_phone,
                                   client_reference, notes, confirm_to_client, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [t.tenantId, order.clientId, req.facilityId, order.channel, order.requestedByName, order.requestedByEmail, order.requestedByPhone,
          order.clientReference, order.orderNotes, order.confirmToClient, auth.userId])).rows[0].id;
      const made = await insertShifts(db, t.tenantId, auth.userId, req, orderId);
      return { orderId, ...made };
    }, actorOf(auth));
  }

  /** Recent orders (`days`, default 30), newest first, with their shifts counted and a summary line. */
  @Roles(...OFFICE_ROLES)
  @Get('client-orders')
  list(@Tenant() t: Membership, @Query('days') daysQ?: string) {
    const days = whole(daysQ, 30, 1, 90);
    return withTenant(this.pool, t.tenantId, async db => {
      const rows = (await db.query<OrderCounts & { channel: Channel; [k: string]: unknown }>(
        `select o.id, o.client_id as "clientId", c.name as "clientName", o.facility_id as "facilityId", f.name as "facilityName",
                o.channel, o.requested_by_name as "requestedByName", o.requested_by_email as "requestedByEmail", o.requested_by_phone as "requestedByPhone",
                o.client_reference as "clientReference", o.notes, o.confirm_to_client as "confirmToClient", o.created_at as "createdAt",
                n.total, n.booked, n.assigned, n.open, n.cancelled, n.first_starts_at as "firstStartsAt",
                to_char(n.first_starts_at at time zone f.timezone, 'YYYY-MM-DD') as "firstLocalDate",
                to_char(n.last_starts_at at time zone f.timezone, 'YYYY-MM-DD') as "lastLocalDate",
                (select count(*)::int from client_order_confirmations x where x.order_id = o.id) as "confirmationsSent"
           from client_orders o join clients c on c.id = o.client_id join facilities f on f.id = o.facility_id
           cross join lateral (
             select count(*)::int as total, count(*) filter (where s.status = 'booked')::int as booked,
                    count(*) filter (where s.status = 'assigned')::int as assigned, count(*) filter (where s.status = 'open')::int as open,
                    count(*) filter (where s.status = 'cancelled')::int as cancelled, min(s.starts_at) as first_starts_at, max(s.starts_at) as last_starts_at
               from shifts s where s.client_order_id = o.id) n
          where o.created_at >= now() - make_interval(days => $1)
          order by o.created_at desc limit 200`, [days])).rows;
      const w = await wordsFor(db);
      return rows.map(r => ({ ...r, channelWords: CHANNEL_WORDS[r.channel], summary: orderSummary(r, w) }));
    });
  }

  /** Shifts at clients' sites still to come in the next `days` (1–31, default 14), soonest first, with the order they came from. */
  @Roles(...OFFICE_ROLES)
  @Get('allocations/client-shifts')
  clientShifts(@Tenant() t: Membership, @Query('days') daysQ?: string, @Query('clientId') clientId?: string) {
    const days = whole(daysQ, 14, 1, 31);
    const client = clientId && UUID.test(clientId) ? clientId : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const shifts = (await db.query<{ status: string; offersPending: number }>(
        `select ${SHIFT_COLS}, c.id as "clientId", c.name as "clientName", s.client_order_id as "orderId",
                o.client_reference as "clientReference", o.requested_by_name as "requestedByName", o.channel as "orderChannel"
           from ${SHIFT_FROM} join clients c on c.id = f.client_id left join client_orders o on o.id = s.client_order_id
          where s.needs_person and s.status <> 'cancelled' and s.ends_at > now() and s.starts_at < now() + make_interval(days => $1)
            and ($2::uuid is null or c.id = $2)
          order by s.starts_at, c.name, f.name, a.name nulls first, s.role limit 500`, [days, client])).rows;
      const rows = shifts.map(s => ({ ...s, stage: clientShiftStage(s) }));
      const counts = { open: 0, offered: 0, assigned: 0, booked: 0 };
      for (const r of rows) counts[r.stage]++;
      return { days, counts, shifts: rows };
    });
  }
}

/** For the menu (`GET /allocations/summary`): whether the business has clients with sites, and client shifts still to fill in 14 days. */
export async function clientAllocationSummary(db: PoolClient) {
  return (await db.query<{ hasClients: boolean; clientShiftsOpen: number }>(
    `select exists (select 1 from clients c join facilities f on f.client_id = c.id where c.status = 'active' and f.active) as "hasClients",
            (select count(*)::int from shifts s join facilities f on f.id = s.facility_id
              where f.client_id is not null and s.needs_person and s.status in ('open', 'assigned')
                and s.starts_at > now() and s.starts_at < now() + interval '14 days') as "clientShiftsOpen"`)).rows[0];
}

type Due = { tenant_id: string; shift_id: string; worker_id: string };

/**
 * Emails the client when a shift on their order is booked: every minute, the booked shifts whose order wants the
 * client told and hasn't been (`app_client_confirmations_due`), then in each business the email and its record, in one
 * transaction. Off with CLIENT_CONFIRM=off or NOTIFY_DISPATCH=off (tests call runOnce).
 */
@Injectable()
export class ClientConfirmations implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('ClientConfirmations');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    if (process.env.CLIENT_CONFIRM === 'off' || process.env.NOTIFY_DISPATCH === 'off') return;
    const every = Number(process.env.CLIENT_CONFIRM_MS ?? 60_000);
    this.timer = setInterval(() => void this.runOnce().catch(err => this.log.error(err)), every);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sends what is due. Returns how many emails were queued. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = (await this.pool.query<Due>('select tenant_id, shift_id, worker_id from app_client_confirmations_due(50)')).rows;
      let sent = 0;
      for (const d of due) {
        try {
          if (await this.confirm(d)) sent++;
        } catch (err) {
          this.log.error(err);
        }
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  private confirm(d: Due): Promise<boolean> {
    return withTenant(this.pool, d.tenant_id, async db => {
      // Checked again in the business: still booked to this person, not started, and the order still wants it.
      const r = (await db.query<{ orderId: string; to: string; contactName: string; clientReference: string | null; personName: string; role: string;
        siteName: string; areaName: string | null; localDate: string; localStart: string; localEnd: string; businessName: string }>(
        `select o.id as "orderId", o.requested_by_email as to, o.requested_by_name as "contactName", o.client_reference as "clientReference",
                w.first_name || ' ' || w.last_name as "personName", s.role, f.name as "siteName", a.name as "areaName",
                to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
                to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
                to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
                (select name from tenants where id = s.tenant_id) as "businessName"
           from shifts s join client_orders o on o.id = s.client_order_id join facilities f on f.id = s.facility_id
           left join areas a on a.id = s.area_id
           join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status = 'confirmed' and sa.worker_id = $2
           join workers w on w.id = sa.worker_id
          where s.id = $1 and s.status = 'booked' and s.starts_at > now() and o.confirm_to_client and o.requested_by_email is not null
            and not exists (select 1 from client_order_confirmations x where x.shift_id = s.id and x.worker_id = $2)`,
        [d.shift_id, d.worker_id])).rows[0];
      if (!r) return false;
      const { subject, body } = clientConfirmationEmail(r, await wordsFor(db));
      const q = await queueNotification(db, d.tenant_id, { channel: 'email', to: r.to, template: 'client_booking_confirmed', subject, body,
        dedupeKey: `client-confirm:${d.shift_id}:${d.worker_id}` });
      const saved = await db.query(
        `insert into client_order_confirmations(tenant_id, order_id, shift_id, worker_id, notification_id) values ($1,$2,$3,$4,$5)
         on conflict (shift_id, worker_id) do nothing`, [d.tenant_id, r.orderId, d.shift_id, d.worker_id, q.id]);
      return Boolean(saved.rowCount) && q.id !== null;
    });
  }
}
