/**
 * Dashboards (David, 31 Oct; strategy doc section 5): the measures each job focus sees, defined once. Pure rules:
 * the catalogue, how a value compares with the business's target, and small statistics. The numbers themselves
 * come from `dashboard-data.ts`.
 */
export const FOCUSES = ['allocator', 'compliance', 'recruitment', 'overview', 'agency'] as const;
export type Focus = typeof FOCUSES[number];

export const FOCUS_LABEL: Record<Focus, string> = {
  allocator: 'Allocator', compliance: 'Compliance', recruitment: 'Recruitment', overview: 'Overview', agency: 'Agency',
};

/** The dashboard someone sees when the owner hasn't chosen one: allocators get the Allocator one, others Overview. */
export function defaultFocus(role: string): Focus {
  return role === 'allocator' ? 'allocator' : 'overview';
}

/** Owners always see costs; anyone else only when the owner has said so (David, 31 Oct). */
export function seesCosts(role: string, granted: boolean): boolean {
  return role === 'owner' || granted;
}

export type Unit = 'percent' | 'count' | 'hours' | 'days';
/** Whether a bigger number is better (fill rate) or worse (waiting to be checked). */
export type Better = 'higher' | 'lower';

export interface KpiDef {
  key: string;
  focus: Exclude<Focus, 'overview'>;
  label: string;
  question: string;
  unit: Unit;
  better: Better;
  /** CROP's suggested target, shown when the business hasn't set one. Never used to colour a number. */
  suggested: number;
  /** Where clicking the number goes (web path). */
  href: string;
  /** How it is worked out, in plain words (shown on hover). */
  how: string;
}

export const KPIS: readonly KpiDef[] = [
  { key: 'filled_48h', focus: 'allocator', label: 'Filled, next 48 hours', question: 'Am I safe for the next two days?', unit: 'percent', better: 'higher', suggested: 95, href: '/roster',
    how: '{Shifts} needing a person that start in the next 48 hours and have someone on them, out of all of them' },
  { key: 'time_to_fill', focus: 'allocator', label: 'Time to fill', question: 'Am I filling faster or slower?', unit: 'hours', better: 'lower', suggested: 24, href: '/roster',
    how: 'Middle value of the hours from a {shift} becoming open (added, or someone taken off) to someone being put on it, last 4 weeks; {shifts} filled straight from a template or copy are left out' },
  { key: 'last_minute_gaps', focus: 'allocator', label: 'Last-minute gaps', question: 'How often am I firefighting?', unit: 'count', better: 'lower', suggested: 2, href: '/roster',
    how: '{Shifts} that became open within 24 hours of starting (added late, or someone taken off or pulled out), last 7 days' },
  { key: 'offer_acceptance', focus: 'allocator', label: 'Offers accepted', question: 'Are my offers going to the right people?', unit: 'percent', better: 'higher', suggested: 40, href: '/roster',
    how: 'Offers accepted out of offers answered or run out, last 4 weeks' },
  { key: 'agency_share', focus: 'allocator', label: '{Agency} share', question: 'Am I leaning on {agencies}?', unit: 'percent', better: 'lower', suggested: 10, href: '/roster',
    how: 'Hours on {shifts} this month filled by {agency} people, out of all filled hours' },

  { key: 'ready_to_work', focus: 'compliance', label: 'Ready to work', question: 'How exposed are we right now?', unit: 'percent', better: 'higher', suggested: 95, href: '/workers?compliance=non_compliant',
    how: 'Active people with no must-have problem today, out of all active people' },
  { key: 'blocked_shifts', focus: 'compliance', label: 'Blocked {shifts}, 7 days', question: 'Will someone turn up who must not work?', unit: 'count', better: 'lower', suggested: 0, href: '/roster',
    how: '{Shifts} in the next 7 days whose person can no longer work them (a must-have, right to work, leave or employment)' },
  { key: 'waiting_to_check', focus: 'compliance', label: 'Waiting to be checked', question: 'Am I the bottleneck?', unit: 'count', better: 'lower', suggested: 10, href: '/compliance',
    how: 'Credentials of active people still waiting to be checked' },
  { key: 'expiring_before_shift', focus: 'compliance', label: 'Expiring before a {shift}', question: 'What must be renewed first?', unit: 'count', better: 'lower', suggested: 0, href: '/compliance',
    how: 'Checked credentials running out in the next 30 days for people who have a {shift} after that date' },
  { key: 'check_turnaround', focus: 'compliance', label: 'Check turnaround', question: 'Is checking keeping pace?', unit: 'hours', better: 'lower', suggested: 48, href: '/compliance',
    how: 'Middle value of the hours from a credential being added or changed to it being checked or rejected, last 4 weeks; credentials checked as they were entered are left out' },

  { key: 'applied_to_started', focus: 'recruitment', label: 'Applied to started', question: 'How long does hiring take?', unit: 'days', better: 'lower', suggested: 21, href: '/recruitment',
    how: 'Middle value of the days from Applied to Started, for people who started in the last 90 days' },
  { key: 'stuck', focus: 'recruitment', label: 'Waiting on us', question: 'Who is waiting on us?', unit: 'count', better: 'lower', suggested: 0, href: '/recruitment',
    how: 'Applicants at their stage for longer than the stage limit (Settings: dashboard targets, "Days at one stage")' },
  { key: 'stage_limit_days', focus: 'recruitment', label: 'Days at one stage', question: 'How long may an applicant wait at one stage?', unit: 'days', better: 'lower', suggested: 7, href: '/recruitment',
    how: 'The limit used by "Waiting on us"; a setting, not a measure' },
  { key: 'starting_soon', focus: 'recruitment', label: 'Ready to start', question: 'Who can I give to the allocator?', unit: 'count', better: 'higher', suggested: 1, href: '/recruitment',
    how: 'People being onboarded with every required step done' },
  { key: 'started_unfilled', focus: 'recruitment', label: '{Shifts} that started empty', question: 'Which roles should I hire for?', unit: 'count', better: 'lower', suggested: 0, href: '/recruitment',
    how: '{Shifts} needing a person that started with nobody on them, last 4 weeks, by role' },

  { key: 'agency_open', focus: 'agency', label: 'Requests to fill, 7 days', question: 'What do employers still need from us?', unit: 'count', better: 'lower', suggested: 0, href: '/allocations',
    how: 'Open requests from employers starting in the next 7 days that nobody has been put forward for' },
  { key: 'agency_filled', focus: 'agency', label: 'Requests we filled', question: 'How many requests do we win?', unit: 'percent', better: 'higher', suggested: 60, href: '/allocations',
    how: 'Requests received in the last 4 weeks that we put someone forward for, out of all received' },
  { key: 'agency_response', focus: 'agency', label: 'Time to put forward', question: 'How quickly do we answer?', unit: 'hours', better: 'lower', suggested: 2, href: '/allocations',
    how: 'Middle value of the hours from a request arriving to us putting someone forward, last 4 weeks' },
  { key: 'agency_pulled_out', focus: 'agency', label: 'Pulled out', question: 'How often do we let employers down?', unit: 'count', better: 'lower', suggested: 0, href: '/allocations',
    how: 'People we put forward and then pulled out, last 4 weeks' },
  { key: 'agency_waiting', focus: 'agency', label: 'Waiting for the employer', question: 'Who is waiting on an employer\'s answer?', unit: 'count', better: 'lower', suggested: 0, href: '/allocations',
    how: 'People we put forward that the employer hasn\'t approved yet' },
] as const;

/** Measures that are settings for another measure, so they aren't shown as tiles. */
export const SETTING_KPIS = new Set(['stage_limit_days']);

export const kpiByKey = (key: string) => KPIS.find(k => k.key === key) ?? null;

/** The tiles for a focus (Overview shows the headline of each). */
export function kpisFor(focus: Focus): KpiDef[] {
  if (focus === 'overview') return ['filled_48h', 'last_minute_gaps', 'ready_to_work', 'waiting_to_check', 'stuck'].map(k => kpiByKey(k)!);
  return KPIS.filter(k => k.focus === focus && !SETTING_KPIS.has(k.key));
}

export type Standing = 'on_target' | 'off_target' | 'no_target' | 'no_data';

/** On or off the business's own target; nothing is marked until the business has set one (David, 31 Oct). */
export function standing(value: number | null, target: number | null, better: Better): Standing {
  if (value === null) return 'no_data';
  if (target === null) return 'no_target';
  return (better === 'higher' ? value >= target : value <= target) ? 'on_target' : 'off_target';
}

/** The middle value, or null for none. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A percentage to one decimal place, or null when nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Rounded for display: hours and days to one decimal place, counts whole. */
export function tidy(value: number | null, unit: Unit): number | null {
  if (value === null) return null;
  return unit === 'count' ? Math.round(value) : Math.round(value * 10) / 10;
}

/** A target as typed: a number within the unit's range, or a plain reason. */
export function targetRefusal(def: KpiDef, value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return 'Enter a number of 0 or more';
  if (def.unit === 'percent' && value > 100) return 'A percentage can be at most 100';
  if (def.unit === 'count' && !Number.isInteger(value)) return 'Enter a whole number';
  if (value > 100000) return 'That number is too big';
  return null;
}

/** Puts the business's words into a measure's text: {shift} {shifts} {Shifts} {agency} {agencies} {Agency}. */
export function worded(text: string, w: { one: (c: number) => string; many: (c: number) => string; lower: (c: number, plural?: boolean) => string }, codes: { shift: number; agency: number }): string {
  return text
    .replaceAll('{shift}', w.lower(codes.shift)).replaceAll('{shifts}', w.lower(codes.shift, true)).replaceAll('{Shifts}', w.many(codes.shift))
    .replaceAll('{agency}', w.lower(codes.agency)).replaceAll('{agencies}', w.lower(codes.agency, true)).replaceAll('{Agency}', w.one(codes.agency));
}

/** The days a trend line shows: the same weekday for the last 13 weeks, oldest first, ending today. */
export function trendDays(today: string, weeks = 13): string[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: weeks }, (_, i) => new Date(t - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10));
}

// ---- Live numbers (David, 3 Nov 2026, answer 1): shifts, allocation officers and personnel for a period, for the
// business, a state or an office. Defined here once; worked out by `liveNumbers` in dashboard-data.ts.

export const LIVE_PERIODS = ['today', 'week', 'last7', 'month', 'prev_month'] as const;
export type LivePeriod = typeof LIVE_PERIODS[number];
/** The same words as the Allocations period choice (David, 4 Nov: "Current week", "Current month", "Previous month"). */
export const LIVE_PERIOD_LABEL: Record<LivePeriod, string> = {
  today: 'Today', week: 'Current week', last7: 'Last 7 days', month: 'Current month', prev_month: 'Previous month',
};

/**
 * The period's first and last local dates (inclusive) for the business's `today`: today; the current week (Monday to
 * Sunday); the last 7 days (today and the six before); the current month (the 1st to its last day); the previous
 * month (its 1st to its last day).
 */
export function livePeriod(period: LivePeriod, today: string): { from: string; to: string } {
  const t = new Date(`${today}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'last7': return { from: iso(plus(t, -6)), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0))) };
    case 'prev_month': return { from: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))), to: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))) };
    case 'week': {
      const monday = plus(t, -((t.getUTCDay() + 6) % 7));
      return { from: iso(monday), to: iso(plus(monday, 6)) };
    }
  }
}

export type LiveGroup = 'shifts' | 'officers' | 'personnel';
export interface LiveDef {
  key: string;
  group: LiveGroup;
  label: string;
  /** How it is worked out (tokens {shift} {shifts} {Shifts} {client} {clients} {Client}). */
  how: string;
  /** Shown as a percentage of client requests as well as a number. */
  ofRequests: boolean;
}

/**
 * The live numbers. Every {shift} number counts {shifts} needing a person at a {client}'s site whose local start
 * date is in the period (a {client} request), so filled + waiting + unfilled + cancelled = requests.
 */
export const LIVE: readonly LiveDef[] = [
  { key: 'requests', group: 'shifts', label: '{Client} requests', ofRequests: false,
    how: '{Shifts} needing a person at {client} sites that start in the period (local dates), cancelled ones included' },
  { key: 'filled', group: 'shifts', label: 'Filled', ofRequests: true,
    how: '{Client} requests booked: someone is on the {shift} and has confirmed' },
  { key: 'waiting', group: 'shifts', label: 'Waiting to confirm', ofRequests: true,
    how: '{Client} requests with someone allocated who hasn\'t confirmed yet' },
  { key: 'unfilled', group: 'shifts', label: 'Unfilled', ofRequests: true,
    how: '{Client} requests with nobody on them, not cancelled: still open, or started or ended empty' },
  { key: 'client_cancelled', group: 'shifts', label: '{Client} cancelled', ofRequests: true,
    how: '{Client} requests cancelled because the {client} cancelled or withdrew the request' },
  { key: 'other_cancelled', group: 'shifts', label: 'Cancelled, other reasons', ofRequests: true,
    how: '{Client} requests cancelled for any other reason (we couldn\'t fill it, our mistake, other, or cancelled before reasons were recorded)' },

  { key: 'handled', group: 'officers', label: '{Shifts} handled', ofRequests: false,
    how: 'Different {shifts} the officer worked on in the period: changed in the office (added, filled, confirmed, removed, cancelled, times), offered, recorded the {client}\'s yes, or logged a call about' },
  { key: 'messages', group: 'officers', label: 'Messages sent', ofRequests: false,
    how: 'Emails, texts and app messages to workers that the officer\'s actions sent in the period (offers, rosters, bookings); messages not sent are left out' },
  { key: 'calls', group: 'officers', label: 'Calls made', ofRequests: false,
    how: 'Calls the officer logged in the period, to workers or {clients} (calls they took count too)' },

  { key: 'accepted', group: 'personnel', label: 'Accepted, not worked yet', ofRequests: true,
    how: '{Client} requests in the period booked to the person that haven\'t started yet' },
  { key: 'worked', group: 'personnel', label: 'Worked', ofRequests: true,
    how: '{Client} requests in the period booked to the person that have ended' },
  { key: 'pulled_out', group: 'personnel', label: 'Pull-outs', ofRequests: false,
    how: 'Times a person pulled out of a {client}\'s {shift} in the period (when they pulled out); agency people are left out' },
] as const;

/** {client} tokens as well as the {shift} and {agency} ones. */
export function liveWorded(text: string, w: { one: (c: number) => string; many: (c: number) => string; lower: (c: number, plural?: boolean) => string },
  codes: { shift: number; agency: number; client: number }): string {
  return worded(text, w, codes)
    .replaceAll('{client}', w.lower(codes.client)).replaceAll('{clients}', w.lower(codes.client, true)).replaceAll('{Client}', w.one(codes.client));
}
