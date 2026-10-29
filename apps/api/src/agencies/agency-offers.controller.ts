import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { withTenant, type Actor } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { OFFICE_ROLES, type AuthContext, type Membership } from '../auth/auth.types.js';
import { Auth, Public, Roles, Tenant } from '../auth/decorators.js';
import { bool, int } from '../common/validate.js';
import { APP_POOL } from '../database/database.module.js';
import { queueNotification } from '../notifications/notify.js';
import { actorOf } from '../roster/publishing.js';
import { hashLinkToken, LINK_TOKEN, newOfferLink, offerState } from '../roster/bank-fill.js';
import { contacts } from '../roster/offer-replies.js';
import { T, wordsFor } from '../terms/words.js';
import { INBOX_COLS, peopleForRequest, tellEmployer, type InboxRow } from './agency-fill.controller.js';
import { agencyAcceptedMessage, agencyFilledMessage, agencyOfferMessage, agencyShiftLine } from './requests.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OFFERS = 50;
const NOT_VALID = "This link isn't valid. Check you've used the whole link from your message.";

export const agencyOfferLinkUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, '')}/agency-offer/${token}`;

function expiresLabel(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: timezone, hour: 'numeric', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'short' }).format(at);
}

type OfferRow = { id: string; workerId: string; workerName: string; status: string; expiresAt: Date | null; createdAt: Date; offeredByName: string | null;
  respondedAt: Date | null; respondedVia: string | null };

async function offersFor(db: PoolClient, inboxId: string) {
  const rows = (await db.query<OfferRow>(
    `select o.id, o.worker_id as "workerId", coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as "workerName", o.status,
            o.expires_at as "expiresAt", o.created_at as "createdAt", o.offered_by_name as "offeredByName", o.responded_at as "respondedAt",
            o.responded_via as "respondedVia"
       from agency_offers o join workers w on w.id = o.worker_id where o.inbox_id = $1 order by o.created_at, w.last_name, w.first_name`, [inboxId])).rows;
  return rows.map(r => ({ ...r, state: offerState(r.status, r.expiresAt) }));
}

/**
 * Accepts an agency offer (from the person's link, or the office recording their yes). Re-checks the person against
 * the employer's requirements and the agency's own rules in the agency's transaction, then puts them forward through
 * `app_agency_accept_offer` (the same checks as the office putting someone forward). The person is told they are
 * booked or waiting for approval, the others offered it that it has gone, and the employer's office is emailed.
 */
async function acceptAgencyOffer(pool: Pool, tenantId: string, offerId: string, via: 'office' | 'link', actor: Actor) {
  const done = await withTenant(pool, tenantId, async db => {
    const o = (await db.query<{ inbox_id: string; worker_id: string; status: string; expires_at: Date | null; name: string }>(
      `select o.inbox_id, o.worker_id, o.status, o.expires_at, coalesce(w.preferred_name, w.first_name) || ' ' || w.last_name as name
         from agency_offers o join workers w on w.id = o.worker_id where o.id = $1`, [offerId])).rows[0];
    if (!o) throw new NotFoundException('Offer not found');
    const words = await wordsFor(db);
    const sh = words.lower(T.shift);
    const agency = (await db.query<{ name: string }>('select name from tenants where id = $1', [tenantId])).rows[0].name;
    if (via === 'link') await db.query(`select set_config('app.actor_name', $1, true)`, [o.name]);
    // Lock the request's copy, then the person, so two acceptances queue and the second finds it filled.
    // (crop_app can't lock agency_inbox rows, so an advisory lock per request; app_agency_put_forward locks the row itself.)
    await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`agency-inbox:${o.inbox_id}`]);
    const inbox = (await db.query<{ status: string; placed_name: string | null }>('select status, placed_name from agency_inbox where id = $1', [o.inbox_id])).rows[0];
    const state = offerState(o.status, o.expires_at);
    if (state === 'accepted') throw new ConflictException(via === 'link' ? `You've already accepted this ${sh}` : 'This offer has already been accepted');
    if (inbox.status !== 'open' || state === 'filled') throw new ConflictException(`This ${sh} has already been filled or taken back`);
    if (state === 'expired') throw new ConflictException(via === 'link' ? `This offer has expired. Contact ${agency} if you'd still like the ${sh}.` : 'This offer has expired');
    if (state !== 'pending') throw new ConflictException('This offer is closed');
    await db.query('select 1 from workers where id = $1 for update', [o.worker_id]);
    const { people } = await peopleForRequest(db, tenantId, o.inbox_id, [o.worker_id]);
    const p = people[0];
    if (!p || !p.eligible) {
      throw new ConflictException(via === 'link'
        ? `You can't be put forward for this ${sh} right now. Contact ${agency} to sort it out.`
        : `${o.name} can't go: ${p ? p.blocks.map(b => b.message).join('. ') : 'not one of your active people'}`);
    }
    const others = (await db.query<{ id: string; worker_id: string }>(
      `select id, worker_id from agency_offers where inbox_id = $1 and status = 'pending' and id <> $2`, [o.inbox_id, offerId])).rows;
    const placed = (await db.query<{ employer_tenant_id: string; placement_id: string; booked: boolean }>(
      'select * from app_agency_accept_offer($1)', [offerId])).rows[0];

    const row = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [o.inbox_id])).rows[0];
    const who = await contacts(db, [o.worker_id, ...others.map(x => x.worker_id)]);
    const me = who.get(o.worker_id)!;
    const m = agencyAcceptedMessage(me.first, agency, row, placed.booked, words);
    if (me.email) await queueNotification(db, tenantId, { channel: 'email', to: me.email, template: 'agency_offer_accepted', subject: m.subject, body: m.email, workerId: o.worker_id, dedupeKey: `agency-offer:${offerId}:accepted:email` });
    if (me.phone) await queueNotification(db, tenantId, { channel: 'sms', to: me.phone, template: 'agency_offer_accepted', body: m.sms, workerId: o.worker_id, dedupeKey: `agency-offer:${offerId}:accepted:sms` });
    // The others by email only (no SMS: it costs, and the link says it's gone).
    for (const x of others) {
      const c = who.get(x.worker_id);
      if (!c?.email) continue;
      const f = agencyFilledMessage(c.first, agency, row, words);
      await queueNotification(db, tenantId, { channel: 'email', to: c.email, template: 'agency_offer_filled', subject: f.subject, body: f.email, workerId: x.worker_id, dedupeKey: `agency-offer:${x.id}:filled` });
    }
    return { ...placed, name: o.name };
  }, actor);
  await tellEmployer(pool, done.employer_tenant_id, done.placement_id);
  return done;
}

/**
 * Agency fill, offering (backlog item 8, migration 0044): the agency offers a request to several of its own people
 * who can go, by email and text with a one-off link each; the first to accept is put forward (as Put forward does)
 * and the rest are told it has gone. Agency-side only: nothing reaches the employer until someone accepts.
 */
@ApiBearerAuth()
@ApiSecurity('tenant')
@Controller()
export class AgencyOffersController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** The offers made on one of this business's requests, with each one's state (pending, expired, accepted, declined, withdrawn, filled). */
  @Roles(...OFFICE_ROLES)
  @Get('agency-requests/:id/offers')
  list(@Tenant() t: Membership, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from agency_inbox where id = $1', [id])).rowCount) throw new NotFoundException('Request not found');
      return offersFor(db, id);
    });
  }

  /**
   * Offers an open request to several of this business's people (`{ workerIds, expiresInMinutes?, notify? }`). Each
   * must be able to go (the employer's requirements as matched, and this business's own rules). Each gets an email
   * and a text with a one-off link (when APP_URL is set) unless `notify: false`. Someone already offered it isn't
   * asked twice.
   */
  @Roles(...OFFICE_ROLES)
  @Post('agency-requests/:id/offers')
  offer(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    const raw = body?.workerIds;
    if (!Array.isArray(raw) || !raw.length || raw.some(x => typeof x !== 'string' || !UUID.test(x))) throw new BadRequestException('Choose at least one person');
    const workerIds = [...new Set(raw as string[])];
    if (workerIds.length > MAX_OFFERS) throw new BadRequestException(`Offer to ${MAX_OFFERS} people or fewer at a time`);
    const minutes = int(body, 'expiresInMinutes', 5, 7 * 24 * 60);
    const notify = bool(body, 'notify') ?? true;
    return withTenant(this.pool, t.tenantId, async db => {
      const words = await wordsFor(db);
      await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`agency-inbox:${id}`]);
      const inbox = (await db.query<InboxRow>(`select ${INBOX_COLS} from agency_inbox where id = $1`, [id])).rows[0];
      if (!inbox) throw new NotFoundException('Request not found');
      if (inbox.status !== 'open') throw new ConflictException(`This request has closed${inbox.closedReason ? `: ${inbox.closedReason}` : ''}`);
      if (new Date(inbox.startsAt).getTime() <= Date.now()) throw new ConflictException(`This ${words.lower(T.shift)} has already started`);
      const { people } = await peopleForRequest(db, t.tenantId, id, workerIds);
      if (people.length !== workerIds.length) throw new BadRequestException(`Choose people from your ${words.lower(T.worker)} list`);
      const blocked = people.filter(p => !p.eligible);
      if (blocked.length) throw new ConflictException(blocked.map(p => `${p.name} can't go: ${p.blocks.map(b => b.message).join('. ')}`).join(' '));

      // An expired offer is closed before asking the same person again.
      await db.query(`update agency_offers set status = 'withdrawn', responded_at = now() where inbox_id = $1 and status = 'pending' and expires_at <= now()`, [id]);
      const pending = new Set((await db.query<{ worker_id: string }>(`select worker_id from agency_offers where inbox_id = $1 and status = 'pending'`, [id])).rows.map(r => r.worker_id));
      const fresh = workerIds.filter(w => !pending.has(w));
      const expiresAt = minutes ? new Date(Math.min(Date.now() + minutes * 60_000, new Date(inbox.startsAt).getTime())) : null;
      const by = auth.displayName || auth.email;
      const created = fresh.length ? (await db.query<{ id: string; worker_id: string }>(
        `insert into agency_offers(tenant_id, inbox_id, worker_id, expires_at, offered_by, offered_by_name)
         select $1, $2, w, $3, $4, $5 from unnest($6::uuid[]) w returning id, worker_id`,
        [t.tenantId, id, expiresAt, auth.userId, by, fresh])).rows : [];

      let messages = 0;
      if (notify && created.length) {
        const who = await contacts(db, fresh);
        const appUrl = process.env.APP_URL ?? '';
        for (const o of created) {
          const c = who.get(o.worker_id)!;
          let link: string | null = null;
          if (appUrl && (c.email || c.phone)) {
            const l = newOfferLink();
            await db.query('update agency_offers set link_hash = $2 where id = $1', [o.id, l.hash]);
            link = agencyOfferLinkUrl(appUrl, l.token);
          }
          const m = agencyOfferMessage(c.first, t.tenantName, inbox, expiresAt ? expiresLabel(expiresAt, inbox.siteTimezone) : null, link, words);
          if (c.email) {
            await queueNotification(db, t.tenantId, { channel: 'email', to: c.email, template: 'agency_offer', subject: m.subject, body: m.email,
              workerId: o.worker_id, dedupeKey: `agency-offer:${o.id}:email`, createdBy: auth.userId });
            messages++;
          }
          if (c.phone) {
            await queueNotification(db, t.tenantId, { channel: 'sms', to: c.phone, template: 'agency_offer', body: m.sms,
              workerId: o.worker_id, dedupeKey: `agency-offer:${o.id}:sms`, createdBy: auth.userId });
            messages++;
          }
        }
      }
      return {
        offered: created.length,
        alreadyOffered: workerIds.length - fresh.length,
        messages,
        warnings: people.flatMap(p => p.warnings.map(w => `${p.name}: ${w.message}`)),
        offers: await offersFor(db, id),
      };
    }, actorOf(auth));
  }

  /** Withdraws every pending offer on a request (the people's links stop working). */
  @Roles(...OFFICE_ROLES)
  @Post('agency-requests/:id/offers/withdraw')
  @HttpCode(200)
  withdraw(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      if (!(await db.query('select 1 from agency_inbox where id = $1', [id])).rowCount) throw new NotFoundException('Request not found');
      const r = await db.query(`update agency_offers set status = 'withdrawn', responded_at = now(), responded_via = 'office', responded_by_name = $2
                                 where inbox_id = $1 and status = 'pending'`, [id, auth.displayName || auth.email]);
      return { withdrawn: r.rowCount ?? 0, offers: await offersFor(db, id) };
    });
  }

  /** The office records that the person said yes (see `acceptAgencyOffer`). */
  @Roles(...OFFICE_ROLES)
  @Post('agency-offers/:id/accept')
  @HttpCode(200)
  async accept(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await acceptAgencyOffer(this.pool, t.tenantId, id, 'office', actorOf(auth));
    return { booked: r.booked, name: r.name };
  }

  /** The office records that the person said no. */
  @Roles(...OFFICE_ROLES)
  @Post('agency-offers/:id/decline')
  @HttpCode(200)
  decline(@Tenant() t: Membership, @Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.pool, t.tenantId, async db => {
      const r = await db.query(`update agency_offers set status = 'declined', responded_at = now(), responded_via = 'office', responded_by_name = $2
                                 where id = $1 and status = 'pending'`, [id, auth.displayName || auth.email]);
      if (!r.rowCount) {
        if (!(await db.query('select 1 from agency_offers where id = $1', [id])).rowCount) throw new NotFoundException('Offer not found');
        throw new ConflictException('This offer is closed');
      }
      return { declined: true };
    });
  }
}

/**
 * Agency offer links: the agency's person accepts or declines without signing in, as with an employer's own offer
 * links (`offer-links.controller.ts`): the token is the only credential (one person, one offer, only its hash
 * stored), GET never changes anything, and responses show the person's first name and the shift only.
 */
@Controller('agency-offer-links')
export class AgencyOfferLinksController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async find(token: string) {
    if (!LINK_TOKEN.test(token)) throw new NotFoundException(NOT_VALID);
    const r = (await this.pool.query<{ tenant_id: string; offer_id: string }>('select * from app_agency_offer_by_link($1)', [hashLinkToken(token)])).rows[0];
    if (!r) throw new NotFoundException(NOT_VALID);
    return { tenantId: r.tenant_id, offerId: r.offer_id };
  }

  private async view(db: PoolClient, offerId: string) {
    const o = (await db.query<{ inbox_id: string; status: string; expires_at: Date | null; first: string; business: string }>(
      `select o.inbox_id, o.status, o.expires_at, coalesce(w.preferred_name, w.first_name) as first, t.name as business
         from agency_offers o join workers w on w.id = o.worker_id join tenants t on t.id = o.tenant_id where o.id = $1`, [offerId])).rows[0];
    const s = (await db.query<InboxRow & { localDate: string; localStart: string; localEnd: string }>(
      `select ${INBOX_COLS}, to_char(starts_at at time zone site_timezone, 'YYYY-MM-DD') as "localDate",
              to_char(starts_at at time zone site_timezone, 'HH24:MI') as "localStart", to_char(ends_at at time zone site_timezone, 'HH24:MI') as "localEnd"
         from agency_inbox where id = $1`, [o.inbox_id])).rows[0];
    const w = await wordsFor(db);
    return {
      business: o.business,
      word: { one: w.one(T.shift), lower: w.lower(T.shift) },
      firstName: o.first,
      status: offerState(o.status, o.expires_at),
      expiresAt: o.expires_at,
      employer: s.employerName,
      shift: {
        label: agencyShiftLine(s), role: s.role, date: s.localDate, start: s.localStart, end: s.localEnd,
        site: s.siteName, area: s.areaName, timezone: s.siteTimezone, cancelled: false,
      },
    };
  }

  @Public()
  @Get(':token')
  async get(@Param('token') token: string) {
    const { tenantId, offerId } = await this.find(token);
    return withTenant(this.pool, tenantId, db => this.view(db, offerId));
  }

  @Public()
  @Post(':token/accept')
  @HttpCode(200)
  async accept(@Param('token') token: string) {
    const { tenantId, offerId } = await this.find(token);
    await acceptAgencyOffer(this.pool, tenantId, offerId, 'link', { via: 'link' });
    return withTenant(this.pool, tenantId, db => this.view(db, offerId));
  }

  @Public()
  @Post(':token/decline')
  @HttpCode(200)
  async decline(@Param('token') token: string) {
    const { tenantId, offerId } = await this.find(token);
    return withTenant(this.pool, tenantId, async db => {
      const r = await db.query(`update agency_offers set status = 'declined', responded_at = now(), responded_via = 'link'
                                 where id = $1 and status = 'pending' and (expires_at is null or expires_at > now())`, [offerId]);
      if (!r.rowCount) {
        const o = (await db.query<{ status: string; expires_at: Date | null }>('select status, expires_at from agency_offers where id = $1', [offerId])).rows[0];
        const sh = (await wordsFor(db)).lower(T.shift);
        if (o.status === 'declined') throw new ConflictException(`You've already said no to this ${sh}`);
        if (offerState(o.status, o.expires_at) === 'expired') throw new ConflictException('This offer has expired');
        throw new ConflictException('This offer is closed');
      }
      return this.view(db, offerId);
    });
  }
}
