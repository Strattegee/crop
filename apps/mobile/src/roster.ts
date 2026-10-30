/**
 * Pure helpers for the roster in manager mode (backlog item 9a: the day and week roster and publishing from the
 * phone; tested in test/roster.spec.ts). The screen calls the office endpoints as they are (`GET /shifts`,
 * `GET /roster/weeks`, `POST /roster/publish`); these only shape what it shows.
 */
import { addDays, dayLabel } from './format';
import { mondayOf, type ShiftDetail } from './shift';
import type { Term } from './manager';

/** A row from GET /shifts (the same columns as the web roster's shifts). */
export type RosterShift = ShiftDetail & { shiftLetter: string | null };

/** A row from GET /roster/weeks: one site's state for the week. */
export interface WeekRow {
  facilityId: string; facilityName: string; weekStart: string; state: 'draft' | 'live' | 'history';
  version: number | null; publishedAt: string | null; publishedByName: string | null;
  changesSincePublish: number; shifts: number; changeRefusal: string | null; pendingRequests: number;
}

/** The seven dates of the week starting `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The day to show first: today when it's in the week, else the Monday. */
export function firstDay(weekStart: string, today?: string): string {
  return today && weekDates(weekStart).includes(today) ? today : weekStart;
}

/** The week to open on: the one with today in it (the business's today), else the week of `fallback`. */
export function currentWeek(today: string | undefined, fallback: string): string {
  return mondayOf(today ?? fallback);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dm(date: string): { d: number; m: string } {
  const x = new Date(`${date}T00:00:00Z`);
  return { d: x.getUTCDate(), m: MONTHS[x.getUTCMonth()] };
}

/** "2–8 Nov", or "30 Nov – 6 Dec" across months, with "This week" / "Next week" / "Last week" in front when it is. */
export function weekTitle(weekStart: string, today?: string): string {
  const a = dm(weekStart);
  const b = dm(addDays(weekStart, 6));
  const span = a.m === b.m ? `${a.d}–${b.d} ${b.m}` : `${a.d} ${a.m} – ${b.d} ${b.m}`;
  if (!today) return span;
  const now = mondayOf(today);
  const name = weekStart === now ? 'This week' : weekStart === addDays(now, 7) ? 'Next week' : weekStart === addDays(now, -7) ? 'Last week' : null;
  return name ? `${name} · ${span}` : span;
}

/** A day chip: "Today", else "Mon 2". */
export function dayChip(date: string, today?: string): string {
  if (today && date === today) return 'Today';
  return dayLabel(date).split(' ').slice(0, 2).join(' ');
}

/** A shift still needs a person: nobody on it, not cancelled, not equipment only. */
export function unfilled(s: Pick<RosterShift, 'status' | 'equipmentOnly' | 'workerId'>): boolean {
  return s.status !== 'cancelled' && !s.equipmentOnly && !s.workerId;
}

/** "6 shifts · 2 unfilled · 30 h filled" for a day or a week (cancelled ones left out). */
export function summaryLine(shifts: RosterShift[], word: { lower: string; lowerMany: string }): string {
  const live = shifts.filter(s => s.status !== 'cancelled');
  if (!live.length) return `No ${word.lowerMany}`;
  const open = live.filter(unfilled).length;
  const filled = live.filter(s => s.workerId).reduce((h, s) => h + s.hours, 0);
  const parts = [`${live.length} ${live.length === 1 ? word.lower : word.lowerMany}`];
  if (open) parts.push(`${open} unfilled`);
  parts.push(`${Math.round(filled * 100) / 100} h filled`);
  return parts.join(' · ');
}

/** Count of unfilled shifts on a date, for the day chips. */
export function openOn(shifts: RosterShift[], date: string): number {
  return shifts.filter(s => s.localDate === date && unfilled(s)).length;
}

/** "07:00–15:30 · Cook · Kitchen", with the shift type's letter in front when it has one. */
export function shiftLine(s: Pick<RosterShift, 'localStart' | 'localEnd' | 'role' | 'areaName' | 'shiftLetter'>): string {
  const letter = s.shiftLetter ? `${s.shiftLetter} ` : '';
  return `${letter}${s.localStart}–${s.localEnd} · ${s.role}${s.areaName ? ` · ${s.areaName}` : ''}`;
}

export const STATE_LABEL: Record<WeekRow['state'], string> = { draft: 'Draft', live: 'Live', history: 'History' };

/** The sites worth showing for the week: those with shifts, or already published. */
export function weekRowsShown(rows: WeekRow[], facilityId: string | null): WeekRow[] {
  return rows.filter(w => (facilityId ? w.facilityId === facilityId : w.shifts > 0 || w.version !== null));
}

/** One site's state: "Live · published by Sam Lee · 3 changes since"; "Draft · 12 shifts"; "History". */
export function weekStateLine(w: WeekRow, word: { lower: string; lowerMany: string }): string {
  if (w.state === 'history') return 'History: this week is over and can no longer be published';
  if (w.state === 'draft') return w.shifts ? `Draft · ${w.shifts} ${w.shifts === 1 ? word.lower : word.lowerMany}, not published yet` : 'Draft · nothing on this week yet';
  const by = w.publishedByName ? ` by ${w.publishedByName}` : '';
  const changes = w.changesSincePublish ? ` · ${w.changesSincePublish} ${w.changesSincePublish === 1 ? 'change' : 'changes'} since` : '';
  return `Live · published${by}${changes}`;
}

/**
 * What the Publish button does for the sites shown, as on the web: "Publish week" while any is a draft with
 * something on it, else "Publish N changes", else nothing to publish (null).
 */
export function publishLabel(rows: WeekRow[]): string | null {
  if (rows.some(w => w.state === 'draft' && w.shifts > 0)) return 'Publish week';
  const changes = rows.filter(w => w.state === 'live').reduce((n, w) => n + w.changesSincePublish, 0);
  return changes ? `Publish ${changes} ${changes === 1 ? 'change' : 'changes'}` : null;
}

/** The message after publishing (the web's wording). */
export function publishedMessage(r: { messages: number }, notify: boolean, people: { lowerMany: string }, word: { lowerMany: string }): string {
  const base = 'Published. The week is live; changes from now on are logged.';
  if (!notify) return `${base} No messages sent.`;
  if (!r.messages) return `${base} Nobody needed a message.`;
  return `${base} ${r.messages} ${r.messages === 1 ? 'message' : 'messages'} sent to ${people.lowerMany} with their ${word.lowerMany}.`;
}

/** The business's word for a term from GET /terms (e.g. 'worker', 'site'), falling back to CROP's. */
export function termWord(terms: Term[] | null | undefined, key: string, one: string, many: string): { one: string; many: string; lower: string; lowerMany: string } {
  const t = terms?.find(x => x.key === key);
  const o = t?.singular || one;
  const m = t?.plural || many;
  return { one: o, many: m, lower: o.toLowerCase(), lowerMany: m.toLowerCase() };
}
