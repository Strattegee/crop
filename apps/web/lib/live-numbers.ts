/**
 * The Dashboard's live numbers (David, 3 Nov 2026, answer 1): pure helpers for the URL (period, state, office), the
 * percentages and the drill-down line. Tested in test/live-numbers.test.ts.
 */
export const LIVE_PERIODS = ['today', 'week', 'last7', 'month', 'prev_month'] as const;
export type LivePeriod = typeof LIVE_PERIODS[number];
export type LiveParams = { period: LivePeriod; state: string | null; office: string | null };

export type LiveMeasure = { key: string; label: string; how: string; value: number; percent: number | null };
export type LiveNumbers = {
  period: LivePeriod; periodLabel: string; periods: { period: LivePeriod; label: string }[]; from: string; to: string; today: string;
  state: string | null; office: string | null; officeName: string | null; at: string;
  states: { name: string; requests: number }[]; offices: { id: string; name: string; requests: number }[];
  shifts: LiveMeasure[];
  officers: { measures: LiveMeasure[]; rows: { userId: string; name: string; handled: number; messages: number; calls: number }[] };
  personnel: { measures: LiveMeasure[]; rows: { workerId: string; name: string; accepted: number; worked: number; pulledOut: number }[]; more: number };
};

/** Reads the page's state from the URL (anything odd falls back to the current week, the whole business). */
export function parseLiveParams(sp: Record<string, string | string[] | undefined>): LiveParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const p = one('period');
  const office = one('office')?.trim().toLowerCase();
  return {
    period: (LIVE_PERIODS as readonly string[]).includes(p ?? '') ? p as LivePeriod : 'week',
    state: one('state')?.trim().slice(0, 60) || null,
    office: office === 'none' || (office && /^[0-9a-f-]{36}$/.test(office)) ? office : null,
  };
}

/** The page's URL with some of it changed (the current week and the whole business left out, so URLs stay short). */
export function liveHref(p: LiveParams, change: Partial<LiveParams> = {}): string {
  const n = { ...p, ...change };
  const q = new URLSearchParams();
  if (n.period !== 'week') q.set('period', n.period);
  if (n.state) q.set('state', n.state);
  if (n.office) q.set('office', n.office);
  const s = q.toString();
  return s ? `/dashboard/live?${s}` : '/dashboard/live';
}

/** The API query for these params. */
export function liveQuery(p: LiveParams): string {
  const q = new URLSearchParams({ period: p.period });
  if (p.state) q.set('state', p.state);
  if (p.office) q.set('office', p.office);
  return q.toString();
}

/** "37.5% of requests", or null when there is no percentage (or nothing to divide by). */
export function percentLine(m: Pick<LiveMeasure, 'percent'>, requestsWord: string): string | null {
  return m.percent === null ? null : `${m.percent}% of ${requestsWord}`;
}

/** Where the numbers are for: "Whole business", "VIC", "VIC › VIC Melbourne Metro", "No office". */
export function scopeLine(l: Pick<LiveNumbers, 'state' | 'office' | 'officeName'>): string {
  const parts = [l.state, l.office === 'none' ? 'No office' : l.officeName].filter(Boolean);
  return parts.length ? parts.join(' › ') : 'Whole business';
}

/** "Mon 3 Nov" or "3–9 Nov" style dates for the period's heading (local dates, shown as they are). */
export function periodDates(from: string, to: string): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  if (from === to) return fmt(from, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  if (from.slice(0, 7) === to.slice(0, 7)) return `${fmt(from, { day: 'numeric' })}–${fmt(to, { day: 'numeric', month: 'short' })}`;
  return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short' })}`;
}
