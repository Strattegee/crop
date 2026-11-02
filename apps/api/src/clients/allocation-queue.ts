/**
 * The allocation queue (David chose layout A, 2 Nov 2026): client shifts still needing work, most urgent first, with
 * a fill panel beside them. Pure rules: no database access.
 *
 * A row's queue stage comes from the client-shift stage (`clientShiftStage`) plus whether the last person on it pulled
 * out. Tabs filter by stage; "all" is everything still needing someone; "booked_today" is what was finalised today.
 */
import { clientShiftStage } from './client-orders.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export type QueueStage = 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked';
export type QueueTab = 'all' | 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked_today';
export const QUEUE_TABS: readonly QueueTab[] = ['all', 'new', 'released', 'accepted', 'worker_to_confirm', 'client_to_confirm', 'pulled_out', 'booked_today'];
export type QueueBand = 'started' | 'soon' | 'today' | 'tomorrow' | 'later';
export const QUEUE_BANDS: readonly QueueBand[] = ['started', 'soon', 'today', 'tomorrow', 'later'];

export interface StageFacts {
  status: string;
  offersPending: number;
  /** The last person taken off this shift pulled out, and nobody is on it now. */
  pulledOut: boolean;
  clientConfirms?: boolean;
  clientConfirmedAt?: string | Date | null;
}

/**
 * The queue stage: open shifts are New (nobody has it on offer) or Released to bank (offers waiting), unless the last
 * person pulled out, which outranks both so it stands out; then the roster's stages.
 */
export function queueStage(s: StageFacts): QueueStage {
  const c = clientShiftStage(s);
  if ((c === 'open' || c === 'offered') && s.pulledOut && s.status === 'open') return 'pulled_out';
  switch (c) {
    case 'open': return 'new';
    case 'offered': return 'released';
    case 'assigned': return 'accepted';
    default: return c;
  }
}

/** Whether a row in this stage is on a tab (booked rows only on "Booked today", and only when booked today). */
export function onTab(tab: QueueTab, stage: QueueStage, bookedToday: boolean): boolean {
  if (tab === 'booked_today') return stage === 'booked' && bookedToday;
  if (stage === 'booked') return false;
  return tab === 'all' || tab === stage;
}

/** Reads `?stage=` (anything else is "all"). */
export const parseTab = (v: string | undefined): QueueTab => ((QUEUE_TABS as readonly string[]).includes(v ?? '') ? v as QueueTab : 'all');

/**
 * How soon a shift starts, in the site's time zone: already started, within 2 hours, later today, tomorrow or later.
 * `siteToday`/`siteTomorrow` are the site's local dates now.
 */
export function queueBand(s: { startsAt: string | Date; localDate: string }, now: Date, siteToday: string, siteTomorrow: string): QueueBand {
  const starts = new Date(s.startsAt).getTime();
  if (starts <= now.getTime()) return 'started';
  if (starts - now.getTime() <= 2 * 3600_000) return 'soon';
  if (s.localDate <= siteToday) return 'today';
  if (s.localDate === siteTomorrow) return 'tomorrow';
  return 'later';
}

export interface ProgressFacts {
  stage: QueueStage;
  workerName: string | null;
  offersTotal: number;
  offersPending: number;
  offersDeclined: number;
  /** Local time (HH:MM) the person on it accepted an offer, or was put on it. */
  acceptedAt: string | null;
  viaOffer: boolean;
  pulledOutName: string | null;
  pulledOutAt: string | null;
  withAgencies: boolean;
}

/** One short line on how filling is going: "Offered 6 · 2 declined", "Tom Example accepted 18:58", "Not offered yet". */
export function progressLine(p: ProgressFacts, w: Words = DEFAULT_WORDS): string {
  const offers = p.offersTotal === 0 ? null
    : `Offered ${p.offersTotal}${p.offersDeclined ? ` · ${p.offersDeclined} declined` : p.offersPending === p.offersTotal ? ' · no replies' : ''}`;
  const agencies = p.withAgencies ? `With ${w.lower(T.agency, true)}` : null;
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(' · ');
  const who = p.workerName ?? 'Someone';
  switch (p.stage) {
    case 'pulled_out':
      return join(`${p.pulledOutName ?? 'Someone'} pulled out${p.pulledOutAt ? ` ${p.pulledOutAt}` : ''}`, offers ?? 'rebook', agencies);
    case 'accepted':
      return `${who} ${p.viaOffer ? 'accepted' : 'allocated'}${p.acceptedAt ? ` ${p.acceptedAt}` : ''} · confirm`;
    case 'worker_to_confirm':
      return `${w.one(T.client)} happy · waiting for ${who}`;
    case 'client_to_confirm':
      return `${who} booked · waiting for the ${w.lower(T.client)}`;
    case 'booked':
      return `${who} booked`;
    default:
      return join(offers ?? (agencies ? null : 'Not offered yet'), agencies);
  }
}

/** Shifts within a band: start time, then client rank (1 first, unranked last), then client and site names. */
export function queueOrder<R extends { startsAt: string | Date; clientRank: number | null; clientName: string; facilityName: string }>(a: R, b: R): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    || (a.clientRank ?? 99) - (b.clientRank ?? 99)
    || a.clientName.localeCompare(b.clientName) || a.facilityName.localeCompare(b.facilityName);
}

/** "JM" from "Jo Manager" (or an email's first letters). */
export function initialsOf(name: string): string {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const s = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}
