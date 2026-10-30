/** Pure helpers for the worker app's screens (tested in test/format.spec.ts). */

export interface MyShift {
  id: string;
  date: string; // YYYY-MM-DD, the site's local date
  start: string; // HH:MM local
  end: string;
  site: string;
  area: string | null;
  role: string;
  timezone: string;
  breakMinutes: number;
  duties: string[];
  label: string;
  state: 'booked' | 'to_confirm';
}

export interface MyOffer {
  id: string;
  expiresAt: string | null;
  offeredAt: string;
  shift: Omit<MyShift, 'state'>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 2 Nov" for a YYYY-MM-DD date; "Today" and "Tomorrow" relative to `today`. */
export function dayLabel(date: string, today?: string): string {
  if (today && date === today) return 'Today';
  if (today && date === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Shifts grouped by local date, in order. */
export function byDay<S extends { date: string }>(shifts: S[]): { date: string; shifts: S[] }[] {
  const out: { date: string; shifts: S[] }[] = [];
  for (const s of shifts) {
    const last = out[out.length - 1];
    if (last && last.date === s.date) last.shifts.push(s);
    else out.push({ date: s.date, shifts: [s] });
  }
  return out;
}

/** "07:00–15:30" plus the break when there is one. */
export function timeRange(s: { start: string; end: string; breakMinutes: number }): string {
  const t = `${s.start}–${s.end}`;
  return s.breakMinutes > 0 ? `${t} (${s.breakMinutes} min break)` : t;
}

/** "Chef · Kitchen" */
export function roleLine(s: { role: string; area: string | null }): string {
  return s.area ? `${s.role} · ${s.area}` : s.role;
}

/** How long an offer stays open, in plain words, or null when it has no closing time. */
export function offerCloses(expiresAt: string | null, now = new Date()): string | null {
  if (!expiresAt) return null;
  const mins = Math.round((Date.parse(expiresAt) - now.getTime()) / 60_000);
  if (mins <= 0) return 'Closed';
  if (mins < 60) return `Closes in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Closes in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `Closes in ${days} day${days === 1 ? '' : 's'}`;
}

export const STATE_LABEL: Record<MyShift['state'], string> = { booked: 'Booked', to_confirm: 'To be confirmed' };

/** The businesses someone can use the app in (any role; the API says if they aren't on that business's staff). */
export function businessesOf(me: { memberships: { tenantSlug: string; tenantName: string; role: string }[] }) {
  return me.memberships.map(m => ({ slug: m.tenantSlug, name: m.tenantName }));
}

// Availability and leave (the Availability tab).

export type Period = 'am' | 'pm' | 'night';
export const PERIODS: Period[] = ['am', 'pm', 'night'];
export const PERIOD_LABEL: Record<Period, string> = { am: 'AM', pm: 'PM', night: 'Night' };
/** Monday = 1 … Sunday = 7, as the API counts them. */
export const WEEKDAYS: { weekday: number; name: string }[] =
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((name, i) => ({ weekday: i + 1, name }));

/** A day's availability in words: nothing said, not available, any time, or the parts of the day. */
export function periodsLabel(periods: Period[] | undefined): string {
  if (!periods) return 'Not said';
  if (periods.length === 0) return 'Not available';
  if (periods.length === PERIODS.length) return 'Any time';
  return PERIODS.filter(p => periods.includes(p)).map(p => PERIOD_LABEL[p]).join(', ');
}

export type DayChip = Period | 'off';

/**
 * What a day becomes when a chip is pressed: a part of the day switches on or off (switching off the last one
 * leaves "not available"); Off makes the day not available, or, pressed again, nothing said.
 */
export function toggleDay(current: Period[] | undefined, chip: DayChip): Period[] | undefined {
  if (chip === 'off') return current && current.length === 0 ? undefined : [];
  const now = current ?? [];
  const next = now.includes(chip) ? now.filter(p => p !== chip) : [...now, chip];
  return PERIODS.filter(p => next.includes(p));
}

/** Whether a chip shows as on for a day. */
export function chipOn(current: Period[] | undefined, chip: DayChip): boolean {
  if (chip === 'off') return !!current && current.length === 0;
  return !!current && current.includes(chip);
}

/** The usual week as the API takes it: days with nothing said are left out. */
export function patternBody(week: Record<number, Period[] | undefined>): { days: { weekday: number; periods: Period[] }[] } {
  return {
    days: WEEKDAYS.filter(d => week[d.weekday] !== undefined).map(d => ({ weekday: d.weekday, periods: week[d.weekday]! })),
  };
}

export type LeaveKind = 'annual' | 'personal' | 'long_service' | 'unpaid' | 'other';
export const LEAVE_KINDS: LeaveKind[] = ['annual', 'personal', 'long_service', 'unpaid', 'other'];
export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = {
  annual: 'Annual', personal: 'Personal', long_service: 'Long service', unpaid: 'Unpaid', other: 'Other',
};
export const LEAVE_STATUS_LABEL: Record<string, string> = {
  requested: 'Waiting for approval', approved: 'Approved', declined: 'Declined', cancelled: 'Withdrawn',
};

export interface MyLeave { id: string; kind: LeaveKind; startsOn: string; endsOn: string; days: number; status: string; note: string | null }

/** "Mon 2 Nov" for one day, "Mon 2 Nov – Wed 4 Nov (3 days)" for more. */
export function leaveDates(l: { startsOn: string; endsOn: string }): string {
  if (l.startsOn === l.endsOn) return dayLabel(l.startsOn);
  const days = Math.round((Date.parse(`${l.endsOn}T00:00:00Z`) - Date.parse(`${l.startsOn}T00:00:00Z`)) / 86_400_000) + 1;
  return `${dayLabel(l.startsOn)} – ${dayLabel(l.endsOn)} (${days} days)`;
}

/** What the app says after asking for leave. */
export function leaveAskedMessage(shiftsDuring: number, word: { lower: string; lowerMany: string }): string {
  const base = 'The office will let you know once it has been decided.';
  if (shiftsDuring === 0) return base;
  return `You're on ${shiftsDuring} ${shiftsDuring === 1 ? word.lower : word.lowerMany} in those days. ${base}`;
}
