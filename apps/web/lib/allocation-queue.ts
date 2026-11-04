/**
 * The allocation queue on Allocations (David chose layout A, 2 Nov 2026): pure helpers for tabs, office (region)
 * chips, bands, "starts in" and "waiting" times, and the URL that keeps the screen's state.
 */
import { distanceWords } from './distance';

export type LiveTab = 'all' | 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked_today';
/** Outcome tabs (David, 4 Nov), only for calendar periods; keep in step with the API's `OUTCOME_TABS`. */
export type OutcomeTab = 'done' | 'worked' | 'unfilled' | 'cancelled';
export type QueueTab = LiveTab | OutcomeTab;
export type OutcomeStage = 'worked' | 'unfilled' | 'not_refilled' | 'unconfirmed' | 'cancelled';
export type QueueStage = 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked' | OutcomeStage;
export type QueueBand = 'started' | 'soon' | 'today' | 'tomorrow' | 'later' | 'done';
export const LIVE_TABS: readonly LiveTab[] = ['all', 'new', 'released', 'accepted', 'worker_to_confirm', 'client_to_confirm', 'pulled_out', 'booked_today'];
export const OUTCOME_TABS: readonly OutcomeTab[] = ['done', 'worked', 'unfilled', 'cancelled'];
export const QUEUE_TABS: readonly QueueTab[] = [...LIVE_TABS, ...OUTCOME_TABS];
/** Urgency bands for shifts still to come; "done" rows are shown by day instead (`dayGroups`). */
export const QUEUE_BANDS: readonly QueueBand[] = ['started', 'soon', 'today', 'tomorrow', 'later'];
export const DAY_CHOICES = [1, 3, 7, 14] as const;
/** Calendar periods (David, 4 Nov): whole weeks and months in the business's dates, days already gone included. */
export type QueuePeriod = 'week' | 'month' | 'prev_month';
export const QUEUE_PERIODS: readonly QueuePeriod[] = ['week', 'month', 'prev_month'];
/** Same words as Dashboard › Live numbers. */
export const PERIOD_LABEL: Record<QueuePeriod, string> = { week: 'Current week', month: 'Current month', prev_month: 'Previous month' };
/** Rows a calendar period shows at first and adds with each "Show more" (the API's PAGE_ROWS). */
export const PAGE_ROWS = 250;

/** The period choice, forward-looking first, then the calendar ones: `value` is what the select sends as `period`. */
export function periodChoices(): { value: string; label: string }[] {
  return [
    ...DAY_CHOICES.map(d => ({ value: String(d), label: d === 1 ? 'Next 24 hours' : `Next ${d} days` })),
    ...QUEUE_PERIODS.map(p => ({ value: p, label: PERIOD_LABEL[p] })),
  ];
}

/** The tab a period opens on: everything still needing someone, except the previous month (all done). */
export const defaultTab = (period: QueuePeriod | null): QueueTab => (period === 'prev_month' ? 'done' : 'all');
/** The tabs to show: outcome tabs only when the period includes the past. */
export const tabsFor = (period: QueuePeriod | null): readonly QueueTab[] => (period ? QUEUE_TABS : LIVE_TABS);
export const isOutcomeStage = (s: QueueStage): s is OutcomeStage => ['worked', 'unfilled', 'not_refilled', 'unconfirmed', 'cancelled'].includes(s);

/** The business's words the labels need. */
export type QueueWords = { client: string; worker: string; bank: string; shifts: string };
const DEFAULT_WORDS: QueueWords = { client: 'Client', worker: 'Worker', bank: 'bank', shifts: 'shifts' };

/** Tab labels: "All needing someone", "Released to bank", "Customer to confirm", … */
export function tabLabel(tab: QueueTab, w: QueueWords = DEFAULT_WORDS): string {
  switch (tab) {
    case 'all': return 'All needing someone';
    case 'new': return 'New';
    case 'released': return `Released to ${w.bank}`;
    case 'accepted': return 'Accepted · confirm';
    case 'worker_to_confirm': return `${w.worker} to confirm`;
    case 'client_to_confirm': return `${w.client} to confirm`;
    case 'pulled_out': return 'Pulled out';
    case 'booked_today': return 'Booked today';
    case 'done': return 'All done';
    case 'worked': return 'Worked';
    case 'unfilled': return 'Unfilled';
    case 'cancelled': return 'Cancelled';
  }
}

/** Short words for a cancel kind on a row's pill (the panel uses the full words). */
export function cancelPillLabel(kind: string | null | undefined, w: QueueWords = DEFAULT_WORDS): string {
  switch (kind) {
    case 'client_cancelled': return `${w.client} cancelled`;
    case 'client_withdrew': return `${w.client} withdrew`;
    case 'not_filled': return 'Couldn’t fill';
    case 'our_mistake': return 'Our mistake';
    default: return 'Cancelled';
  }
}

/** A row's stage pill: short words plus the class for Steve's colours. */
export function stagePill(stage: QueueStage, w: QueueWords = DEFAULT_WORDS, cancelKind: string | null = null): { label: string; cls: string } {
  switch (stage) {
    case 'new': return { label: 'New', cls: 'qst-new' };
    case 'released': return { label: 'Released', cls: 'qst-released' };
    case 'accepted': return { label: 'Accepted · confirm', cls: 'qst-accepted' };
    case 'worker_to_confirm': return { label: `${w.worker} to confirm`, cls: 'qst-worker_to_confirm' };
    case 'client_to_confirm': return { label: `${w.client} to confirm`, cls: 'qst-client_to_confirm' };
    case 'pulled_out': return { label: 'Pulled out', cls: 'qst-pulled_out' };
    case 'booked': return { label: 'Booked', cls: 'qst-booked' };
    case 'worked': return { label: 'Worked', cls: 'qst-worked' };
    case 'unfilled': return { label: 'Unfilled', cls: 'qst-unfilled' };
    case 'not_refilled': return { label: 'Pulled out · unfilled', cls: 'qst-unfilled' };
    case 'unconfirmed': return { label: 'Never confirmed', cls: 'qst-unconfirmed' };
    case 'cancelled': return { label: cancelPillLabel(cancelKind, w), cls: 'qst-cancelled' };
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type DayTotals = { date: string; total: number; worked: number; unfilled: number; cancelled: number };

/**
 * The heading over one day of ended or cancelled shifts: "Tue 3 Nov · 248 · 231 worked · 9 unfilled · 8 cancelled"
 * (zeros left out). `totals` cover the whole day on this tab, even when only some of its rows are shown yet.
 */
export function dayHeading(t: DayTotals): string {
  const [y, m, d] = t.date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const parts = [t.worked ? `${t.worked} worked` : null, t.unfilled ? `${t.unfilled} unfilled` : null, t.cancelled ? `${t.cancelled} cancelled` : null].filter(Boolean);
  return [`${wd} ${d} ${MONTHS[m - 1]}`, String(t.total), ...parts].join(' · ');
}

/** Groups done rows (already latest day first) into days, keeping the order. */
export function dayGroups<R extends { localDate: string }>(rows: R[]): { date: string; rows: R[] }[] {
  const out: { date: string; rows: R[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.localDate) last.rows.push(r);
    else out.push({ date: r.localDate, rows: [r] });
  }
  return out;
}

/** Band headings. */
export function bandTitle(band: QueueBand): string {
  return { started: 'Started or overdue', soon: 'Starting within 2 hours', today: 'Later today', tomorrow: 'Tomorrow', later: 'Later', done: 'Ended or cancelled' }[band];
}

const MIN = 60_000;

/** "55 min", "1 h 40", "26 h"; under a minute is "now". */
export function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 48) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return r && h < 10 ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/**
 * The "Starts in" cell: a countdown within a day ("1 h 40"), else the local day and time ("Tue 13:30"); started shifts
 * say how long ago. Tone: red under 2 hours (or started), amber under 6 hours.
 */
export function startsIn(startsAt: string, now: number, local: { dayLabel: string; localStart: string }): { text: string; tone: 'red' | 'amber' | '' } {
  const ms = new Date(startsAt).getTime() - now;
  if (ms <= 0) return { text: ms > -MIN ? 'Started now' : `${shortSpan(-ms)} ago`, tone: 'red' };
  const text = ms < 24 * 60 * MIN ? shortSpan(ms) : `${local.dayLabel} ${local.localStart}`;
  return { text, tone: ms < 2 * 60 * MIN ? 'red' : ms < 6 * 60 * MIN ? 'amber' : '' };
}

/** "Waiting" cell: how long since the order came in (or the last pull-out). */
export const waitingFor = (since: string | null, now: number) => (since ? shortSpan(now - new Date(since).getTime()) : '–');

/** "Updated just now", "Updated 40 s ago", "Updated 2 min ago". */
export function updatedWords(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'Updated just now';
  if (s < 60) return `Updated ${s} s ago`;
  return `Updated ${Math.round(s / 60)} min ago`;
}

/**
 * `office`: null = the API's default (the person's own offices when they have any, else all), `all`, `mine`, `none`
 * (sites without an office) or an office id (offices, David 3 Nov).
 */
export type QueueParams = {
  stage: QueueTab; office: string | null; region: string | null; clientId: string | null; days: number; shift: string | null; view: 'queue' | 'new' | 'history' | 'employers';
  /** A calendar period instead of `days` (null = the forward-looking `days`). */
  period?: QueuePeriod | null;
  /** Rows to show for a calendar period (null = the first page). */
  limit?: number | null;
  /** The fill panel's best people nearest first (`near=1`). */
  near?: boolean;
};

/** `?office=`: all, mine, none or an office id; anything else is left to the default. */
export function officeValue(v: string | undefined): string | null {
  const s = v?.trim().toLowerCase();
  return s === 'all' || s === 'mine' || s === 'none' || (s && /^[0-9a-f-]{36}$/.test(s)) ? s : null;
}

export type OfficeChipData = { office: string | null; myOffices: string[]; offices: { id: string; name: string; count: number; mine: boolean }[]; noOffice: number };

/**
 * The office chips: "My offices" (when the person has any; the default), "All", each office (theirs first), then
 * "No office" when sites without one have work. `value` is what goes in the URL (null = the default); `on` follows the
 * filter the API applied. Empty when the business has no offices (the state chips show instead).
 */
export function officeChipList(q: OfficeChipData): { label: string; value: string | null; count: number | null; on: boolean }[] {
  if (q.offices.length === 0) return [];
  const hasMine = q.myOffices.length > 0;
  const total = q.offices.reduce((n, o) => n + o.count, 0) + q.noOffice;
  const mineCount = q.offices.filter(o => o.mine).reduce((n, o) => n + o.count, 0);
  return [
    ...(hasMine ? [{ label: q.myOffices.length === 1 ? 'My office' : 'My offices', value: null, count: mineCount, on: q.office === 'mine' }] : []),
    { label: 'All', value: hasMine ? 'all' : null, count: total, on: q.office === null },
    ...q.offices.map(o => ({ label: o.name, value: o.id, count: o.count, on: q.office === o.id })),
    ...(q.noOffice > 0 || q.office === 'none' ? [{ label: 'No office', value: 'none', count: q.noOffice, on: q.office === 'none' }] : []),
  ];
}

/** Reads the screen's state from the URL (anything odd falls back to the defaults). */
export function parseQueueParams(sp: Record<string, string | string[] | undefined>): QueueParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  // `period` is a calendar period, or (from the period select) a number of days; `days` still works on its own.
  const periodRaw = one('period');
  const period = (QUEUE_PERIODS as readonly string[]).includes(periodRaw ?? '') ? periodRaw as QueuePeriod : null;
  const dayValue = Number(period ? NaN : periodRaw ?? one('days'));
  const stageRaw = one('stage') ?? '';
  const stage = (LIVE_TABS as readonly string[]).includes(stageRaw) || (period && (OUTCOME_TABS as readonly string[]).includes(stageRaw))
    ? stageRaw as QueueTab : defaultTab(period);
  const limit = Number(one('limit'));
  const view = one('view');
  const id = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  return {
    stage,
    office: officeValue(one('office')),
    region: one('region')?.trim().slice(0, 60) || null,
    clientId: id(one('clientId')),
    days: (DAY_CHOICES as readonly number[]).includes(dayValue) ? dayValue : 3,
    shift: id(one('shift')),
    view: view === 'new' || view === 'history' || view === 'employers' ? view : 'queue',
    period,
    limit: period && Number.isInteger(limit) && limit > PAGE_ROWS ? Math.min(limit, 5000) : null,
    near: one('near') === '1',
  };
}

/** The Allocations URL for this state with some of it changed (defaults left out, so URLs stay short). */
export function queueHref(p: QueueParams, change: Partial<QueueParams> = {}): string {
  const n = { ...p, ...change };
  const q = new URLSearchParams();
  const period = n.period ?? null;
  if (n.view !== 'queue') q.set('view', n.view);
  if (n.stage !== defaultTab(period)) q.set('stage', n.stage);
  if (n.office) q.set('office', n.office);
  if (n.region) q.set('region', n.region);
  if (n.clientId) q.set('clientId', n.clientId);
  if (period) q.set('period', period);
  else if (n.days !== 3) q.set('days', String(n.days));
  if (period && n.limit) q.set('limit', String(n.limit));
  if (n.shift) q.set('shift', n.shift);
  if (n.near) q.set('near', '1');
  const s = q.toString();
  return s ? `/allocations?${s}` : '/allocations';
}

/** The API query for the queue: the period (or days), tab, filters and how many rows. */
export function queueQuery(p: QueueParams): string {
  const q = new URLSearchParams();
  if (p.period) q.set('period', p.period); else q.set('days', String(p.days));
  if (p.stage !== defaultTab(p.period ?? null)) q.set('stage', p.stage);
  if (p.office) q.set('office', p.office);
  if (p.region) q.set('region', p.region);
  if (p.clientId) q.set('clientId', p.clientId);
  if (p.period && p.limit) q.set('limit', String(p.limit));
  return q.toString();
}

/** "Show 250 more" (or however many are left) for a calendar period's list; null when everything is shown. */
export function showMore(p: QueueParams, shown: number, more: number): { href: string; label: string } | null {
  if (!p.period || more <= 0) return null;
  const next = Math.min(more, PAGE_ROWS);
  return { href: queueHref(p, { limit: shown + PAGE_ROWS }), label: `Show ${next} more (${more} not shown yet)` };
}

/** The fill panel's people line: "Ready · 24 h that week" or the first warning. */
export function personLine(c: { eligible: boolean; weekHours: number; warnings: { message: string }[]; blocks: { message: string }[] }): string {
  if (!c.eligible) return c.blocks[0]?.message ?? 'Can’t work it';
  if (c.warnings.length) return `Warning: ${c.warnings[0].message}${c.warnings.length > 1 ? ` (+${c.warnings.length - 1})` : ''} · ${c.weekHours} h that week`;
  return `Ready · ${c.weekHours} h that week`;
}

/**
 * The best people for the panel: up to `n` who can work it (ready first, as the API ranks them), skipping anyone
 * whose offer is still waiting and the person who just pulled out of it (`skipName`).
 */
export function bestPeople<C extends { name: string; eligible: boolean; offer?: { status: string } | null; distanceKm?: number | null }>(
  cands: C[], n = 5, skipName: string | null = null, near = false,
): C[] {
  const ok = cands.filter(c => c.eligible && c.offer?.status !== 'pending' && c.name !== skipName);
  return (near ? nearestFirst(ok) : ok).slice(0, n);
}

/**
 * "Nearest first" (David, 4 Nov; the panel's optional sort): people by distance from home, unknown distances last,
 * otherwise in the API's order. Only when the office asks for it: distance is never part of the usual ranking.
 */
export function nearestFirst<C extends { distanceKm?: number | null }>(cands: C[]): C[] {
  const far = (c: C) => (c.distanceKm === null || c.distanceKm === undefined ? Infinity : c.distanceKm);
  return cands.map((c, i) => ({ c, i })).sort((a, b) => far(a.c) - far(b.c) || a.i - b.i).map(x => x.c);
}

/** The best person's second line: "12 km · Worked here 3 times · last 22 Sep" (distance only when known). */
export function nearHereLine(distanceKm: number | null | undefined, here: string): string {
  const d = distanceWords(distanceKm);
  return d ? `${d} · ${here}` : here;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A person's past work at the shift's site, for the best people (David, 2 Nov): "Worked here 3 times · last 22 Sep",
 * "Worked here once · last 4 Oct 2025" (year only when it isn't this year), or "New to this site". `today` is the
 * business's date (YYYY-MM-DD); `site` the business's word for a site, in lower case.
 */
export function hereLine(h: { shiftsHere: number; lastHere: string | null } | null | undefined, today: string, site = 'site'): string {
  if (!h || h.shiftsHere <= 0 || !h.lastHere) return `New to this ${site}`;
  const [y, m, d] = h.lastHere.split('-').map(Number);
  const when = `${d} ${MONTHS[m - 1]}${String(y) === today.slice(0, 4) ? '' : ` ${y}`}`;
  const times = h.shiftsHere === 1 ? 'once' : h.shiftsHere === 2 ? 'twice' : `${h.shiftsHere} times`;
  return `Worked here ${times} · last ${when}`;
}

/** Two letters for a person: "OD" for "Oscar Diaz". */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';

/** Releasing several at once (layout C's idea inside the queue, 2 Nov): at most this many shifts per press. */
export const BULK_MAX = 20;
/** At most this many people are offered one shift when it is released to the bank. */
export const RELEASE_MAX = 50;

/**
 * Who gets an offer from the queue: `top` = the best five (the nearest five with `near`, as the panel shows them),
 * `release` = everyone who can work it (up to 50); never anyone whose offer is still waiting, nor the person who
 * pulled out of it.
 */
export function releasePick<C extends { workerId: string; name: string; eligible: boolean; offer?: { status: string } | null; distanceKm?: number | null }>(
  cands: C[], how: 'top' | 'release', pulledOutName: string | null, near = false,
): string[] {
  return bestPeople(cands, how === 'top' ? 5 : RELEASE_MAX, pulledOutName, near).map(c => c.workerId);
}

/** The rows a band can release in one go: still New (nobody on it, nothing offered), in queue order, at most BULK_MAX. */
export function releasableRows<R extends { id: string; stage: QueueStage }>(rows: R[]): R[] {
  return rows.filter(r => r.stage === 'new').slice(0, BULK_MAX);
}

/** One shift's outcome when releasing several: how many were offered it, or why it wasn't released. */
export type BulkResult = { label: string; offered: number; reason?: string };

/**
 * The message after releasing several: "Released 3 shifts to the bank: 41 offers sent. The first to accept each one gets
 * it." plus "Not released (1): Tuesday 3 November 07:00 Carer: Nobody else can work it." `w` = the business's words.
 */
export function bulkReleaseMessage(results: BulkResult[], w: { bank: string; shift: string; shifts: string } = { bank: 'bank', shift: 'shift', shifts: 'shifts' }): { ok: boolean; text: string } {
  const done = results.filter(r => !r.reason && r.offered > 0);
  const left = results.filter(r => r.reason || r.offered === 0);
  const offers = done.reduce((n, r) => n + r.offered, 0);
  const notes = left.length
    ? ` Not released (${left.length}): ${left.slice(0, 5).map(r => `${r.label}: ${(r.reason ?? 'Nobody else can work it').replace(/\.$/, '')}`).join('; ')}${left.length > 5 ? `; and ${left.length - 5} more` : ''}.`
    : '';
  if (!done.length) return { ok: false, text: `Nothing released.${notes}` };
  const n = done.length === 1 ? `1 ${w.shift}` : `${done.length} ${w.shifts}`;
  return { ok: true, text: `Released ${n} to the ${w.bank}: ${offers} ${offers === 1 ? 'offer' : 'offers'} sent. The first to accept each one gets it.${notes}` };
}
