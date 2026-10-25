import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, int } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { BANK_FILL_TYPES, bookedMessage, filledMessage, offerMessage, offerState, type OfferShift } from './bank-fill.js';
import { eligibilityForShift, rankCandidates } from './eligibility-data.js';
import { closePendingOffers } from './offers-data.js';
import { shiftById } from './roster.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OFFERS = 50;

const OFFER_COLS = `o.id, o.shift_id as "shiftId", o.worker_id as "workerId",
  coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName",
  o.status, o.expires_at as "expiresAt", o.created_at as "offeredAt", o.responded_at as "respondedAt"`;

interface OfferRow { id: string; shiftId: string; workerId: string; workerName: string; status: string; expiresAt: Date | null; offeredAt: Date; respondedAt: Date | null }
const shown = (o: OfferRow) => ({ ...o, status: offerState(o.status, o.expiresAt) });

async function offersFor(db: PoolClient, shiftId: string) {
  return (await db.query<OfferRow>(
    `select ${OFFER_COLS} from shift_offers o join workers w on w.id = o.worker_id where o.shift_id = $1 order by o.created_at, w.last_name`, [shiftId],
  )).rows.map(shown);
}

function expiresLabel(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: timezone, hour: 'numeric', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'short' }).format(at);
}

async function contacts(db: PoolClient, ids: string[]) {
  return new Map((await db.query<{ id: string; first: string; email: string | null; phone: string | null }>(
    `select id, coalesce(preferred_name, first_name) as first, email, phone from workers where id = any($1)`, [ids])).rows.map(r => [r.id, r]));
}

/**
 * Bank fill (backlog item 6): the business's own bank and casual staff for an open shift, offers to several,
 * and the first to accept is booked. Replies are recorded by the office until the worker app (item 9).
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class BankFillController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Bank and casual staff (or `everyone=true`), ready first, fewest hours that week first, with any offer already made. */
  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/bank-fill')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string, @Query('everyone') everyone?: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const shift = await shiftById(db, id);
      const offers = await offersFor(db, id);
      if (shift.equipmentOnly) return { shift, candidates: [], offers }; // nobody goes on an equipment-only shift
      const latest = new Map<string, OfferRow>();
      for (const o of offers) latest.set(o.workerId, o);
      const all = rankCandidates(await eligibilityForShift(db, t.tenantId, id));
      const pool = everyone === 'true' ? all : all.filter(c => (BANK_FILL_TYPES as readonly string[]).includes(c.employmentType ?? ''));
      return {
        shift,
        candidates: pool.map(c => ({ ...c, offer: latest.get(c.workerId) ? { id: latest.get(c.workerId)!.id, status: latest.get(c.workerId)!.status } : null })),
        offers,
      };
    });
  }

  @Roles(...OFFICE_ROLES)
  @Get('shifts/:id/offers')
  offers(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await shiftById(db, id);
      return offersFor(db, id);
    });
  }

  /**
   * Offers an open shift to several people at once. Everyone must be eligible on the shift date.
   * Each is sent an email and an SMS (where they have them) unless `notify` is false.
   */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/offers')
  offer(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const raw = body?.workerIds;
    if (!Array.isArray(raw) || !raw.length || raw.some(x => typeof x !== 'string' || !UUID.test(x))) throw new BadRequestException('Choose at least one person');
    const workerIds = [...new Set(raw as string[])];
    if (workerIds.length > MAX_OFFERS) throw new BadRequestException(`Offer to ${MAX_OFFERS} people or fewer at a time`);
    const minutes = int(body, 'expiresInMinutes', 5, 7 * 24 * 60);
    const notify = bool(body, 'notify') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      const row = (await db.query<{ status: string; needs_person: boolean; ended: boolean }>(
        'select status, needs_person, ends_at <= now() as ended from shifts where id = $1 for update', [id])).rows[0];
      if (!row) throw new NotFoundException('Shift not found');
      if (row.status === 'cancelled') throw new ConflictException('This shift is cancelled');
      if (!row.needs_person) throw new ConflictException('This shift is for equipment only, so nobody can be put on it');
      if (row.status !== 'open') throw new ConflictException('Someone is already on this shift');
      if (row.ended) throw new ConflictException('This shift has already finished');
      const checks = await eligibilityForShift(db, t.tenantId, id, workerIds);
      if (checks.length !== workerIds.length) throw new BadRequestException('Choose people from your staff list');
      const blocked = checks.filter(c => !c.eligible);
      if (blocked.length) throw new ConflictException(blocked.map(c => c.blocks.map(b => b.message).join('. ')).join('. '));

      const pending = new Set((await db.query<{ worker_id: string }>(
        `select worker_id from shift_offers where shift_id = $1 and status = 'pending' and (expires_at is null or expires_at > now())`, [id])).rows.map(r => r.worker_id));
      // An expired offer is closed before asking the same person again.
      await db.query(`update shift_offers set status = 'withdrawn', responded_at = now(), responded_by = $2
                       where shift_id = $1 and status = 'pending' and expires_at <= now()`, [id, auth.userId]);
      const fresh = workerIds.filter(w => !pending.has(w));
      const expiresAt = minutes ? new Date(Date.now() + minutes * 60_000) : null;
      const created = fresh.length ? (await db.query<{ id: string; worker_id: string }>(
        `insert into shift_offers(tenant_id, shift_id, worker_id, expires_at, offered_by)
         select $1, $2, w, $3, $4 from unnest($5::uuid[]) w returning id, worker_id`,
        [t.tenantId, id, expiresAt, auth.userId, fresh])).rows : [];

      let messages = 0;
      if (notify && created.length) {
        const shift = await shiftById(db, id) as OfferShift & { timezone: string };
        const who = await contacts(db, fresh);
        for (const o of created) {
          const c = who.get(o.worker_id)!;
          const m = offerMessage(c.first, t.tenantName, shift, expiresAt ? expiresLabel(expiresAt, shift.timezone) : null);
          if (c.email) {
            await queueNotification(db, t.tenantId, { channel: 'email', to: c.email, template: 'shift_offer', subject: m.subject, body: m.email,
              workerId: o.worker_id, dedupeKey: `offer:${o.id}:email`, createdBy: auth.userId });
            messages++;
          }
          if (c.phone) {
            await queueNotification(db, t.tenantId, { channel: 'sms', to: c.phone, template: 'shift_offer', body: m.sms,
              workerId: o.worker_id, dedupeKey: `offer:${o.id}:sms`, createdBy: auth.userId });
            messages++;
          }
        }
      }
      return {
        offered: created.length,
        alreadyOffered: workerIds.length - fresh.length,
        messages,
        warnings: checks.flatMap(c => c.warnings.map(w => w.message)),
        offers: await offersFor(db, id),
      };
    });
  }

  /**
   * Records that the person accepted. The first to accept is booked (confirmed); everyone else's offer closes as filled.
   * Refused if the shift has been filled, the offer has closed or expired, or the person is no longer eligible.
   */
  @Roles(...OFFICE_ROLES)
  @Post('offers/:offerId/accept')
  @HttpCode(200)
  accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const ref = (await db.query<{ shift_id: string; worker_id: string }>('select shift_id, worker_id from shift_offers where id = $1', [offerId])).rows[0];
      if (!ref) throw new NotFoundException('Offer not found');
      // Lock the shift first, as assigning does: two acceptances for one shift queue here and the second finds it filled.
      const shift = (await db.query<{ status: string }>('select status from shifts where id = $1 for update', [ref.shift_id])).rows[0];
      const offer = (await db.query<{ status: string; expires_at: Date | null }>('select status, expires_at from shift_offers where id = $1 for update', [offerId])).rows[0];
      if (shift.status === 'cancelled') throw new ConflictException('This shift is cancelled');
      if (shift.status !== 'open') throw new ConflictException('This shift has already been filled');
      const state = offerState(offer.status, offer.expires_at);
      if (state === 'expired') throw new ConflictException('This offer has expired. Offer the shift again if they still want it.');
      if (state !== 'pending') throw new ConflictException('This offer is closed');
      // Locking the worker serialises their bookings, so two overlapping shifts can't both be accepted.
      const worker = (await db.query<{ status: string; name: string }>(
        `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`, [ref.worker_id])).rows[0];
      if (worker.status !== 'active') throw new ConflictException(`${worker.name} isn't active`);
      const [check] = await eligibilityForShift(db, t.tenantId, ref.shift_id, [ref.worker_id]);
      if (!check.eligible) throw new ConflictException(check.blocks.map(b => b.message).join('. '));

      await db.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, status, assigned_by) values ($1,$2,$3,'confirmed',$4)`,
        [t.tenantId, ref.shift_id, ref.worker_id, auth.userId]);
      await db.query(`update shifts set status = 'booked', updated_at = now() where id = $1`, [ref.shift_id]);
      await db.query(`update shift_offers set status = 'accepted', responded_at = now(), responded_by = $2 where id = $1`, [offerId, auth.userId]);
      const others = await closePendingOffers(db, ref.shift_id, 'filled', auth.userId);

      const s = await shiftById(db, ref.shift_id);
      const who = await contacts(db, [ref.worker_id, ...others]);
      const me = who.get(ref.worker_id)!;
      const b = bookedMessage(me.first, t.tenantName, s);
      if (me.email) await queueNotification(db, t.tenantId, { channel: 'email', to: me.email, template: 'shift_booked', subject: b.subject, body: b.email, workerId: ref.worker_id, dedupeKey: `offer:${offerId}:booked:email`, createdBy: auth.userId });
      if (me.phone) await queueNotification(db, t.tenantId, { channel: 'sms', to: me.phone, template: 'shift_booked', body: b.sms, workerId: ref.worker_id, dedupeKey: `offer:${offerId}:booked:sms`, createdBy: auth.userId });
      // Let the others know by email (no SMS: it costs, and they can see it's gone when they ask).
      for (const w of others) {
        const c = who.get(w)!;
        if (!c.email) continue;
        const f = filledMessage(c.first, t.tenantName, s);
        await queueNotification(db, t.tenantId, { channel: 'email', to: c.email, template: 'shift_filled', subject: f.subject, body: f.email, workerId: w, dedupeKey: `shift:${ref.shift_id}:filled:${w}:${offerId}`, createdBy: auth.userId });
      }
      return { ...s, warnings: check.warnings.map(w => w.message), offers: await offersFor(db, ref.shift_id) };
    });
  }

  /** Records that the person said no. */
  @Roles(...OFFICE_ROLES)
  @Post('offers/:offerId/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query<OfferRow>(
        `update shift_offers set status = 'declined', responded_at = now(), responded_by = $2 where id = $1 and status = 'pending' returning shift_id as "shiftId"`,
        [offerId, auth.userId]);
      if (!r.rowCount) {
        if (!(await db.query('select 1 from shift_offers where id = $1', [offerId])).rowCount) throw new NotFoundException('Offer not found');
        throw new ConflictException('This offer is closed');
      }
      return offersFor(db, r.rows[0].shiftId);
    });
  }

  /** Withdraws every open offer on the shift. */
  @Roles(...OFFICE_ROLES)
  @Post('shifts/:id/offers/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      await shiftById(db, id);
      const closed = await closePendingOffers(db, id, 'withdrawn', auth.userId);
      return { withdrawn: closed.length, offers: await offersFor(db, id) };
    });
  }
}
