import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Roles, Tenant } from '../auth/decorators.js';
import { bool, int } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { wordsFor } from '../terms/words.js';
import { BANK_FILL_TYPES, newOfferLink, offerLinkUrl, offerMessage, offerState, type OfferShift } from './bank-fill.js';
import { eligibilityForShift, rankCandidates } from './eligibility-data.js';
import { acceptOffer, contacts, declineOffer } from './offer-replies.js';
import { closePendingOffers } from './offers-data.js';
import { actorOf } from './publishing.js';
import { rosterChangeRefusal } from './offers-data.js';
import { shiftById } from './roster.controller.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OFFERS = 50;

const OFFER_COLS = `o.id, o.shift_id as "shiftId", o.worker_id as "workerId",
  coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName",
  o.status, o.expires_at as "expiresAt", o.created_at as "offeredAt", o.responded_at as "respondedAt", o.responded_via as "respondedVia"`;

interface OfferRow { id: string; shiftId: string; workerId: string; workerName: string; status: string; expiresAt: Date | null; offeredAt: Date; respondedAt: Date | null; respondedVia: string | null }
const shown = (o: OfferRow) => ({ ...o, status: offerState(o.status, o.expiresAt) });

async function offersFor(db: PoolClient, shiftId: string) {
  return (await db.query<OfferRow>(
    `select ${OFFER_COLS} from shift_offers o join workers w on w.id = o.worker_id where o.shift_id = $1 order by o.created_at, w.last_name`, [shiftId],
  )).rows.map(shown);
}

function expiresLabel(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: timezone, hour: 'numeric', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'short' }).format(at);
}

/**
 * Bank fill (backlog item 6): the business's own bank and casual staff for an open shift, offers to several,
 * and the first to accept is booked. Replies are recorded by the office, or by the person from the link in their message (`offer-links.controller.ts`).
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
      // Offering doesn't change the shift, but accepting would, so the after-publishing rule is checked now.
      const refusal = await rosterChangeRefusal(db, id);
      if (refusal) throw new ConflictException(refusal);
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
        const words = await wordsFor(db);
        const appUrl = process.env.APP_URL ?? '';
        for (const o of created) {
          const c = who.get(o.worker_id)!;
          // A one-off link to accept or decline without signing in (decided 26 Oct). Only its hash is kept.
          let link: string | null = null;
          if (appUrl && (c.email || c.phone)) {
            const l = newOfferLink();
            await db.query('update shift_offers set link_hash = $2 where id = $1', [o.id, l.hash]);
            link = offerLinkUrl(appUrl, l.token);
          }
          const m = offerMessage(c.first, t.tenantName, shift, expiresAt ? expiresLabel(expiresAt, shift.timezone) : null, link, words);
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
    }, actorOf(auth));
  }

  /** Records that the person accepted (see `acceptOffer`). */
  @Roles(...OFFICE_ROLES)
  @Post('offers/:offerId/accept')
  @HttpCode(200)
  accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await acceptOffer(db, t, offerId, auth.userId, 'office');
      return { ...r.shift, warnings: r.warnings, offers: await offersFor(db, r.shiftId) };
    }, actorOf(auth));
  }

  /** Records that the person said no. */
  @Roles(...OFFICE_ROLES)
  @Post('offers/:offerId/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return withTenant(this.pool, t.tenantId, async db => offersFor(db, await declineOffer(db, offerId, auth.userId, 'office')));
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
