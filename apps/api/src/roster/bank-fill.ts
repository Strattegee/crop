/**
 * Bank fill (backlog item 6). Pure functions: no database access.
 *
 * To fill an open shift, the office looks at its own bank and casual staff as a list (who is eligible on the
 * shift date, ready first, fewest hours that week first), then puts someone in directly or offers it to several.
 * The first to accept is booked. Messages never include health information or document numbers.
 */
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

/** The office records the reply for now; replying in the worker app comes with backlog item 9. */
export function offerMessage(firstName: string, business: string, s: OfferShift, expiresLabel: string | null) {
  const what = shiftLabel(s);
  const until = expiresLabel ? ` The offer is open until ${expiresLabel}.` : '';
  const sms = `Hi ${firstName}, ${business} has a shift for you: ${what}. Contact ${business} if you'd like it; the first to accept gets it.${until}`;
  return {
    subject: `Shift available: ${fmtDate(s.localDate)} ${s.localStart}–${s.localEnd}`,
    email: `Hi ${firstName},\n\n${business} has a shift available:\n\n${what}\n\nContact ${business} if you'd like it. The first person to accept is booked.${until}\n\nThanks,\n${business}`,
    sms,
  };
}

export function bookedMessage(firstName: string, business: string, s: OfferShift) {
  const what = shiftLabel(s);
  return {
    subject: `You're booked: ${fmtDate(s.localDate)} ${s.localStart}–${s.localEnd}`,
    email: `Hi ${firstName},\n\nYou're booked for this shift:\n\n${what}\n\nThanks,\n${business}`,
    sms: `Hi ${firstName}, you're booked: ${what}. Thanks, ${business}`,
  };
}

export function filledMessage(firstName: string, business: string, s: OfferShift) {
  return {
    subject: `Shift filled: ${fmtDate(s.localDate)} ${s.localStart}–${s.localEnd}`,
    email: `Hi ${firstName},\n\nThe shift we offered you has now been filled:\n\n${shiftLabel(s)}\n\nThanks for your time,\n${business}`,
  };
}

/** Offer status as people see it: a pending offer past its time shows as expired. */
export function offerState(status: string, expiresAt: Date | null, now = new Date()): string {
  return status === 'pending' && expiresAt && expiresAt <= now ? 'expired' : status;
}
