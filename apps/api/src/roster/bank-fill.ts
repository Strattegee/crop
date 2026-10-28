/**
 * Bank fill (backlog item 6). Pure functions: no database access.
 *
 * To fill an open shift, the office looks at its own bank and casual staff as a list (who is eligible on the
 * shift date, ready first, fewest hours that week first), then puts someone in directly or offers it to several.
 * The first to accept is booked. Messages never include health information or document numbers.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';
import { fmtDate } from './eligibility.js';

export const BANK_FILL_TYPES = ['bank', 'casual'] as const;

export interface OfferShift {
  role: string;
  localDate: string;
  localStart: string;
  localEnd: string;
  facilityName: string;
  areaName: string | null;
}

/** e.g. "Mon 2 Nov, 07:00–15:30, Chef at Harbour Kitchen (Kitchen)". */
export function shiftLabel(s: OfferShift): string {
  return `${fmtDate(s.localDate)}, ${s.localStart}–${s.localEnd}, ${s.role} at ${s.facilityName}${s.areaName ? ` (${s.areaName})` : ''}`;
}

/**
 * The offer message. With `link`, the person can accept or decline from it without signing in (decided 26 Oct);
 * without one (no APP_URL set), they contact the business and the office records the reply.
 */
export function offerMessage(firstName: string, business: string, s: OfferShift, expiresLabel: string | null, link: string | null = null, w: Words = DEFAULT_WORDS) {
  const what = shiftLabel(s);
  const until = expiresLabel ? ` The offer is open until ${expiresLabel}.` : '';
  const subject = `${w.one(T.shift)} available: ${fmtDate(s.localDate)} ${s.localStart}–${s.localEnd}`;
  const aShift = w.a(T.shift);
  if (link) {
    return {
      subject,
      email: `Hi ${firstName},\n\n${business} has ${aShift} available:\n\n${what}\n\nAccept or decline here: ${link}\n\nThe first person to accept is booked.${until} This link is just for you, so please don't forward it.\n\nThanks,\n${business}`,
      sms: `Hi ${firstName}, ${business} has ${aShift} for you: ${what}. Accept or decline: ${link} (first to accept gets it).${until}`,
    };
  }
  const sms = `Hi ${firstName}, ${business} has ${aShift} for you: ${what}. Contact ${business} if you'd like it; the first to accept gets it.${until}`;
  return {
    subject,
    email: `Hi ${firstName},\n\n${business} has ${aShift} available:\n\n${what}\n\nContact ${business} if you'd like it. The first person to accept is booked.${until}\n\nThanks,\n${business}`,
    sms,
  };
}

/** Offer link tokens: 32 random bytes (base64url, 43 characters). Only the SHA-256 hash is stored. */
export const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const hashLinkToken = (token: string) => createHash('sha256').update(token, 'utf8').digest();
export function newOfferLink() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}
export const offerLinkUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, '')}/offer/${token}`;

export function bookedMessage(firstName: string, business: string, s: OfferShift, w: Words = DEFAULT_WORDS) {
  const what = shiftLabel(s);
  return {
    subject: `You're booked: ${fmtDate(s.localDate)} ${s.localStart}–${s.localEnd}`,
    email: `Hi ${firstName},\n\nYou're booked for this ${w.lower(T.shift)}:\n\n${what}\n\nThanks,\n${business}`,
    sms: `Hi ${firstName}, you're booked: ${what}. Thanks, ${business}`,
  };
}

export function filledMessage(firstName: string, business: string, s: OfferShift, w: Words = DEFAULT_WORDS) {
  return {
    subject: `${w.one(T.shift)} filled: ${fmtDate(s.localDate)} ${s.localStart}–${s.localEnd}`,
    email: `Hi ${firstName},\n\nThe ${w.lower(T.shift)} we offered you has now been filled:\n\n${shiftLabel(s)}\n\nThanks for your time,\n${business}`,
  };
}

/** Offer status as people see it: a pending offer past its time shows as expired. */
export function offerState(status: string, expiresAt: Date | null, now = new Date()): string {
  return status === 'pending' && expiresAt && expiresAt <= now ? 'expired' : status;
}
