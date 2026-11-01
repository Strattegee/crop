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

// ---- My credentials ----

export type CheckState = 'checked' | 'to_check' | 'not_accepted';
export const CHECK_LABEL: Record<CheckState, string> = { checked: 'Checked', to_check: 'Waiting for the office to check', not_accepted: 'Not accepted' };
export type Level = 'hard' | 'warning' | 'optional';
export const LEVEL_LABEL: Record<Level, string> = { hard: 'Needed', warning: 'Recommended', optional: 'Optional' };

export interface MyCredential {
  id: string; credentialTypeId: string; typeName: string; number: string | null; issuedBy: string | null;
  issueDate: string | null; expiryDate: string | null; check: CheckState; status: 'valid' | 'expiring' | 'expired';
  needsEvidence: boolean; files: string[]; canAddFiles: boolean;
}
export interface MyNeed { credentialTypeId: string; typeName: string; must: boolean; problem: string; line: string; canAdd: boolean }
export interface CredentialType { id: string; name: string; hasNumber: boolean; hasExpiry: boolean; level: Level | null }

/** "3 Nov 2027" from YYYY-MM-DD. */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The expiry line on a credential card. */
export function expiryLine(c: { expiryDate: string | null; status: 'valid' | 'expiring' | 'expired' }): string {
  if (!c.expiryDate) return 'No expiry date';
  if (c.status === 'expired') return `Ran out ${longDate(c.expiryDate)}`;
  return `${c.status === 'expiring' ? 'Runs out soon: ' : 'Runs out '}${longDate(c.expiryDate)}`;
}

/** The person's own right to work (GET /my/right-to-work, also `rightToWork` on GET /my/credentials). */
export type RtwState = 'none' | 'to_check' | 'checked' | 'not_accepted';
export interface MyRightToWork {
  state: RtwState; line: string; statusLabel: string | null; visaExpiry: string | null; files: string[]; canAddFiles: boolean;
}
export const RTW_BADGE: Record<RtwState, string> = {
  none: 'Not recorded yet', to_check: 'Waiting for the office to check', checked: 'Checked', not_accepted: 'Not accepted',
};

/** The line under "Right to work": what the office recorded and how many files have gone, e.g. "Visa holder · visa runs out 1 December 2026 · 2 files sent". */
export function rtwDetail(r: MyRightToWork): string | null {
  const parts = [
    r.statusLabel,
    r.visaExpiry ? `visa runs out ${longDate(r.visaExpiry)}` : null,
    r.files.length ? `${r.files.length} file${r.files.length === 1 ? '' : 's'} sent` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** What to say under a credential about its files. */
export function filesLine(c: { files: string[]; needsEvidence: boolean; check: CheckState }): string | null {
  if (c.files.length) return `${c.files.length} file${c.files.length === 1 ? '' : 's'} added`;
  if (c.check === 'to_check' && c.needsEvidence) return 'Add a photo or file so the office can check it';
  return null;
}

/**
 * A date from separate day, month and year boxes (no order of day and month to guess, whatever the country),
 * as YYYY-MM-DD; '' when all three are blank, null when it isn't a real date.
 */
export function dateFromParts(day: string, month: string, year: string): string | null | '' {
  const [d, m, y] = [day.trim(), month.trim(), year.trim()];
  if (!d && !m && !y) return '';
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso;
}

/** A file name for an upload: the picked name, or one made from its type ("photo.jpg"). */
export function uploadName(name: string | null | undefined, mimeType: string | null | undefined): string {
  if (name && name.trim()) return name.trim();
  const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/heic' ? 'heic' : 'jpg';
  return `photo.${ext}`;
}

// ---- Getting started (GET /my/onboarding): the person's onboarding checklist, worded by the API ----
export type StepState = 'done' | 'waiting' | 'to_do';
export interface MyStep { id: string; title: string; kind: string; required: boolean; state: StepState; line: string; yours: boolean }
export interface MyOnboarding { checklistName: string; done: number; total: number; ready: boolean; line: string; steps: MyStep[] }

/** The mark beside a step: ticked, waiting for the office, or still to do. */
export const STEP_MARK: Record<StepState, string> = { done: '✓', waiting: '…', to_do: '○' };

/** Whether any step is one the person can do in the app (so the card offers to go to the credentials tab). */
export function hasStepsForMe(o: MyOnboarding | null): boolean {
  return !!o?.steps.some(s => s.yours);
}

/** What My shifts says when there are none: someone being onboarded hears why. */
export function noShiftsLine(word: { lowerMany: string }, onboarding: MyOnboarding | null): string {
  if (onboarding) return `Your ${word.lowerMany} show here once the office has finished getting you started.`;
  return `No ${word.lowerMany} in the next four weeks yet. New ones show here once the roster is published.`;
}

/** The worker privacy notice (GET /my `notice`): shown the first time and whenever it changes, until confirmed. */
export interface MyNotice { version: string; url: string | null; state: 'new' | 'changed' | 'seen'; acknowledgedAt: string | null }

export function needsNotice(n: MyNotice | null | undefined): boolean {
  return !!n && n.state !== 'seen';
}

export function noticeText(n: MyNotice, business: string): { heading: string; body: string } {
  if (n.state === 'changed') {
    return {
      heading: 'Our privacy notice has changed',
      body: 'The worker privacy notice for the CROP app has been updated. Please read the new version before you carry on.',
    };
  }
  return {
    heading: 'Before you start',
    body: `CROP is provided by Strattegee Pty Ltd. ${business || 'Your employer'} uses it for your shifts and work records. `
      + 'Please read how your information is handled.',
  };
}
