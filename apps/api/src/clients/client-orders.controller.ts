import { BadRequestException, Body, Controller, ConflictException, Get, HttpCode, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { SHIFT_COLS, SHIFT_FROM, shiftById } from '../roster/roster.controller.js';
import { UUID, insertShifts, parseShiftRequest } from '../roster/shift-create.js';
import { wordsFor } from '../terms/words.js';
import { CHANNEL_WORDS, CLIENT_SHIFT_STAGES, contactProblem, whoAsked, type OrderFields, clientChangeEmail, clientConfirmRefusal, clientConfirmationEmail, clientShiftStage, orderPlaceProblem, orderSummary, parseOrder, type ChangeKind, type Channel, type ClientShiftStage, type OrderCounts } from './client-orders.js';

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
      const { contactId, contactSaved, who } = await this.resolveContact(db, t.tenantId, order);
      const orderId = (await db.query<{ id: string }>(
        `insert into client_orders(tenant_id, client_id, facility_id, channel, requested_by_name, requested_by_email, requested_by_phone,
                                   client_reference, notes, confirm_to_client, created_by, contact_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [t.tenantId, order.clientId, req.facilityId, order.channel, who.name, who.email, who.phone,
          order.clientReference, order.orderNotes, order.confirmToClient, auth.userId, contactId])).rows[0].id;
      const made = await insertShifts(db, t.tenantId, auth.userId, req, orderId);
      return { orderId, contactId, contactSaved, ...made };
    }, actorOf(auth));
  }

  /**
   * Who asked: a saved contact of the client (typed details win field by field), or what was typed, saved as a new
   * contact when asked (an existing live contact of that name is linked instead of adding a second one).
   */
  private async resolveContact(db: PoolClient, tenantId: string, order: OrderFields) {
    if (order.contactId) {
      const c = (await db.query<{ clientId: string; active: boolean; name: string; email: string | null; phone: string | null }>(
        'select client_id as "clientId", active, name, email, phone from client_contacts where id = $1', [order.contactId])).rows[0];
      const problem = contactProblem(c, order.clientId);
      if (problem) throw new BadRequestException(problem);
      const who = whoAsked(order, c);
      return { contactId: order.contactId, contactSaved: false, who: { ...who, name: who.name ?? c.name } };
    }
    const who = { name: order.requestedByName, email: order.requestedByEmail, phone: order.requestedByPhone };
    if (!order.saveContact) return { contactId: null, contactSaved: false, who };
    const existing = (await db.query<{ id: string }>(
      'select id from client_contacts where client_id = $1 and active and lower(trim(name)) = lower(trim($2))', [order.clientId, who.name])).rows[0];
    if (existing) return { contactId: existing.id, contactSaved: false, who };
    const id = (await db.query<{ id: string }>(
      'insert into client_contacts(tenant_id, client_id, name, email, phone) values ($1,$2,$3,$4,$5) returning id',
      [tenantId, order.clientId, who.name, who.email, who.phone])).rows[0].id;
    return { contactId: id, contactSaved: true, who };
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
                n.total, n.booked, n.assigned, n.open, n.cancelled, n."toConfirm", n.first_starts_at as "firstStartsAt",
                to_char(n.first_starts_at at time zone f.timezone, 'YYYY-MM-DD') as "firstLocalDate",
                to_char(n.last_starts_at at time zone f.timezone, 'YYYY-MM-DD') as "lastLocalDate",
                (select count(*)::int from client_order_confirmations x where x.order_id = o.id) as "confirmationsSent",
                (select count(*)::int from client_order_notices x where x.order_id = o.id) as "changesSent"
           from client_orders o join clients c on c.id = o.client_id join facilities f on f.id = o.facility_id
           cross join lateral (
             select count(*)::int as total, count(*) filter (where s.status = 'booked')::int as booked,
                    count(*) filter (where s.status = 'assigned')::int as assigned, count(*) filter (where s.status = 'open')::int as open,
                    count(*) filter (where s.status = 'cancelled')::int as cancelled,
                    count(*) filter (where s.status = 'booked' and c.confirms_bookings and not exists (
                      select 1 from shift_assignments sa where sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status = 'confirmed'
                         and sa.worker_id = s.client_confirmed_worker_id))::int as "toConfirm",
                    min(s.starts_at) as first_starts_at, max(s.starts_at) as last_starts_at
               from shifts s where s.client_order_id = o.id) n
          where o.created_at >= now() - make_interval(days => $1)
          order by o.created_at desc limit 200`, [days])).rows;
      const w = await wordsFor(db);
      return rows.map(r => ({ ...r, channelWords: CHANNEL_WORDS[r.channel], summary: orderSummary(r, w) }));
    });
  }

  /**
   * Shifts at clients' sites still to come in the next `days` (1–31, default 14), soonest first and, at the same time,
   * by the client's rank (1 first, unranked last), with the order they came from. Shifts on an order whose client
   * confirms bookings are "client to confirm" once booked, until the office records the client's yes.
   */
  @Roles(...OFFICE_ROLES)
  @Get('allocations/client-shifts')
  clientShifts(@Tenant() t: Membership, @Query('days') daysQ?: string, @Query('clientId') clientId?: string) {
    const days = whole(daysQ, 14, 1, 31);
    const client = clientId && UUID.test(clientId) ? clientId : null;
    return withTenant(this.pool, t.tenantId, async db => {
      const shifts = (await db.query<{ status: string; offersPending: number; clientConfirms: boolean; clientConfirmedAt: string | null }>(
        `select ${SHIFT_COLS}, c.id as "clientId", c.name as "clientName", c.rank as "clientRank", s.client_order_id as "orderId",
                o.client_reference as "clientReference", o.requested_by_name as "requestedByName", o.channel as "orderChannel"
           from ${SHIFT_FROM} join clients c on c.id = f.client_id left join client_orders o on o.id = s.client_order_id
          where s.needs_person and s.status <> 'cancelled' and s.ends_at > now() and s.starts_at < now() + make_interval(days => $1)
            and ($2::uuid is null or c.id = $2)
          order by s.starts_at, c.rank nulls last, c.name, f.name, a.name nulls first, s.role limit 500`, [days, client])).rows;
      const rows = shifts.map(s => ({ ...s, stage: clientShiftStage(s) }));
      const counts = Object.fromEntries(CLIENT_SHIFT_STAGES.map(k => [k, 0])) as Record<ClientShiftStage, number>;
      for (const r of rows) counts[r.stage]++;
      return { days, counts, shifts: rows };
    });
  }

  /**
   * Records that the client confirmed the person on a shift from their order (their client confirms bookings), whether
   * the person has confirmed yet or not (either side can say yes first; the shift is final when both have).
   * Not a roster change: nothing goes in the shift log and the after-publishing rules don't apply; the audit log
   * keeps who and when. If the client says no, the office removes the person as usual.
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/client-confirmed')
  @HttpCode(200)
  clientConfirmed(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const actor = actorOf(auth);
    return withTenant(this.pool, t.tenantId, async db => {
      const s = await this.lockForClient(db, id);
      const problem = clientConfirmRefusal(s);
      if (problem) throw new ConflictException(problem);
      await db.query('update shifts set client_confirmed_at = now(), client_confirmed_by = $2, client_confirmed_worker_id = $3 where id = $1',
        [id, (actor.name ?? '').slice(0, 200) || null, s.workerId]);
      return shiftById(db, id);
    }, actor);
  }

  /** Takes back a client confirmation recorded by mistake (before the shift starts): the shift waits for the client again. */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/client-confirmed/undo')
  @HttpCode(200)
  undoClientConfirmed(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const s = await this.lockForClient(db, id);
      if (!s.clientConfirmedAt) throw new ConflictException('The {client} hasn’t confirmed this booking');
      if (s.started) throw new ConflictException('This {shift} has already started');
      await db.query('update shifts set client_confirmed_at = null, client_confirmed_by = null, client_confirmed_worker_id = null where id = $1', [id]);
      return shiftById(db, id);
    }, actorOf(auth));
  }

  /** Locks the shift row and returns what the client-confirmation rules need (the confirmation counts only for the person on it now). */
  private async lockForClient(db: PoolClient, id: string) {
    const s = (await db.query<{ onOrder: boolean; clientConfirms: boolean; status: string; started: boolean; clientConfirmedAt: string | null; workerId: string | null }>(
      `select s.client_order_id is not null as "onOrder", coalesce(c.confirms_bookings, false) as "clientConfirms", s.status::text as status,
              s.starts_at <= now() as started, sa.worker_id as "workerId",
              case when sa.worker_id is not null and s.client_confirmed_worker_id = sa.worker_id then s.client_confirmed_at end as "clientConfirmedAt"
         from shifts s left join client_orders o on o.id = s.client_order_id left join clients c on c.id = o.client_id
         left join shift_assignments sa on sa.shift_id = s.id and sa.resource_kind = 'worker' and sa.status in ('assigned', 'confirmed')
        where s.id = $1 for update of s`, [id])).rows[0];
    if (!s) throw new NotFoundException('{Shift} not found');
    return s;
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
 * Emails the client when a shift on their order is booked (asking them to confirm when the client confirms bookings): every minute, the booked shifts whose order wants the
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
    const settle = Number(process.env.CLIENT_NOTICE_SETTLE_SECONDS ?? 120);
    this.timer = setInterval(() => void this.runOnce().then(() => this.runChanges(settle)).catch(err => this.log.error(err)), every);
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
        siteName: string; areaName: string | null; localDate: string; localStart: string; localEnd: string; businessName: string; askToConfirm: boolean }>(
        `select o.id as "orderId",
                -- Ask the client to confirm unless they already said yes to this person (before the person confirmed).
                (select c.confirms_bookings from clients c where c.id = o.client_id) and s.client_confirmed_worker_id is distinct from $2 as "askToConfirm", o.requested_by_email as to, o.requested_by_name as "contactName", o.client_reference as "clientReference",
                coalesce(nullif(trim(w.preferred_name), ''), w.first_name) || ' ' || w.last_name as "personName", s.role, f.name as "siteName", a.name as "areaName",
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
        `insert into client_order_confirmations(tenant_id, order_id, shift_id, worker_id, notification_id, starts_at, ends_at, area_id)
         select $1, $2, s.id, $4, $5, s.starts_at, s.ends_at, s.area_id from shifts s where s.id = $3
         on conflict (shift_id, worker_id) do nothing`, [d.tenant_id, r.orderId, d.shift_id, d.worker_id, q.id]);
      return Boolean(saved.rowCount) && q.id !== null;
    });
  }

  private changing = false;

  /**
   * Emails the client when a booking they were told about changes (migration 0071): cancelled, the person taken off,
   * or the date, times or area changed while they're still on it. `settleSeconds` is how long since the shift's last
   * change before a removal or change goes, so the office can finish what it's doing (cancellations go at once).
   * Returns how many emails were queued.
   */
  async runChanges(settleSeconds = 120): Promise<number> {
    if (this.changing) return 0;
    this.changing = true;
    try {
      const due = (await this.pool.query<{ tenant_id: string; confirmation_id: string; kind: ChangeKind }>(
        'select tenant_id, confirmation_id, kind from app_client_notices_due($1, 50)', [Math.max(0, Math.round(settleSeconds))])).rows;
      let sent = 0;
      for (const d of due) {
        try {
          if (await this.notice(d.tenant_id, d.confirmation_id, d.kind)) sent++;
        } catch (err) {
          this.log.error(err);
        }
      }
      return sent;
    } finally {
      this.changing = false;
    }
  }

  private notice(tenantId: string, confirmationId: string, kind: ChangeKind): Promise<boolean> {
    return withTenant(this.pool, tenantId, async db => {
      // Checked again in the business: the order still wants it, the shift hasn't ended, and the condition still holds.
      const r = (await db.query<{ orderId: string; shiftId: string; to: string; contactName: string; clientReference: string | null; personName: string;
        siteName: string; areaName: string | null; localDate: string; localStart: string; localEnd: string; businessName: string;
        wasAreaName: string | null; wasLocalDate: string | null; wasLocalStart: string | null; wasLocalEnd: string | null;
        status: string; stillOn: boolean; someoneElseBooked: boolean; differs: boolean; startsAt: Date; endsAt: Date; areaId: string | null }>(
        `select o.id as "orderId", s.id as "shiftId", o.requested_by_email as to, o.requested_by_name as "contactName", o.client_reference as "clientReference",
                coalesce(nullif(trim(w.preferred_name), ''), w.first_name) || ' ' || w.last_name as "personName",
                f.name as "siteName", a.name as "areaName",
                to_char(s.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "localDate",
                to_char(s.starts_at at time zone f.timezone, 'HH24:MI') as "localStart",
                to_char(s.ends_at at time zone f.timezone, 'HH24:MI') as "localEnd",
                (select name from tenants where id = s.tenant_id) as "businessName",
                (select name from areas where id = t.area_id) as "wasAreaName",
                to_char(t.starts_at at time zone f.timezone, 'YYYY-MM-DD') as "wasLocalDate",
                to_char(t.starts_at at time zone f.timezone, 'HH24:MI') as "wasLocalStart",
                to_char(t.ends_at at time zone f.timezone, 'HH24:MI') as "wasLocalEnd",
                s.status, s.starts_at as "startsAt", s.ends_at as "endsAt", s.area_id as "areaId",
                exists (select 1 from shift_assignments sa where sa.shift_id = s.id and sa.resource_kind = 'worker'
                          and sa.worker_id = c.worker_id and sa.status in ('assigned', 'confirmed')) as "stillOn",
                exists (select 1 from shift_assignments sa where sa.shift_id = s.id and sa.resource_kind = 'worker'
                          and sa.worker_id <> c.worker_id and sa.status = 'confirmed') as "someoneElseBooked",
                t.starts_at is not null and (t.starts_at, t.ends_at, t.area_id) is distinct from (s.starts_at, s.ends_at, s.area_id) as differs
           from client_order_confirmations c
           join client_orders o on o.id = c.order_id
           join shifts s on s.id = c.shift_id
           join facilities f on f.id = s.facility_id
           left join areas a on a.id = s.area_id
           join workers w on w.id = c.worker_id
           cross join lateral app_client_told(c.id) t
          where c.id = $1 and o.confirm_to_client and o.requested_by_email is not null and s.ends_at > now()`,
        [confirmationId])).rows[0];
      if (!r) return false;
      const holds = kind === 'cancelled' ? r.status === 'cancelled'
        : kind === 'removed' ? r.status !== 'cancelled' && !r.stillOn
        : r.status !== 'cancelled' && r.stillOn && r.differs;
      if (!holds) return false;
      const { subject, body } = clientChangeEmail({
        kind, ...r,
        wasLocalDate: r.wasLocalDate ?? undefined, wasLocalStart: r.wasLocalStart ?? undefined, wasLocalEnd: r.wasLocalEnd ?? undefined,
      }, await wordsFor(db));
      const dedupeKey = kind === 'cancelled' ? `client-cancelled:${r.shiftId}`
        : kind === 'removed' ? `client-removed:${confirmationId}`
        : `client-changed:${confirmationId}:${r.startsAt.toISOString()}:${r.endsAt.toISOString()}:${r.areaId ?? '-'}`;
      const q = await queueNotification(db, tenantId, { channel: 'email', to: r.to, template: `client_booking_${kind}`, subject, body, dedupeKey });
      const saved = await db.query(
        `insert into client_order_notices(tenant_id, order_id, shift_id, confirmation_id, kind, starts_at, ends_at, area_id, notification_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
        [tenantId, r.orderId, r.shiftId, confirmationId, kind, r.startsAt, r.endsAt, r.areaId, q.id]);
      return Boolean(saved.rowCount) && q.id !== null;
    });
  }
}
