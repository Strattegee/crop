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

/*
 * Column filters and sorting (David, 7 Nov: "add filters [to the headings] as per what you have done on Recruitment").
 * Every column heading of the queue has a filter; they narrow the rows together with the tabs and chips, and the counts
 * are worked out after them (tab counts leave out the Stage column, the way Recruitment's stage chips do).
 */
export const BAND_FILTERS: readonly QueueBand[] = ['started', 'soon', 'today', 'tomorrow', 'later', 'done'];
/** Waiting longer than: minutes for each choice. */
export const WAITING_MINUTES = { '30m': 30, '1h': 60, '4h': 240, '1d': 1440 } as const;
export type WaitingFilter = keyof typeof WAITING_MINUTES;
export const HOURS_FILTERS = ['lt4', '4to8', 'gt8'] as const;
export type HoursFilter = typeof HOURS_FILTERS[number];
export const PROGRESS_FILTERS = ['not_offered', 'no_replies', 'some_declined', 'pulled_out'] as const;
export type ProgressFilter = typeof PROGRESS_FILTERS[number];
/** Parts of the day, as for availability: AM 05:00–11:59, PM 12:00–18:59, night otherwise. */
export const PART_FILTERS = ['am', 'pm', 'night'] as const;
export type DayPart = typeof PART_FILTERS[number];
export const ON_FILTERS = ['others', 'nobody'] as const;
export type OnFilter = typeof ON_FILTERS[number];
export const SORT_KEYS = ['default', 'starts', 'waiting', 'stage', 'rank', 'client', 'role', 'when', 'hours', 'progress', 'on'] as const;
export type SortKey = typeof SORT_KEYS[number];
/** Stage order for sorting and for the Stage filter's choices: what needs doing first. */
export const STAGE_ORDER: readonly QueueStage[] = ['pulled_out', 'new', 'released', 'accepted', 'worker_to_confirm', 'client_to_confirm', 'booked',
  'worked', 'unconfirmed', 'not_refilled', 'unfilled', 'cancelled'];

export interface ColumnFilters {
  bands: QueueBand[];
  waiting: WaitingFilter | null;
  stages: QueueStage[];
  /** Client ranks 1–7, plus 0 for "not ranked". */
  ranks: number[];
  clients: string[];
  sites: string[];
  /** Words in the area's name (case doesn't matter). */
  area: string;
  roles: string[];
  /** Site-local start dates (YYYY-MM-DD). */
  dates: string[];
  parts: DayPart[];
  hours: HoursFilter | null;
  progress: ProgressFilter[];
  on: OnFilter | null;
}
export interface QueueSort { key: SortKey; desc: boolean }

export const NO_FILTERS: ColumnFilters = {
  bands: [], waiting: null, stages: [], ranks: [], clients: [], sites: [], area: '', roles: [], dates: [], parts: [], hours: null, progress: [], on: null,
};

type Q = Record<string, string | string[] | undefined>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Comma lists or repeated parameters (a GET form's tick boxes repeat the name); at most 100 values. */
function list(v: string | string[] | undefined): string[] {
  const raw = (Array.isArray(v) ? v : [v ?? '']).flatMap(x => String(x).split(',')).map(s => s.trim()).filter(Boolean);
  return [...new Set(raw)].slice(0, 100);
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();
const among = <T extends string>(v: string[], allowed: readonly T[]) => v.filter((x): x is T => (allowed as readonly string[]).includes(x));
const oneAmong = <T extends string>(v: string, allowed: readonly T[]): T | null => ((allowed as readonly string[]).includes(v) ? v as T : null);

/** Reads the column filters from the query; anything odd is left out rather than refused. */
export function parseColumnFilters(q: Q): ColumnFilters {
  return {
    bands: among(list(q.band), BAND_FILTERS),
    waiting: oneAmong(first(q.waiting), Object.keys(WAITING_MINUTES) as WaitingFilter[]),
    stages: among(list(q.stages), STAGE_ORDER),
    ranks: [...new Set(list(q.rank).map(r => (r === 'none' ? 0 : Number(r))).filter(n => Number.isInteger(n) && n >= 0 && n <= 7))],
    clients: list(q.clients).filter(x => UUID_RE.test(x)).map(x => x.toLowerCase()),
    sites: list(q.sites).filter(x => UUID_RE.test(x)).map(x => x.toLowerCase()),
    area: first(q.area).slice(0, 60),
    roles: list(q.roles).map(r => r.slice(0, 100)),
    dates: list(q.dates).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    parts: among(list(q.part), PART_FILTERS),
    hours: oneAmong(first(q.hrs), HOURS_FILTERS),
    progress: among(list(q.progress), PROGRESS_FILTERS),
    on: oneAmong(first(q.on), ON_FILTERS),
  };
}

/** `?sort=` = a column key, `-key` turns it round; anything else is the queue's own order. */
export function parseSort(v: string | undefined): QueueSort {
  const s = (v ?? '').trim();
  const desc = s.startsWith('-');
  const key = oneAmong(desc ? s.slice(1) : s, SORT_KEYS) ?? 'default';
  return { key, desc: key !== 'default' && desc };
}

/** The part of the day a local start time (HH:MM) falls in. */
export function dayPart(localStart: string): DayPart {
  const h = Number(localStart.slice(0, 2));
  return h >= 5 && h < 12 ? 'am' : h >= 12 && h < 19 ? 'pm' : 'night';
}

/** How filling is going, as the Progress filter sees it. */
export function progressKinds(r: { offersTotal: number; offersPending: number; offersDeclined: number; pulledOutName: string | null }): ProgressFilter[] {
  const out: ProgressFilter[] = [];
  if (r.offersTotal === 0) out.push('not_offered');
  else if (r.offersDeclined === 0 && r.offersPending === r.offersTotal) out.push('no_replies');
  if (r.offersDeclined > 0) out.push('some_declined');
  if (r.pulledOutName) out.push('pulled_out');
  return out;
}

export interface FilterRow {
  band: QueueBand; stage: QueueStage; waitingSince: string | Date | null; clientRank: number | null; clientId: string; clientName: string;
  facilityId: string; facilityName: string; areaName: string | null; role: string; localDate: string; localStart: string; hours: number;
  offersTotal: number; offersPending: number; offersDeclined: number; pulledOutName: string | null; presence: unknown[]; startsAt: string | Date;
}

/**
 * Whether a row passes the column filters (`withStages: false` leaves out the Stage column, for the tab counts). Within
 * a column any chosen value passes; across columns every one must.
 */
export function matchesColumns(r: FilterRow, f: ColumnFilters, now: Date, withStages = true): boolean {
  if (f.bands.length && !f.bands.includes(r.band)) return false;
  if (f.waiting) {
    if (!r.waitingSince) return false;
    if (now.getTime() - new Date(r.waitingSince).getTime() < WAITING_MINUTES[f.waiting] * 60_000) return false;
  }
  if (withStages && f.stages.length && !f.stages.includes(r.stage)) return false;
  if (f.ranks.length && !f.ranks.includes(r.clientRank ?? 0)) return false;
  if (f.clients.length && !f.clients.includes(r.clientId.toLowerCase())) return false;
  if (f.sites.length && !f.sites.includes(r.facilityId.toLowerCase())) return false;
  if (f.area && !(r.areaName ?? '').toLowerCase().includes(f.area.toLowerCase())) return false;
  if (f.roles.length && !f.roles.includes(r.role)) return false;
  if (f.dates.length && !f.dates.includes(r.localDate)) return false;
  if (f.parts.length && !f.parts.includes(dayPart(r.localStart))) return false;
  if (f.hours === 'lt4' && !(r.hours < 4)) return false;
  if (f.hours === '4to8' && !(r.hours >= 4 && r.hours <= 8)) return false;
  if (f.hours === 'gt8' && !(r.hours > 8)) return false;
  if (f.progress.length && !progressKinds(r).some(k => f.progress.includes(k))) return false;
  if (f.on === 'others' && r.presence.length === 0) return false;
  if (f.on === 'nobody' && r.presence.length > 0) return false;
  return true;
}

/** Whether any column filter is on. */
export const anyColumnFilter = (f: ColumnFilters) => Object.values(f).some(v => (Array.isArray(v) ? v.length > 0 : Boolean(v)));

/**
 * Sorting by a heading: rows keep their place in the queue's own order (`rows` arrive in it) when the key ties. Rows
 * without a value (no waiting time, no rank) go last either way.
 */
export function sortRows<R extends FilterRow>(rows: R[], s: QueueSort): R[] {
  if (s.key === 'default') return rows;
  const dir = s.desc ? -1 : 1;
  const t = (v: string | Date) => new Date(v).getTime();
  const nullsLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : dir * (a - b));
  const cmp: (a: R, b: R) => number = (() => {
    switch (s.key) {
      case 'starts': return (a, b) => dir * (t(a.startsAt) - t(b.startsAt));
      // Waiting reads best longest first, so ascending = the oldest "since".
      case 'waiting': return (a, b) => nullsLast(a.waitingSince ? t(a.waitingSince) : null, b.waitingSince ? t(b.waitingSince) : null);
      case 'stage': return (a, b) => dir * (STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
      case 'rank': return (a, b) => nullsLast(a.clientRank, b.clientRank);
      case 'client': return (a, b) => dir * (a.clientName.localeCompare(b.clientName) || a.facilityName.localeCompare(b.facilityName)
        || (a.areaName ?? '').localeCompare(b.areaName ?? ''));
      case 'role': return (a, b) => dir * a.role.localeCompare(b.role);
      case 'when': return (a, b) => dir * (a.localDate.localeCompare(b.localDate) || a.localStart.localeCompare(b.localStart));
      case 'hours': return (a, b) => dir * (a.hours - b.hours);
      case 'progress': return (a, b) => dir * (a.offersTotal - b.offersTotal || a.offersDeclined - b.offersDeclined);
      case 'on': return (a, b) => dir * (a.presence.length - b.presence.length);
      default: return () => 0;
    }
  })();
  return rows.map((r, i) => ({ r, i })).sort((a, b) => cmp(a.r, b.r) || a.i - b.i).map(x => x.r);
}

export interface ColumnOptions {
  stages: QueueStage[];
  clients: { id: string; name: string }[];
  /** Sites with work, only the chosen clients' when clients are chosen. */
  sites: { id: string; name: string; clientId: string }[];
  roles: string[];
  dates: string[];
}

/** What the column filters can offer: the values present in the rows on the tab (before the column filters). */
export function columnOptions(rows: FilterRow[], f: ColumnFilters): ColumnOptions {
  const clients = new Map<string, string>(), sites = new Map<string, { id: string; name: string; clientId: string }>();
  const roles = new Set<string>(), dates = new Set<string>(), stages = new Set<QueueStage>();
  for (const r of rows) {
    stages.add(r.stage);
    clients.set(r.clientId, r.clientName);
    if (!f.clients.length || f.clients.includes(r.clientId.toLowerCase())) sites.set(r.facilityId, { id: r.facilityId, name: r.facilityName, clientId: r.clientId });
    roles.add(r.role);
    dates.add(r.localDate);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    stages: STAGE_ORDER.filter(s => stages.has(s)),
    clients: [...clients].map(([id, name]) => ({ id, name })).sort(byName),
    sites: [...sites.values()].sort(byName),
    roles: [...roles].sort((a, b) => a.localeCompare(b)),
    dates: [...dates].sort(),
  };
}
