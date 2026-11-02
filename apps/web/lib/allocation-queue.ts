/**
 * The allocation queue on Allocations (David chose layout A, 2 Nov 2026): pure helpers for tabs, office (region)
 * chips, bands, "starts in" and "waiting" times, and the URL that keeps the screen's state.
 */

export type QueueTab = 'all' | 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked_today';
export type QueueStage = 'new' | 'released' | 'accepted' | 'worker_to_confirm' | 'client_to_confirm' | 'pulled_out' | 'booked';
export type QueueBand = 'started' | 'soon' | 'today' | 'tomorrow' | 'later';
export const QUEUE_TABS: readonly QueueTab[] = ['all', 'new', 'released', 'accepted', 'worker_to_confirm', 'client_to_confirm', 'pulled_out', 'booked_today'];
export const QUEUE_BANDS: readonly QueueBand[] = ['started', 'soon', 'today', 'tomorrow', 'later'];
export const DAY_CHOICES = [1, 3, 7, 14] as const;

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
  }
}

/** A row's stage pill: short words plus the class for Steve's colours. */
export function stagePill(stage: QueueStage, w: QueueWords = DEFAULT_WORDS): { label: string; cls: string } {
  switch (stage) {
    case 'new': return { label: 'New', cls: 'qst-new' };
    case 'released': return { label: 'Released', cls: 'qst-released' };
    case 'accepted': return { label: 'Accepted · confirm', cls: 'qst-accepted' };
    case 'worker_to_confirm': return { label: `${w.worker} to confirm`, cls: 'qst-worker_to_confirm' };
    case 'client_to_confirm': return { label: `${w.client} to confirm`, cls: 'qst-client_to_confirm' };
    case 'pulled_out': return { label: 'Pulled out', cls: 'qst-pulled_out' };
    case 'booked': return { label: 'Booked', cls: 'qst-booked' };
  }
}

/** Band headings. */
export function bandTitle(band: QueueBand): string {
  return { started: 'Started or overdue', soon: 'Starting within 2 hours', today: 'Later today', tomorrow: 'Tomorrow', later: 'Later' }[band];
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

export type QueueParams = { stage: QueueTab; region: string | null; clientId: string | null; days: number; shift: string | null; view: 'queue' | 'new' | 'history' | 'employers' };

/** Reads the screen's state from the URL (anything odd falls back to the defaults). */
export function parseQueueParams(sp: Record<string, string | string[] | undefined>): QueueParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const stage = (QUEUE_TABS as readonly string[]).includes(one('stage') ?? '') ? one('stage') as QueueTab : 'all';
  const days = Number(one('days'));
  const view = one('view');
  const id = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  return {
    stage,
    region: one('region')?.trim().slice(0, 60) || null,
    clientId: id(one('clientId')),
    days: (DAY_CHOICES as readonly number[]).includes(days) ? days : 3,
    shift: id(one('shift')),
    view: view === 'new' || view === 'history' || view === 'employers' ? view : 'queue',
  };
}

/** The Allocations URL for this state with some of it changed (defaults left out, so URLs stay short). */
export function queueHref(p: QueueParams, change: Partial<QueueParams> = {}): string {
  const n = { ...p, ...change };
  const q = new URLSearchParams();
  if (n.view !== 'queue') q.set('view', n.view);
  if (n.stage !== 'all') q.set('stage', n.stage);
  if (n.region) q.set('region', n.region);
  if (n.clientId) q.set('clientId', n.clientId);
  if (n.days !== 3) q.set('days', String(n.days));
  if (n.shift) q.set('shift', n.shift);
  const s = q.toString();
  return s ? `/allocations?${s}` : '/allocations';
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
export function bestPeople<C extends { name: string; eligible: boolean; offer?: { status: string } | null }>(cands: C[], n = 5, skipName: string | null = null): C[] {
  return cands.filter(c => c.eligible && c.offer?.status !== 'pending' && c.name !== skipName).slice(0, n);
}

/** Two letters for a person: "OD" for "Oscar Diaz". */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
