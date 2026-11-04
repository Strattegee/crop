/**
 * The allocation queue (David chose layout A, 2 Nov 2026): client shifts still needing work, most urgent first, with
 * a fill panel beside them. Pure rules: no database access.
 *
 * A row's queue stage comes from the client-shift stage (`clientShiftStage`) plus whether the last person on it pulled
 * out. Tabs filter by stage; "all" is everything still needing someone; "booked_today" is what was finalised today.
 */
import { clientShiftStage } from './client-orders.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';
import { livePeriod } from '../dashboard/kpis.js';

/** Stages of a shift still to come (or under way): what the office still has to do. */
export type LiveStage = 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked';
/**
 * What happened to a shift that has ended or was cancelled (David, 4 Nov: calendar periods show the past too):
 * worked (booked and ended), unfilled (ended with nobody), not_refilled (ended with nobody after someone pulled out),
 * unconfirmed (ended with someone allocated who never confirmed) or cancelled (any time, with its cancel kind).
 */
export type OutcomeStage = 'worked' | 'unfilled' | 'not_refilled' | 'unconfirmed' | 'cancelled';
export type QueueStage = LiveStage | OutcomeStage;
export const OUTCOME_STAGES: readonly OutcomeStage[] = ['worked', 'unfilled', 'not_refilled', 'unconfirmed', 'cancelled'];
export const isOutcome = (s: QueueStage): s is OutcomeStage => (OUTCOME_STAGES as readonly string[]).includes(s);

export type LiveTab = 'all' | 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked_today';
/** Outcome tabs, only for calendar periods: done = everything ended or cancelled; unfilled includes not refilled. */
export type OutcomeTab = 'done' | 'worked' | 'unfilled' | 'cancelled';
export type QueueTab = LiveTab | OutcomeTab;
export const LIVE_TABS: readonly LiveTab[] = ['all', 'new', 'released', 'accepted', 'worker_to_confirm', 'client_to_confirm', 'pulled_out', 'booked_today'];
export const OUTCOME_TABS: readonly OutcomeTab[] = ['done', 'worked', 'unfilled', 'cancelled'];
export const QUEUE_TABS: readonly QueueTab[] = [...LIVE_TABS, ...OUTCOME_TABS];
/** Urgency bands for shifts still to come, then "done" for ended or cancelled ones (shown by day, latest first). */
export type QueueBand = 'started' | 'soon' | 'today' | 'tomorrow' | 'later' | 'done';
export const QUEUE_BANDS: readonly QueueBand[] = ['started', 'soon', 'today', 'tomorrow', 'later', 'done'];

/**
 * Calendar periods (David, 4 Nov: "Current month, Current week, Previous month"), beside the forward-looking `days`.
 * They cover whole calendar periods in the business's dates, so they include days already gone.
 */
export type QueuePeriod = 'week' | 'month' | 'prev_month';
export const QUEUE_PERIODS: readonly QueuePeriod[] = ['week', 'month', 'prev_month'];
export const parsePeriod = (v: string | undefined): QueuePeriod | null => ((QUEUE_PERIODS as readonly string[]).includes(v ?? '') ? v as QueuePeriod : null);
/** First and last local dates of a calendar period for the business's `today` (the Live numbers' definition). */
export const queuePeriodDates = (period: QueuePeriod, today: string) => livePeriod(period, today);
/** The tab a period opens on: everything still needing someone, except the previous month, which is all done. */
export const defaultTab = (period: QueuePeriod | null): QueueTab => (period === 'prev_month' ? 'done' : 'all');
/** Rows sent per page for calendar periods (a month is ~7,000 shifts for a big agency); counts always cover everything. */
export const PAGE_ROWS = 250;
export const MAX_ROWS = 5000;

export interface StageFacts {
  status: string;
  offersPending: number;
  /** The last person taken off this shift pulled out, and nobody is on it now. */
  pulledOut: boolean;
  clientConfirms?: boolean;
  clientConfirmedAt?: string | Date | null;
  /** The shift has ended (its end time is past). */
  ended?: boolean;
}

/** What happened to a cancelled or ended shift; null while it is still to come or under way. */
export function outcomeStage(s: Pick<StageFacts, 'status' | 'pulledOut' | 'ended'>): OutcomeStage | null {
  if (s.status === 'cancelled') return 'cancelled';
  if (!s.ended) return null;
  if (s.status === 'booked') return 'worked';
  if (s.status === 'assigned') return 'unconfirmed';
  return s.pulledOut ? 'not_refilled' : 'unfilled';
}

/**
 * The queue stage: cancelled and ended shifts get their outcome; open shifts are New (nobody has it on offer) or
 * Released to bank (offers waiting), unless the last person pulled out, which outranks both so it stands out; then
 * the roster's stages.
 */
export function queueStage(s: StageFacts): QueueStage {
  const done = outcomeStage(s);
  if (done) return done;
  const c = clientShiftStage(s);
  if ((c === 'open' || c === 'offered') && s.pulledOut && s.status === 'open') return 'pulled_out';
  switch (c) {
    case 'open': return 'new';
    case 'offered': return 'released';
    case 'assigned': return 'accepted';
    default: return c;
  }
}

/**
 * Whether a row in this stage is on a tab: live tabs show shifts still to come (booked rows only on "Booked today",
 * and only when booked today); outcome tabs show ended or cancelled ones ("Unfilled" includes pulled out and not
 * refilled; "Never confirmed" shows only under "All done").
 */
export function onTab(tab: QueueTab, stage: QueueStage, bookedToday: boolean): boolean {
  if (isOutcome(stage)) return tab === 'done' || tab === stage || (tab === 'unfilled' && stage === 'not_refilled');
  if (tab === 'booked_today') return stage === 'booked' && bookedToday;
  if (stage === 'booked') return false;
  return tab === 'all' || tab === stage;
}

/** Reads `?stage=` (anything else is the period's default; outcome tabs only for calendar periods). */
export function parseTab(v: string | undefined, period: QueuePeriod | null = null): QueueTab {
  if ((LIVE_TABS as readonly string[]).includes(v ?? '')) return v as QueueTab;
  if (period && (OUTCOME_TABS as readonly string[]).includes(v ?? '')) return v as QueueTab;
  return defaultTab(period);
}

/**
 * How soon a shift starts, in the site's time zone: already started, within 2 hours, later today, tomorrow or later.
 * `siteToday`/`siteTomorrow` are the site's local dates now.
 */
export function queueBand(s: { startsAt: string | Date; localDate: string; stage?: QueueStage }, now: Date, siteToday: string, siteTomorrow: string): QueueBand {
  if (s.stage && isOutcome(s.stage)) return 'done';
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
  /** Cancelled shifts: the cancel kind in words ("The client cancelled") and the office's reason (shown instead when there is one). */
  cancelWords?: string | null;
  cancelReason?: string | null;
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
    case 'worked':
      return `${who} worked it`;
    case 'unconfirmed':
      return `${who} was allocated but never confirmed`;
    case 'not_refilled':
      return join(`${p.pulledOutName ?? 'Someone'} pulled out${p.pulledOutAt ? ` ${p.pulledOutAt}` : ''}`, 'not refilled', offers);
    case 'unfilled':
      return join('Nobody went', offers ?? 'never offered');
    case 'cancelled':
      // The pill already says the kind: the office's reason says more, when there is one.
      return p.cancelReason?.trim() || p.cancelWords || 'Cancelled';
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

/**
 * Ended or cancelled shifts, shown by day: the latest day first, then start time within the day (as the day was
 * worked), then client rank and names.
 */
export function doneOrder<R extends { startsAt: string | Date; localDate: string; clientRank: number | null; clientName: string; facilityName: string }>(a: R, b: R): number {
  return b.localDate.localeCompare(a.localDate) || queueOrder(a, b);
}

export interface DayTotals { date: string; total: number; worked: number; unfilled: number; cancelled: number }

/** Per local date (latest first): how many ended or cancelled rows, worked, unfilled (incl. not refilled), cancelled. */
export function doneDays(rows: { localDate: string; stage: QueueStage }[]): DayTotals[] {
  const by = new Map<string, DayTotals>();
  for (const r of rows) {
    if (!isOutcome(r.stage)) continue;
    const d = by.get(r.localDate) ?? { date: r.localDate, total: 0, worked: 0, unfilled: 0, cancelled: 0 };
    d.total++;
    if (r.stage === 'worked') d.worked++;
    else if (r.stage === 'unfilled' || r.stage === 'not_refilled') d.unfilled++;
    else if (r.stage === 'cancelled') d.cancelled++;
    by.set(r.localDate, d);
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** "JM" from "Jo Manager" (or an email's first letters). */
export function initialsOf(name: string): string {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const s = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}
