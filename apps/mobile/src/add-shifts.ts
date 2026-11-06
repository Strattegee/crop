/**
 * Pure helpers for adding shifts from the phone in manager mode (backlog item 9a, 7 Nov; tested in
 * test/add-shifts.spec.ts). The screen posts to `POST /shifts` exactly as the web's Add shifts does, so every
 * rule (the after-publishing rule, shift types, duties) is the API's; these only shape the form and the body.
 */
import { addDays, dayLabel } from './format';
import { weekDates } from './roster';

/** A row from GET /facilities (only what the form needs). */
export interface SiteRow { id: string; name: string; active: boolean; kind?: 'site' | 'project' | null; clientName?: string | null }
/** An area from GET /facilities/:id. */
export interface AreaRow { id: string; name: string; active: boolean }
/** A row from GET /shift-codes?facilityId= (business-wide or this site's). */
export interface ShiftCodeRow { id: string; code: string; name: string; letter: string | null; startTime: string; endTime: string; breakMinutes: number; active: boolean }
/** A row from GET /roles. */
export interface RoleRow { name: string; active: boolean }

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** The week's days for the day chips, with the ones already gone (before the business's today) marked. */
export function addableDays(weekStart: string, today?: string): { date: string; past: boolean }[] {
  return weekDates(weekStart).map(date => ({ date, past: Boolean(today && date < today) }));
}

/** The days ticked when the form opens: the day on screen if it's still to come, else the week's first day still to come. */
export function defaultDays(weekStart: string, day: string | 'week', today?: string): string[] {
  const open = addableDays(weekStart, today).filter(d => !d.past).map(d => d.date);
  if (day !== 'week' && open.includes(day)) return [day];
  return open.length ? [open[0]] : [];
}

/** Ticks or unticks a day, keeping them in date order. */
export function toggleDay(days: string[], date: string): string[] {
  return days.includes(date) ? days.filter(d => d !== date) : [...days, date].sort();
}

/** Sites to choose from: active ones, sites first then projects (named "Name · Client" like the web's picker), by name. */
export function siteChoices(rows: SiteRow[]): { id: string; label: string }[] {
  return rows
    .filter(r => r.active)
    .sort((a, b) => Number(a.kind === 'project') - Number(b.kind === 'project') || a.name.localeCompare(b.name))
    .map(r => ({ id: r.id, label: r.kind === 'project' && r.clientName ? `${r.name} · ${r.clientName}` : r.name }));
}

/** The site to start on: the roster's site, else the only one there is, else none chosen yet. */
export function defaultSite(sites: { id: string }[], rosterSite: string | null): string | null {
  if (rosterSite && sites.some(s => s.id === rosterSite)) return rosterSite;
  return sites.length === 1 ? sites[0].id : null;
}

/** Roles to choose from: active ones, each name once, as the API orders them. */
export function roleChoices(rows: RoleRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const k = r.name.trim().toLowerCase();
    if (!r.active || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(r.name);
  }
  return out;
}

/** "A · Morning · 07:00–15:30" for a shift type chip. */
export function codeLabel(c: ShiftCodeRow): string {
  return `${c.letter ? `${c.letter} · ` : ''}${c.name || c.code} · ${c.startTime}–${c.endTime}`;
}

/** Active shift types for the chosen site. */
export function codeChoices(rows: ShiftCodeRow[]): ShiftCodeRow[] {
  return rows.filter(c => c.active);
}

/**
 * Reads a time as typed on a phone keypad: "7" → 07:00, "730" / "7.30" / "7:30" → 07:30, "1530" → 15:30.
 * Null when it isn't a time.
 */
export function tidyTime(input: string): string | null {
  const s = input.trim().replace(/[.\s]/g, ':');
  let h: number;
  let m: number;
  let x: RegExpMatchArray | null;
  if ((x = s.match(/^(\d{1,2}):(\d{2})$/))) { h = +x[1]; m = +x[2]; }
  else if ((x = s.match(/^(\d{1,2})$/))) { h = +x[1]; m = 0; }
  else if ((x = s.match(/^(\d{1,2})(\d{2})$/))) { h = +x[1]; m = +x[2]; }
  else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Paid hours for the times (overnight when the end is before the start), e.g. 7.5. Null when a time is missing or they're the same. */
export function hoursFor(start: string | null, end: string | null, breakMinutes: number): number | null {
  if (!start || !end || start === end) return null;
  const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
  let span = mins(end) - mins(start);
  if (span < 0) span += 24 * 60;
  return Math.max(0, Math.round(((span - breakMinutes) / 60) * 100) / 100);
}

/** "7.5 h", plus "overnight" when it runs past midnight. */
export function hoursLine(start: string | null, end: string | null, breakMinutes: number): string | null {
  const h = hoursFor(start, end, breakMinutes);
  if (h === null) return null;
  return `${h} h${end! < start! ? ' · overnight' : ''}`;
}

export interface AddForm {
  facilityId: string | null;
  areaId: string | null;
  /** A shift type, or null for times typed in. */
  shiftCodeId: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  role: string;
  days: string[];
  quantity: number;
  notes: string;
}

type Words = { lower: string; lowerMany: string };

/**
 * The body for `POST /shifts`, or the first thing to fix in the app's words. The days are inside one week, so
 * the first and last day plus their weekdays name exactly the days ticked.
 */
export function addShiftsBody(f: AddForm, word: Words, site: { lower: string }): { body: Record<string, unknown> } | { problem: string } {
  if (!f.facilityId) return { problem: `Choose a ${site.lower}.` };
  const role = f.role.trim();
  if (!role) return { problem: 'Choose a role.' };
  if (!f.days.length) return { problem: 'Tick at least one day.' };
  const days = [...f.days].sort();
  const body: Record<string, unknown> = {
    facilityId: f.facilityId, role, quantity: f.quantity, startDate: days[0], endDate: days[days.length - 1],
    weekdays: [...new Set(days.map(isoWeekday))],
  };
  if (f.areaId) body.areaId = f.areaId;
  if (f.shiftCodeId) body.shiftCodeId = f.shiftCodeId;
  else {
    const start = tidyTime(f.startTime);
    const end = tidyTime(f.endTime);
    if (!start) return { problem: 'Enter a start time, like 7:00 or 1530.' };
    if (!end) return { problem: 'Enter a finish time, like 15:30.' };
    if (start === end) return { problem: 'The start and finish times must be different.' };
    const brk = f.breakMinutes.trim() === '' ? 0 : Number(f.breakMinutes);
    if (!Number.isInteger(brk) || brk < 0 || brk > 240) return { problem: 'Enter the break in minutes, 0 to 240.' };
    if ((hoursFor(start, end, brk) ?? 0) <= 0) return { problem: `The break is as long as the ${word.lower}.` };
    Object.assign(body, { startTime: start, endTime: end, breakMinutes: brk });
  }
  const notes = f.notes.trim();
  if (notes) body.notes = notes.slice(0, 1000);
  return { body };
}

/** How many shifts the form will add: days × how many each day. */
export function addCount(f: Pick<AddForm, 'days' | 'quantity'>): number {
  return f.days.length * f.quantity;
}

/** The button: "Add 3 shifts". */
export function addLabel(n: number, word: Words): string {
  return n ? `Add ${n} ${n === 1 ? word.lower : word.lowerMany}` : `Add ${word.lowerMany}`;
}

/** "Mon 9 Nov", "Mon 9 and Tue 10 Nov", "Mon 9, Tue 10 and Wed 11 Nov" (the month once when they share it). */
export function daysLine(days: string[]): string {
  const sorted = [...days].sort();
  const labels = sorted.map(d => dayLabel(d));
  const sameMonth = sorted.length > 1 && sorted.every(d => d.slice(0, 7) === sorted[0].slice(0, 7));
  const parts = sameMonth ? labels.map((l, i) => (i < labels.length - 1 ? l.split(' ').slice(0, 2).join(' ') : l)) : labels;
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The message after adding: "Added 3 shifts: Mon 9, Tue 10 and Wed 11 Nov. They're open; fill them from the roster." */
export function addedMessage(created: number, days: string[], word: Words): string {
  const what = `${created} ${created === 1 ? word.lower : word.lowerMany}`;
  return `Added ${what}: ${daysLine(days)}. ${created === 1 ? "It's" : "They're"} open; fill ${created === 1 ? 'it' : 'them'} from the roster.`;
}

/** A week entirely over can't take new shifts from the phone (the web's Add shifts starts from today too). */
export function weekIsOver(weekStart: string, today?: string): boolean {
  return Boolean(today && addDays(weekStart, 6) < today);
}
