import { Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { withTenant } from '@crop/db';
import type { Pool, PoolClient } from 'pg';
import { Public } from '../auth/decorators.js';
import { APP_POOL } from '../database/database.module.js';
import { hashLinkToken, LINK_TOKEN, offerState, shiftLabel } from './bank-fill.js';
import { acceptOffer, declineOffer } from './offer-replies.js';
import { shiftById } from './roster.controller.js';

const NOT_VALID = "This link isn't valid. Check you've used the whole link from your message.";

/**
 * Offer links (backlog item 6, decided by David 26 Oct): the person an offer was sent to can accept or decline it
 * from the link in their email or text, without signing in, until the worker app exists.
 * The token in the link is the only credential: one person, one offer, 256 random bits, only its hash stored,
 * and it acts only while the offer is pending and not expired. Responses show the shift and the person's first
 * name only; never their records, reasons from their credentials, or anyone else's details.
 * GET never changes anything (mail scanners open links); accepting and declining are POSTs.
 */
@Controller('offer-links')
export class OfferLinksController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  private async find(token: string) {
    if (!LINK_TOKEN.test(token)) throw new NotFoundException(NOT_VALID);
    const db = await this.pool.connect();
    try {
      const r = (await db.query<{ tenant_id: string; offer_id: string }>('select * from app_offer_by_link($1)', [hashLinkToken(token)])).rows[0];
      if (!r) throw new NotFoundException(NOT_VALID);
      return { tenantId: r.tenant_id, offerId: r.offer_id };
    } finally {
      db.release();
    }
  }

  private async view(db: PoolClient, offerId: string) {
    const o = (await db.query<{ shift_id: string; status: string; expires_at: Date | null; first: string; business: string }>(
      `select o.shift_id, o.status, o.expires_at, coalesce(w.preferred_name, w.first_name) as first, t.name as business
         from shift_offers o join workers w on w.id = o.worker_id join tenants t on t.id = o.tenant_id where o.id = $1`, [offerId])).rows[0];
    const s = await shiftById(db, o.shift_id);
    return {
      business: o.business,
      firstName: o.first,
      status: offerState(o.status, o.expires_at),
      expiresAt: o.expires_at,
      shift: {
        label: shiftLabel(s), role: s.role, date: s.localDate, start: s.localStart, end: s.localEnd,
        site: s.facilityName, area: s.areaName, timezone: s.timezone, cancelled: s.status === 'cancelled',
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
    return withTenant(this.pool, tenantId, async db => {
      const name = (await db.query<{ name: string }>('select name from tenants where id = $1', [tenantId])).rows[0].name;
      await acceptOffer(db, { tenantId, tenantName: name }, offerId, null, 'link');
      return this.view(db, offerId);
    });
  }

  @Public()
  @Post(':token/decline')
  @HttpCode(200)
  async decline(@Param('token') token: string) {
    const { tenantId, offerId } = await this.find(token);
    return withTenant(this.pool, tenantId, async db => {
      await declineOffer(db, offerId, null, 'link');
      return this.view(db, offerId);
    });
  }
}
