import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { queueNotification } from '../notifications/notify.js';
import { T, wordsFor } from '../terms/words.js';
import { bookedMessage, filledMessage, offerState } from './bank-fill.js';
import { eligibilityForShift } from './eligibility-data.js';
import { closePendingOffers } from './offers-data.js';
import { shiftById } from './roster.controller.js';

/** office (recorded by the office), link (a one-off reply link) or app (the person, signed in to the worker app). */
export type ReplyVia = 'office' | 'link' | 'app';

export async function contacts(db: PoolClient, ids: string[]) {
  return new Map((await db.query<{ id: string; first: string; email: string | null; phone: string | null }>(
    `select id, coalesce(preferred_name, first_name) as first, email, phone from workers where id = any($1)`, [ids])).rows.map(r => [r.id, r]));
}

/**
 * Accepts an offer, whether the office records it or the person uses their link. Run inside withTenant.
 * The first to accept is booked (confirmed); everyone else's offer closes as filled and they get an email.
 * Refused if the shift has been filled, the offer has closed or expired, or the person is no longer eligible.
 * `by` is the signed-in office user, or null for a link.
 */
export async function acceptOffer(db: PoolClient, tenant: { tenantId: string; tenantName: string }, offerId: string, by: string | null, via: ReplyVia) {
  const { tenantId, tenantName } = tenant;
  const words = await wordsFor(db);
  const sh = words.lower(T.shift);
  const ref = (await db.query<{ shift_id: string; worker_id: string }>('select shift_id, worker_id from shift_offers where id = $1', [offerId])).rows[0];
  if (!ref) throw new NotFoundException('Offer not found');
  // Lock the shift first, as assigning does: two acceptances for one shift queue here and the second finds it filled.
  const shift = (await db.query<{ status: string }>('select status from shifts where id = $1 for update', [ref.shift_id])).rows[0];
  const offer = (await db.query<{ status: string; expires_at: Date | null }>('select status, expires_at from shift_offers where id = $1 for update', [offerId])).rows[0];
  if (shift.status === 'cancelled') throw new ConflictException(`This ${sh} is cancelled`);
  if (offer.status === 'accepted') throw new ConflictException(via !== 'office' ? `You've already accepted this ${sh}` : 'This offer has already been accepted');
  if (shift.status !== 'open') throw new ConflictException(`This ${sh} has already been filled`);
  const state = offerState(offer.status, offer.expires_at);
  if (state === 'expired') throw new ConflictException(via !== 'office'
    ? `This offer has expired. Contact ${tenantName} if you'd still like the ${sh}.`
    : `This offer has expired. Offer the ${sh} again if they still want it.`);
  if (state !== 'pending') throw new ConflictException('This offer is closed');
  // Locking the worker serialises their bookings, so two overlapping shifts can't both be accepted.
  const worker = (await db.query<{ status: string; name: string }>(
    `select status, coalesce(preferred_name, first_name) || ' ' || last_name as name from workers where id = $1 for update`, [ref.worker_id])).rows[0];
  if (worker.status !== 'active') throw new ConflictException(via !== 'office' ? `This offer is closed. Contact ${tenantName} for details.` : `${worker.name} isn't active`);
  const [check] = await eligibilityForShift(db, tenantId, ref.shift_id, [ref.worker_id]);
  if (!check.eligible) {
    // The person sees a plain reason without the detail of their records; the office sees the full reasons.
    throw new ConflictException(via !== 'office'
      ? `You can't be booked for this ${sh} right now. Contact ${tenantName} to sort it out.`
      : check.blocks.map(b => b.message).join('. '));
  }

  await db.query(`insert into shift_assignments(tenant_id, shift_id, worker_id, status, assigned_by) values ($1,$2,$3,'confirmed',$4)`,
    [tenantId, ref.shift_id, ref.worker_id, by]);
  await db.query(`update shifts set status = 'booked', updated_at = now() where id = $1`, [ref.shift_id]);
  await db.query(`update shift_offers set status = 'accepted', responded_at = now(), responded_by = $2, responded_via = $3 where id = $1`, [offerId, by, via]);
  const others = await closePendingOffers(db, ref.shift_id, 'filled', by);

  const s = await shiftById(db, ref.shift_id);
  const who = await contacts(db, [ref.worker_id, ...others]);
  const me = who.get(ref.worker_id)!;
  const b = bookedMessage(me.first, tenantName, s, words);
  if (me.email) await queueNotification(db, tenantId, { channel: 'email', to: me.email, template: 'shift_booked', subject: b.subject, body: b.email, workerId: ref.worker_id, dedupeKey: `offer:${offerId}:booked:email`, createdBy: by });
  if (me.phone) await queueNotification(db, tenantId, { channel: 'sms', to: me.phone, template: 'shift_booked', body: b.sms, workerId: ref.worker_id, dedupeKey: `offer:${offerId}:booked:sms`, createdBy: by });
  // Let the others know by email (no SMS: it costs, and they can see it's gone when they ask).
  for (const w of others) {
    const c = who.get(w)!;
    if (!c.email) continue;
    const f = filledMessage(c.first, tenantName, s, words);
    await queueNotification(db, tenantId, { channel: 'email', to: c.email, template: 'shift_filled', subject: f.subject, body: f.email, workerId: w, dedupeKey: `shift:${ref.shift_id}:filled:${w}:${offerId}`, createdBy: by });
  }
  return { shift: s, warnings: check.warnings.map(w => w.message), shiftId: ref.shift_id };
}

/** Records a no. Returns the shift id. */
export async function declineOffer(db: PoolClient, offerId: string, by: string | null, via: ReplyVia) {
  const r = await db.query<{ shiftId: string }>(
    `update shift_offers set status = 'declined', responded_at = now(), responded_by = $2, responded_via = $3
      where id = $1 and status = 'pending' and ($3 = 'office' or expires_at is null or expires_at > now())
      returning shift_id as "shiftId"`,
    [offerId, by, via]);
  if (!r.rowCount) {
    const o = (await db.query<{ status: string; expires_at: Date | null }>('select status, expires_at from shift_offers where id = $1', [offerId])).rows[0];
    if (!o) throw new NotFoundException('Offer not found');
    if (via !== 'office' && o.status === 'declined') throw new ConflictException(`You've already said no to this ${(await wordsFor(db)).lower(T.shift)}`);
    if (offerState(o.status, o.expires_at) === 'expired') throw new ConflictException('This offer has expired');
    throw new ConflictException('This offer is closed');
  }
  return r.rows[0].shiftId;
}
