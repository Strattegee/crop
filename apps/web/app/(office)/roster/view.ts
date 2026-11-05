import { DEFAULT_MARKER_LETTERS, type MarkerLetters } from '../../../lib/marker-letters';
/**
 * Day, week and month views of the roster: date ranges, navigation and the day timeline.
 * Pure functions (no React, no API) so they can be unit-tested.
 */

import { hereLine } from '../../../lib/allocation-queue';
import { distanceWords } from '../../../lib/distance';

export type Span = 'day' | 'week' | 'month';

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY));
export function mondayOf(d: string) {
  const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(d, -wd);
}
export const isDate = (s: string | undefined): s is string => !!s && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && iso(new Date(`${s}T00:00:00Z`)) === s;
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonths(d: string, n: number) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n;
  return iso(new Date(Date.UTC(y, m, 1)));
}
function monthEnd(d: string) {
  return addDays(addMonths(monthStart(d), 1), -1);
}

export function parseSpan(s: string | undefined): Span {
  return s === 'day' || s === 'month' ? s : 'week';
}

/**
 * The date the view is anchored on: `date` if valid, else `week` (older links), else today.
 */
export function anchorOf(sp: { date?: string; week?: string }, today: string) {
  if (isDate(sp.date)) return sp.date;
  if (isDate(sp.week)) return sp.week;
  return today;
}

export type RangeInfo = {
  span: Span;
  anchor: string;
  /** Monday of the anchor's week (publishing works by week). */
  week: string;
  /** Dates shown as columns (week), the one day (day), or every date in the calendar grid (month, Monday to Sunday). */
  days: string[];
  /** What to ask the API for. Day view asks for the whole week so hours compare with weekly contracts. */
  fetchFrom: string;
  fetchTo: string;
  prev: string;
  next: string;
  /** The anchor for "Today" / "This week" / "This month". */
  current: string;
  currentLabel: string;
};

export function rangeFor(span: Span, anchor: string, today: string): RangeInfo {
  const week = mondayOf(anchor);
  if (span === 'day') {
    return {
      span, anchor, week, days: [anchor], fetchFrom: week, fetchTo: addDays(week, 6),
      prev: addDays(anchor, -1), next: addDays(anchor, 1), current: today, currentLabel: 'Today',
    };
  }
  if (span === 'month') {
    const first = monthStart(anchor);
    const gridFrom = mondayOf(first);
    const gridTo = addDays(mondayOf(monthEnd(anchor)), 6);
    const n = Math.round((Date.parse(`${gridTo}T00:00:00Z`) - Date.parse(`${gridFrom}T00:00:00Z`)) / DAY) + 1;
    return {
      span, anchor: first, week, days: Array.from({ length: n }, (_, i) => addDays(gridFrom, i)), fetchFrom: gridFrom, fetchTo: gridTo,
      prev: addMonths(first, -1), next: addMonths(first, 1), current: monthStart(today), currentLabel: 'This month',
    };
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return {
    span, anchor: week, week, days, fetchFrom: days[0], fetchTo: days[6],
    prev: addDays(week, -7), next: addDays(week, 7), current: mondayOf(today), currentLabel: 'This week',
  };
}

/** Where to land when switching view: keep today if it's in what's on screen, else the first day shown. */
export function anchorForSwitch(from: RangeInfo, to: Span, today: string) {
  const shown = from.span === 'month' ? from.days.filter(d => d.slice(0, 7) === from.anchor.slice(0, 7)) : from.days;
  const pick = shown.includes(today) ? today : from.span === 'day' ? from.anchor : shown[0];
  return to === 'week' ? mondayOf(pick) : to === 'month' ? monthStart(pick) : pick;
}

/** Monday-to-Sunday rows of the month grid. */
export function weeksOf(days: string[]) {
  const out: string[][] = [];
  for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
  return out;
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Start and end in minutes from the start of the shift's local day; overnight shifts end after 1440. */
export function shiftMinutes(s: { localStart: string; localEnd: string }) {
  const start = mins(s.localStart);
  let end = mins(s.localEnd);
  if (end <= start) end += 1440;
  return { start, end };
}

export type Window = { from: number; to: number; ticks: number[] };

/**
 * The hours the day timeline shows: from the earliest start to the latest end (whole hours),
 * at least 8 hours wide, 06:00 to 22:00 when the day is empty.
 */
export function dayWindow(shifts: { localStart: string; localEnd: string }[]): Window {
  let from = 6 * 60, to = 22 * 60;
  if (shifts.length) {
    from = Math.min(...shifts.map(s => shiftMinutes(s).start));
    to = Math.max(...shifts.map(s => shiftMinutes(s).end));
    from = Math.floor(from / 60) * 60;
    to = Math.ceil(to / 60) * 60;
    if (to - from < 8 * 60) {
      const extra = 8 * 60 - (to - from);
      from = Math.max(0, from - Math.floor(extra / 120) * 60);
      to = Math.max(to, from + 8 * 60);
    }
  }
  const step = to - from > 16 * 60 ? 180 : to - from > 10 * 60 ? 120 : 60;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return { from, to, ticks };
}

/** Left and width of a shift on the timeline, in percent. */
export function barPosition(s: { localStart: string; localEnd: string }, w: Window) {
  const { start, end } = shiftMinutes(s);
  const span = w.to - w.from;
  const left = Math.max(0, (start - w.from) / span) * 100;
  const right = Math.min(1, (end - w.from) / span) * 100;
  return { left: Math.round(left * 100) / 100, width: Math.max(2, Math.round((right - left) * 100) / 100) };
}

/** 13:00 → "1pm", 24:00 / 0:00 → "12am", 30:00 → "6am". */
export function tickLabel(m: number) {
  const h = Math.floor(m / 60) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

/**
 * Day summary for the month calendar: people shifts on the day (not cancelled), filled, open hours and leave.
 */
export function daySummary(
  day: string,
  shifts: { localDate: string; status: string; equipmentOnly?: boolean; hours: number }[],
  leave: { workerId: string; status: string; startsOn: string; endsOn: string }[],
) {
  const people = shifts.filter(s => s.localDate === day && s.status !== 'cancelled' && !s.equipmentOnly);
  const filled = people.filter(s => s.status !== 'open');
  const onLeave = new Set(leave.filter(l => l.status === 'approved' && l.startsOn <= day && l.endsOn >= day).map(l => l.workerId));
  return {
    shifts: people.length,
    filled: filled.length,
    open: people.length - filled.length,
    hours: Math.round(filled.reduce((a, s) => a + s.hours, 0) * 10) / 10,
    cancelled: shifts.filter(s => s.localDate === day && s.status === 'cancelled').length,
    onLeave: onLeave.size,
  };
}

/**
 * Stacks overlapping shifts in a row of the day timeline: each shift goes in the first lane that is free
 * when it starts. Returns the lane for each shift id and how many lanes the row needs.
 */
export function lanes<T extends { id: string; localStart: string; localEnd: string }>(shifts: T[]) {
  const sorted = [...shifts].sort((a, b) => shiftMinutes(a).start - shiftMinutes(b).start || shiftMinutes(a).end - shiftMinutes(b).end);
  const ends: number[] = [];
  const lane = new Map<string, number>();
  for (const s of sorted) {
    const { start, end } = shiftMinutes(s);
    let i = ends.findIndex(e => e <= start);
    if (i === -1) { i = ends.length; ends.push(end); } else ends[i] = end;
    lane.set(s.id, i);
  }
  return { lane, count: Math.max(1, ends.length) };
}

/** One line for a week in the month calendar from its sites' states (Draft / Live / History). */
export function weekStateLabel(rows: { state: 'draft' | 'live' | 'history'; shifts: number; version: number | null; changesSincePublish: number }[]) {
  const shown = rows.filter(r => r.shifts > 0 || r.version !== null);
  if (rows.length && rows.every(r => r.state === 'history')) return { cls: 'history', text: 'History' };
  if (!shown.length) return null;
  const drafts = shown.filter(r => r.state === 'draft').length;
  const changes = shown.filter(r => r.state === 'live').reduce((a, r) => a + r.changesSincePublish, 0);
  if (drafts === shown.length) return { cls: 'draft', text: 'Draft' };
  if (drafts) return { cls: 'draft', text: `${drafts} of ${shown.length} sites in draft` };
  return { cls: 'live', text: changes ? `Live · ${changes} ${changes === 1 ? 'change' : 'changes'} since` : 'Live' };
}

/**
 * The weeks of a month for copying it: the Mondays that fall in the month (four or five), and the Monday
 * straight after the last of them, where the copy goes by default.
 */
export function monthCopyWeeks(anyDayInMonth: string): { mondays: string[]; nextWeek: string } {
  const first = monthStart(anyDayInMonth);
  let m = mondayOf(first);
  if (m < first) m = addDays(m, 7);
  const mondays: string[] = [];
  for (; m.slice(0, 7) === first.slice(0, 7); m = addDays(m, 7)) mondays.push(m);
  return { mondays, nextWeek: m };
}

/** Remembers whether the office opened or closed the Needs attention panel (per browser, a year). */
/** Remembers the roster's full page view (the menu bar and the boxes above the roster folded away; David, 29 Oct). */
export const ROSTER_FULL_COOKIE = 'crop_roster_full';
export const ATTENTION_COOKIE = 'crop_attention';

/**
 * How much each shift card shows (Steve's design: Cards / Detailed / Simple, week view).
 * Cards is the usual card; Detailed adds the role, area, hours, notes and who pulled out;
 * Simple is one line (letter and who, or the role while unfilled), coloured by stage.
 */
export type Look = 'cards' | 'detailed' | 'simple';
export const LOOKS: { id: Look; label: string }[] = [
  { id: 'cards', label: 'Cards' }, { id: 'detailed', label: 'Detailed' }, { id: 'simple', label: 'Simple' },
];
export function parseLook(s: string | undefined): Look {
  return s === 'detailed' || s === 'simple' ? s : 'cards';
}

type CardShift = {
  role: string; areaName: string | null; facilityName: string; hours: number; workerName: string | null;
  status: string; notes: string | null; cancelledReason?: string | null; pulledOutName?: string | null; equipmentOnly?: boolean;
};
const hoursText = (h: number) => `${Math.round(h * 100) / 100} ${h === 1 ? 'hour' : 'hours'}`;

/**
 * The extra lines a Detailed card shows, below the usual card. `kind` is the row the card sits in
 * ('person' rows already say who; open rows already say the role), `view` the roster's grouping.
 */
export function detailLines(s: CardShift, kind: string, view: 'area' | 'person'): string[] {
  const out: string[] = [];
  // The usual card names the person (or the role while nobody is on it); say the other one too.
  // An area row's card already names both the person and the role.
  if (kind !== 'person' && kind !== 'cancelled' && kind !== 'area' && s.workerName && !s.equipmentOnly) out.push(s.role);
  if (s.areaName && (view === 'person' || kind === 'person')) out.push(s.areaName);
  out.push(hoursText(s.hours));
  if (s.pulledOutName) out.push(`${s.pulledOutName} pulled out`);
  if (s.status === 'cancelled' && s.cancelledReason) out.push(`Cancelled: ${s.cancelledReason}`);
  if (s.notes?.trim()) out.push(s.notes.trim());
  return out;
}

/** The one line on a Simple card: who is on it, else the role (or the equipment-only label). */
export function simpleLine(s: CardShift & { equipment?: unknown[] }, kind: string): string {
  // Area rows (29 Oct): who is on it, or Unfilled, then the role.
  const who = kind === 'area' && s.status !== 'cancelled'
    ? (s.equipmentOnly ? s.role : `${s.workerName ?? 'Unfilled'} · ${s.role}`)
    : kind === 'person' || s.status === 'cancelled' ? s.role : s.workerName ?? s.role;
  const extra = s.equipment?.length ? ` +${s.equipment.length}` : '';
  return `${who}${extra}`;
}

/** An item the shift panel can put on a shift (Items page catalogue, with stock at the shift's site). */
export type PanelItem = { id: string; name: string; unit: string; tracksStock: boolean };
export type ItemChoice = { id: string; label: string; disabled: boolean };
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The item list in the shift panel: counted items say how many the shift's site has ("12 here"), and
 * are greyed out when it has none; items that aren't counted (fuel bought on a card) are always offered.
 * Items with stock come first, then the rest, each in name order.
 */
export function shiftItemChoices(items: PanelItem[], stockHere: { itemId: string; onHand: number }[]): ItemChoice[] {
  const here = new Map(stockHere.map(s => [s.itemId, s.onHand]));
  const choices = items.map(i => {
    const onHand = here.get(i.id) ?? 0;
    const none = i.tracksStock && onHand <= 0;
    const label = `${i.name} (${i.unit})${i.tracksStock ? ` · ${none ? 'none here' : `${qtyText(onHand)} here`}` : ''}`;
    return { id: i.id, label, disabled: none, name: i.name };
  });
  choices.sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name));
  return choices.map(({ id, label, disabled }) => ({ id, label, disabled }));
}

/**
 * Dragging an item from the strip onto a shift (backlog item 5): one of it, given to the person on the shift
 * when there is one (as the panel's "Give to" tick defaults), otherwise used on the shift. Mirrors the panel.
 */
export function itemDrop(workerId: string | null | undefined, equipmentOnly: boolean): { workerId: string | null; quantity: 1 } {
  return { workerId: workerId && !equipmentOnly ? workerId : null, quantity: 1 };
}

/** What the office is told after dropping an item: what happened and where to change it. */
export function itemDropMessage(itemName: string, unit: string | undefined, workerName: string | null | undefined, shiftWord: string): string {
  const one = `${itemName} (1${unit ? ` ${unit}` : ''})`;
  const what = workerName ? `${one} given to ${workerName} for this ${shiftWord}` : `${one} recorded as used on this ${shiftWord}`;
  return `${what}. Change how many or return it under Items below.`;
}

/** The roster URL to come back to with a shift's panel open (keeps week, site, view; drops old messages). */
export function withShift(back: string, shiftId: string): string {
  const u = new URL(back.startsWith('/roster') ? back : '/roster', 'http://roster.local');
  u.searchParams.set('shift', shiftId);
  u.searchParams.delete('done');
  u.searchParams.delete('error');
  return `${u.pathname}${u.search}`;
}

/** Steve's "T" line on a card (migration 0035): the person the shift covers. Never why they're away. */
export const coveringLine = (name: string) => `Covering ${name}`;

/** Why the usual person isn't there that day (migration 0077, worked out by the API). Never the kind of leave. */
export type UsualAway = 'on_leave' | 'leave_requested' | 'not_available';
export const USUAL_AWAY_WORDS: Record<UsualAway, string> = { on_leave: 'On leave', leave_requested: 'Leave requested', not_available: 'Not available' };

export type TLineShift = {
  workerId?: string | null; usualWorkerId?: string | null; usualName?: string | null; usualAway?: UsualAway | null;
  coveringWorkerId?: string | null; coveringName?: string | null;
};
/** same = the usual person is working it (greyed); usual = someone else or nobody is on it; away = the usual person is away. */
export type TLine = { text: string; title: string; tone: 'same' | 'usual' | 'away' | 'covering' };

/**
 * The card's "T" (template) lines (David, 3 Nov): who usually works the shift, with " – On leave" / " – Leave requested" /
 * " – Not available" when they're away that day (never the kind of leave), greyed when they're the one working it. The
 * hand-set covering line (migration 0035) follows only when it names someone else, so the same person is never shown twice.
 */
export function tLines(s: TLineShift): TLine[] {
  const out: TLine[] = [];
  if (s.usualWorkerId && s.usualName) {
    const away = s.usualAway ? USUAL_AWAY_WORDS[s.usualAway] : null;
    const working = !!s.workerId && s.workerId === s.usualWorkerId;
    out.push({
      text: away ? `${s.usualName} – ${away}` : s.usualName,
      title: `Usually worked by ${s.usualName}${away ? ` (${away.toLowerCase()} that day)` : working ? ' (on it)' : ''}`,
      tone: away ? 'away' : working ? 'same' : 'usual',
    });
  }
  if (s.coveringWorkerId && s.coveringName && s.coveringWorkerId !== s.usualWorkerId) {
    out.push({ text: coveringLine(s.coveringName), title: coveringLine(s.coveringName), tone: 'covering' });
  }
  return out;
}

/** People offered as a shift's usual person: everyone on the roster by name, keeping the current one even if they've gone. */
export function usualChoices(people: { id: string; name: string }[], current: { id: string | null; name: string | null }): { id: string; label: string }[] {
  const list = people.map(p => ({ id: p.id, label: p.name }));
  if (current.id && current.name && !list.some(p => p.id === current.id)) list.push({ id: current.id, label: current.name });
  return list.sort((a, b) => a.label.localeCompare(b.label));
}

export type CoveringChoice = { id: string; label: string; away: boolean };

/**
 * Who the shift panel offers for "Covering": people on leave on the shift's date first (approved, then requested,
 * labelled "on leave" / "leave requested", never the kind), then everyone else by name. The person working the
 * shift is left out; whoever it covers now stays in the list even if they've left the roster.
 */
export function coveringChoices(
  people: { id: string; name: string }[],
  leave: { workerId: string; status: 'requested' | 'approved'; startsOn: string; endsOn: string }[],
  localDate: string,
  current: { id: string | null; name: string | null },
  workingId: string | null,
): CoveringChoice[] {
  const away = new Map<string, 'approved' | 'requested'>();
  for (const l of leave) {
    if (l.startsOn > localDate || l.endsOn < localDate) continue;
    if (l.status === 'approved' || !away.has(l.workerId)) away.set(l.workerId, l.status);
  }
  const list = people.filter(p => p.id !== workingId);
  if (current.id && current.name && !list.some(p => p.id === current.id)) list.push({ id: current.id, name: current.name });
  const rank = (id: string) => away.get(id) === 'approved' ? 0 : away.get(id) === 'requested' ? 1 : 2;
  return list
    .map(p => ({ p, r: rank(p.id) }))
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .map(({ p, r }) => ({ id: p.id, label: r === 0 ? `${p.name} · on leave` : r === 1 ? `${p.name} · leave requested` : p.name, away: r < 2 }));
}

/** Adds n days to an ISO date (yyyy-mm-dd). */
export const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Add shifts: the last date of the run. Days ticked with no Until put the shifts on those days in the 7 days
 * from From (David, 29 Oct: ticking Fri used to be ignored and the shift landed on From). Undefined = one shift on From.
 */
export function addShiftsUntil(startDate: string | undefined, endDate: string | undefined, weekdays: number[]): string | undefined {
  if (endDate) return endDate;
  return weekdays.length && startDate ? addDaysIso(startDate, 6) : undefined;
}

/** "Fri 30 Oct" for an ISO date, for messages after adding shifts. */
export const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

/** The dates Add shifts will use: every date from From to Until on the ticked days (all days when none ticked). */
export function addShiftsDates(startDate: string, endDate: string | undefined, weekdays: number[]): string[] {
  const out: string[] = [];
  for (let d = startDate; d <= (endDate ?? startDate); d = addDaysIso(d, 1)) {
    const wd = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!endDate || endDate === startDate || !weekdays.length || weekdays.includes(wd)) out.push(d);
  }
  return out;
}

/** "on Fri 30 Oct" or "on 3 days, Mon 26 Oct to Fri 30 Oct". */
export function addShiftsWhen(dates: string[]): string {
  if (!dates.length) return '';
  if (dates.length === 1) return ` on ${shortDate(dates[0])}`;
  return ` on ${dates.length} days, ${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`;
}

/** What a card needs for its marker letters (David, 30 Oct). */
/** A request for a day from the app (migration 0080), as the roster gets it. */
export type DayRequest = { id: string; workerId: string; date: string; kind: string; atTime: string | null; note: string | null; status: string; line: string };

/**
 * Whether a shift goes against a request (keep in step with `breaksRequest` in apps/api/src/roster/day-requests.ts):
 * another part of the day than asked for, finishing after "finish by" (overnight always does), starting before "start after".
 */
export function breaksRequest(r: { kind: string; atTime: string | null }, localStart: string, localEnd: string): boolean {
  const h = Number(localStart.slice(0, 2));
  const period = h >= 5 && h < 12 ? 'am' : h >= 12 && h < 19 ? 'pm' : 'night';
  if (r.kind.startsWith('prefer_')) return r.kind !== `prefer_${period}`;
  if (r.kind === 'start_after') return !!r.atTime && localStart < r.atTime;
  if (r.kind === 'finish_by') return !!r.atTime && (localEnd <= localStart || localEnd > r.atTime);
  return false;
}

/** The person on a shift's requests for its date, each marked when the shift goes against it. */
export function requestsFor(s: { workerId?: string | null; localDate: string; localStart: string; localEnd: string }, all: DayRequest[]): (DayRequest & { breaks: boolean })[] {
  if (!s.workerId) return [];
  return all.filter(r => r.workerId === s.workerId && r.date === s.localDate).map(r => ({ ...r, breaks: breaksRequest(r, s.localStart, s.localEnd) }));
}

export type MarkerShift = TLineShift & {
  /** The person's requests that day (R), from `requestsFor`. */
  requests?: { line: string; breaks: boolean }[];
  genderRequested?: 'F' | 'M' | null; workerId?: string | null; workerName?: string | null; workerGender?: 'F' | 'M' | null;
  equipment?: { name: string; vehicle?: boolean }[]; itemCount?: number; duties?: { name: string }[];
};
export type Marker = { key: string; letter: string; title: string; cls: string };
const GENDER_WORD = { F: 'female', M: 'male' } as const;

/**
 * Letters beside the A/P/N letter so the rosterer sees a shift is more than labour (David, 30 Oct):
 * F/M = gender requested by whoever asked for the shift (marked when the person on it is recorded otherwise or not
 * at all), or the person's own gender when nothing was requested; V = vehicles booked, E = other equipment,
 * I = items given out or used, D = duties.
 */
export function shiftMarkers(s: MarkerShift, letters: MarkerLetters = DEFAULT_MARKER_LETTERS): Marker[] {
  const out: Marker[] = [];
  if (s.genderRequested) {
    const want = GENDER_WORD[s.genderRequested];
    const off = !!s.workerId && s.workerGender !== s.genderRequested;
    const who = s.workerName ?? 'The person on it';
    out.push({
      key: 'g', letter: s.genderRequested, cls: `mk-g ${s.genderRequested.toLowerCase()}${off ? ' warn' : ''}`,
      title: `${want[0].toUpperCase()}${want.slice(1)} worker requested${off ? (s.workerGender ? `; ${who} is recorded as ${GENDER_WORD[s.workerGender]}` : `; ${who}'s gender isn't recorded`) : ''}`,
    });
  } else if (s.workerId && s.workerGender) {
    out.push({ key: 'g', letter: s.workerGender, cls: `mk-g soft ${s.workerGender.toLowerCase()}`, title: `${s.workerName ?? 'The person on it'} is ${GENDER_WORD[s.workerGender]}` });
  }
  const vehicles = (s.equipment ?? []).filter(e => e.vehicle);
  const other = (s.equipment ?? []).filter(e => !e.vehicle);
  if (vehicles.length) out.push({ key: 'v', letter: letters.vehicle, cls: 'mk-v', title: `Vehicle: ${vehicles.map(e => e.name).join(', ')}` });
  if (other.length) out.push({ key: 'e', letter: letters.equipment, cls: 'mk-e', title: `Equipment: ${other.map(e => e.name).join(', ')}` });
  if (s.itemCount) out.push({ key: 'i', letter: letters.items, cls: 'mk-i', title: `${s.itemCount} ${s.itemCount === 1 ? 'item' : 'items'} given out or used` });
  if (s.duties?.length) out.push({ key: 'd', letter: letters.duty, cls: 'mk-d', title: `Duties: ${s.duties.map(d => d.name).join(', ')}` });
  // T = template (David, 3 Nov): who usually works it; marked when they're away that day.
  const t = tLines(s);
  if (t.length) out.push({ key: 't', letter: letters.template, cls: `mk-t${t.some(l => l.tone === 'away') ? ' warn' : ''}`, title: t.map(l => l.title).join('; ') });
  // R = request from the worker (David, 3 Nov): ringed when the shift doesn't fit it (a warning, never a block).
  if (s.requests?.length) {
    const off = s.requests.some(r => r.breaks);
    out.push({ key: 'r', letter: letters.request, cls: `mk-r${off ? ' warn' : ''}`, title: `Asked: ${s.requests.map(r => r.line).join('; ')}${off ? ' (this doesn\'t fit)' : ''}` });
  }
  return out;
}

/**
 * The strip's filters (David, 2 Nov): kept in the roster URL (`role`, `hours=left`, `team=1`) like the rest of the roster's
 * state, so they survive dropping someone onto a shift (the server action returns to `back`) and picking another shift.
 * `team` (projects, 4 Nov) shows only the site's team; it only applies when one site is chosen.
 */
export type StripFilter = { role: string; hoursLeft: boolean; team: boolean };
export function parseStripFilter(sp: { role?: string; hours?: string; team?: string }): StripFilter {
  const role = (sp.role ?? '').trim().slice(0, 100);
  return { role, hoursLeft: sp.hours === 'left', team: sp.team === '1' };
}

/** The current roster URL with new strip filters; everything else kept, old messages dropped. */
export function withStripFilter(current: string, f: StripFilter): string {
  const u = new URL(current.startsWith('/roster') ? current : '/roster', 'http://roster.local');
  if (f.role) u.searchParams.set('role', f.role); else u.searchParams.delete('role');
  if (f.hoursLeft) u.searchParams.set('hours', 'left'); else u.searchParams.delete('hours');
  if (f.team) u.searchParams.set('team', '1'); else u.searchParams.delete('team');
  u.searchParams.delete('done');
  u.searchParams.delete('error');
  return `${u.pathname}${u.search}`;
}

/** A site's team entry as `GET /facilities/:id/team?all=true` gives it (local dates; `to` null = no end). */
export type TeamEntry = { workerId: string; teamRole: string; from: string; to: string | null };

/**
 * Who is on the site's team at any time in the dates on screen (`from`..`to`, local dates), with their team role
 * (supervisor wins when someone has both entries in the period). People whose time on the team ended before, or
 * starts after, the period aren't on it for this roster.
 */
export function teamDuring(entries: TeamEntry[], from: string, to: string): Map<string, 'supervisor' | 'worker'> {
  const out = new Map<string, 'supervisor' | 'worker'>();
  for (const e of entries) {
    if (e.from > to || (e.to !== null && e.to < from)) continue;
    const role = e.teamRole === 'supervisor' ? 'supervisor' : 'worker';
    if (out.get(e.workerId) !== 'supervisor') out.set(e.workerId, role);
  }
  return out;
}

/** A shift picked for assigning several at once (David, 2 Nov): its local date and start time. */
export type PickedShift = { id: string; date: string; start: string };

/** Picked shifts in date order, each with a short label: "Fri 6 Nov", plus the start time when two share a day. */
export function pickedInOrder(picks: PickedShift[]): (PickedShift & { label: string })[] {
  const sorted = [...picks].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const perDay = new Map<string, number>();
  for (const p of sorted) perDay.set(p.date, (perDay.get(p.date) ?? 0) + 1);
  return sorted.map(p => ({ ...p, label: `${shortDate(p.date)}${(perDay.get(p.date) ?? 0) > 1 ? ` ${p.start}` : ''}` }));
}

/**
 * A reason worded for a list about one person: "Sol Oakley is already rostered …" → "already rostered …",
 * "Sol Oakley doesn't have the role Barista" → "doesn't have the role Barista". Anything else is kept as it is.
 */
export function reasonFor(name: string, message: string): string {
  const parts = message.split(/\.\s+/).map(m => m.trim().replace(/\.$/, '')).filter(Boolean);
  return parts.map(m => {
    if (!name || !m.startsWith(`${name} `)) return m;
    const rest = m.slice(name.length + 1);
    if (rest.startsWith('is ')) return rest.slice(3);
    return /^[a-z]/.test(rest) ? rest : m;
  }).join('; ');
}

export type AssignOutcome = { label: string; ok: boolean; message?: string };

/**
 * What the office is told after putting one person on several shifts: how many went on, then each one that didn't
 * and why (the API's own reason). Nothing assigned is an error; otherwise a success that lists the rest.
 */
export function multiAssignMessage(name: string, results: AssignOutcome[], count: (n: number) => string): { done?: string; error?: string } {
  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const notLine = failed.length ? `Not assigned: ${failed.map(r => `${r.label}${r.message ? ` (${reasonFor(name, r.message)})` : ''}`).join(', ')}.` : '';
  if (!ok) return { error: `${name} wasn't assigned. ${notLine}` };
  return { done: `Assigned ${name} to ${count(ok)}. Confirm once they have agreed.${notLine ? ` ${notLine}` : ''}` };
}

/** One shift's `GET /shifts/:id/candidates` row, as the right-click menu needs it. */
export type MenuCandidate = {
  workerId: string; name: string; weekHours: number; eligible: boolean; warnings: { message: string }[]; blocks: { message: string }[];
  siteHistory?: { shiftsHere: number; lastHere: string | null };
  /** Approximate straight-line km from their home postcode to the site (null = unknown). */
  distanceKm?: number | null;
};
/**
 * `here` is the person's past work at the site ("Worked here 3 times · last 22 Sep") and `distance` how far they live
 * from it ("12 km"; David, 4 Nov), both only when every shift is at one site; display only.
 */
export type BestPerson = {
  workerId: string; name: string; hours: number; canDo: number; of: number; note: string | null; blocked: boolean; here: string | null; knowsSite: boolean;
  distance: string | null;
};
/** For the past-work line: the business's date and its word for a site (lower case). */
export type HereWords = { today: string; site: string };

/**
 * The best people for one or more shifts (right-click on a card, David 2 Nov). For one shift this keeps the API's order
 * (ready first, then free, then fewest hours). For several, people who can do the most of them come first, then
 * the API's order on average. Up to `top` who can do at least one, then up to `blockedShown` who can do none, greyed.
 */
export function bestPeople(lists: MenuCandidate[][], top = 5, blockedShown = 3, here?: HereWords): BestPerson[] {
  const by = new Map<string, { c: MenuCandidate; canDo: number; rank: number; warn: string | null; block: string | null }>();
  for (const list of lists) {
    list.forEach((c, i) => {
      const e = by.get(c.workerId) ?? { c, canDo: 0, rank: 0, warn: null, block: null };
      e.rank += i;
      if (c.eligible) { e.canDo += 1; e.warn ??= c.warnings[0]?.message ?? null; } else e.block ??= c.blocks[0]?.message ?? null;
      by.set(c.workerId, e);
    });
  }
  const all = [...by.values()].sort((a, b) => b.canDo - a.canDo || a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const of = lists.length;
  const row = (e: (typeof all)[number]): BestPerson => ({
    workerId: e.c.workerId, name: e.c.name, hours: e.c.weekHours, canDo: e.canDo, of, blocked: e.canDo === 0,
    note: e.canDo === 0 ? (e.block ? reasonFor(e.c.name, e.block) : null)
      : e.canDo < of ? `can do ${e.canDo} of ${of}${e.block ? `; ${reasonFor(e.c.name, e.block)}` : ''}`
      : e.warn ? reasonFor(e.c.name, e.warn) : null,
    here: here ? hereLine(e.c.siteHistory, here.today, here.site) : null,
    knowsSite: !!here && (e.c.siteHistory?.shiftsHere ?? 0) > 0,
    distance: here ? distanceWords(e.c.distanceKm) : null,
  });
  return [...all.filter(e => e.canDo > 0).slice(0, top), ...all.filter(e => e.canDo === 0).slice(0, blockedShown)].map(row);
}

/** A cover gap as `GET /roster/cover-gaps` gives it ("02:00 next day" when it ends the day after). */
export type GapFacts = { facilityId: string; facilityName: string; typeName: string; localDate: string; localFrom: string; localTo: string; shiftId: string; title: string };
export type GapBar = { id: string; localStart: string; localEnd: string; shiftId: string; label: string; title: string };

/**
 * Cover gaps on one day of the timeline (Settings → Cover rules): gaps starting that day, and the part after
 * midnight of a gap that started the day before. Times are the site's local times, as on the shift bars.
 * `allSites` adds the site to the label when the roster shows every site.
 */
export function gapBars(gaps: GapFacts[], day: string, allSites: boolean): GapBar[] {
  const out: GapBar[] = [];
  for (const g of gaps) {
    const nextDay = g.localTo.endsWith('next day');
    const to = g.localTo.slice(0, 5);
    let localStart: string;
    if (g.localDate === day) localStart = g.localFrom;
    else if (nextDay && addDays(g.localDate, 1) === day && to !== '00:00') localStart = '00:00';
    else continue;
    const label = `No ${g.typeName}${allSites ? ` · ${g.facilityName}` : ''}`;
    out.push({
      id: `${g.facilityId}:${g.typeName}:${g.localDate}:${g.localFrom}`, localStart, localEnd: to, shiftId: g.shiftId, label,
      title: `${g.title}${allSites ? ` · ${g.facilityName}` : ''}`,
    });
  }
  return out;
}

/** How many cover gaps start on each day, for the week view's day headings. */
export function gapsByDay(gaps: { localDate: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of gaps) m.set(g.localDate, (m.get(g.localDate) ?? 0) + 1);
  return m;
}
