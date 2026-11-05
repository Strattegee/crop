/**
 * Project stages (David, 5 Nov 2026; part 3 of docs/decisions/2026-11-05-teams-and-stages.md; migration 0093). A
 * project runs in stages (e.g. demolition 4 days, build 9 days, clean 2 days), each with its dates, working days
 * (Monday to Friday unless the weekend is ticked), usual hours and its own copy of a standing team. Pure rules here,
 * tested in test/project-stages.spec.ts; the database steps are in stages.controller.ts.
 */
import { fmtDate } from '../roster/eligibility.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5] as const;
/** Most days one stage can run (a long job is several stages). */
export const MAX_STAGE_DAYS = 366;
/** Most shifts made by one "Roster" press. */
export const MAX_ROSTER_SHIFTS = 1500;

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Working days from a request (`weekdays: [1..7]`); null when missing (= keep / default), or a plain problem. */
export function parseWeekdays(v: unknown): number[] | null | { problem: string } {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some(d => !Number.isInteger(d) || d < 1 || d > 7)) return { problem: 'Working days must be weekdays, 1 (Monday) to 7 (Sunday)' };
  const days = [...new Set(v as number[])].sort((a, b) => a - b);
  if (!days.length) return { problem: 'Tick at least one working day' };
  return days;
}

/** "Mon–Fri", "Mon–Sat", "Every day", "Mon, Wed, Fri". */
export function weekdaysLine(days: readonly number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (run) return `${DAY_SHORT[d[0] - 1]}–${DAY_SHORT[d[d.length - 1] - 1]}`;
  return d.map(x => DAY_SHORT[x - 1]).join(', ');
}

/** The working dates of a stage: every date from `from` to `to` (inclusive) on one of its weekdays. */
export function workingDays(from: string, to: string, weekdays: readonly number[]): string[] {
  const out: string[] = [];
  if (to < from) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out;
}

export interface StageDates { id: string; name: string; startsOn: string; endsOn: string }

/** Why a stage's details can't be saved, or null. */
export function stageProblem(s: { name: string | null; startsOn: string | null; endsOn: string | null; weekdays: readonly number[];
  startTime: string | null; endTime: string | null; shiftCodeId: string | null }): string | null {
  if (!s.name?.trim()) return 'Give the stage a name';
  if (!s.startsOn || !s.endsOn) return 'Choose the stage’s first and last day';
  if (s.endsOn < s.startsOn) return 'The last day is before the first day';
  if (daysBetween(s.startsOn, s.endsOn) >= MAX_STAGE_DAYS) return `A stage can run up to ${MAX_STAGE_DAYS} days; split a longer one into stages`;
  if (!s.shiftCodeId && (!s.startTime || !s.endTime)) return 'Choose a shift type, or enter the usual start and finish times';
  if (!s.shiftCodeId && s.startTime === s.endTime) return 'Start and finish times must be different';
  if (!workingDays(s.startsOn, s.endsOn, s.weekdays).length) return 'None of those dates is a working day of the stage';
  return null;
}

/** For each stage, the names of the other stages it shares a day with (overlaps are allowed, just shown). */
export function stageOverlaps(stages: StageDates[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of stages) {
    out.set(a.id, stages.filter(b => b.id !== a.id && b.startsOn <= a.endsOn && a.startsOn <= b.endsOn).map(b => b.name));
  }
  return out;
}

/**
 * "Move later stages too": when a stage's last day moves from `oldEnd` to `newEnd`, every other stage that started
 * after the old last day moves by the same number of days (only when asked; never automatic). Returns the new dates.
 */
export function moveLaterStages(stages: StageDates[], stageId: string, oldEnd: string, newEnd: string): StageDates[] {
  const by = daysBetween(oldEnd, newEnd);
  if (by === 0) return [];
  return stages.filter(s => s.id !== stageId && s.startsOn > oldEnd)
    .map(s => ({ ...s, startsOn: addDays(s.startsOn, by), endsOn: addDays(s.endsOn, by) }));
}

/** The stage's make-up line and its named people. */
export interface MakeUp { role: string; count: number }
export interface StagePerson { workerId: string; name: string; role: string; active: boolean }

/** One place to fill each working day: a role, and the person normally in it (null = a gap). */
export interface Slot { role: string; workerId: string | null; workerName: string | null }

/**
 * The places to roster each working day: every named person who is still active (in their role), then the gaps of
 * the make-up (places nobody named fills, e.g. "Short: 1 Painter") as open places in that role.
 */
export function planSlots(makeUp: MakeUp[], people: StagePerson[]): Slot[] {
  const live = people.filter(p => p.active);
  const order = (role: string) => { const i = makeUp.findIndex(m => m.role === role); return i < 0 ? makeUp.length : i; };
  const named: Slot[] = [...live].sort((a, b) => order(a.role) - order(b.role) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
    .map(p => ({ role: p.role, workerId: p.workerId, workerName: p.name }));
  const gaps: Slot[] = [];
  for (const m of makeUp) {
    const short = m.count - live.filter(p => p.role === m.role).length;
    for (let i = 0; i < short; i++) gaps.push({ role: m.role, workerId: null, workerName: null });
  }
  return [...named, ...gaps];
}

/** Places nobody named fills, per role: "Short: 1 Painter, 2 Cleaner" (null when none). */
export function stageShortLine(makeUp: MakeUp[], people: StagePerson[]): string | null {
  const parts = makeUp.map(m => ({ role: m.role, n: m.count - people.filter(p => p.active && p.role === m.role).length }))
    .filter(x => x.n > 0).map(x => `${x.n} ${x.role}`);
  return parts.length ? `Short: ${parts.join(', ')}` : null;
}

/** A shift already made for the stage on a date: its role and usual person. */
export interface Existing { role: string; usualWorkerId: string | null }

/**
 * What still needs creating on one date, so pressing "Roster" again never doubles anything. A planned place is
 * already rostered when a shift of the stage that day has the same usual person; else (a person or a gap) when one
 * in the same role is left over (e.g. a gap made earlier and since named, or a person swapped in the same role).
 */
export function toCreate(planned: Slot[], existing: Existing[]): { create: Slot[]; already: number } {
  const left = [...existing];
  const take = (i: number) => left.splice(i, 1);
  const rest: Slot[] = [];
  let already = 0;
  for (const p of planned) {
    const i = p.workerId ? left.findIndex(e => e.usualWorkerId === p.workerId) : -1;
    if (i >= 0) { take(i); already++; } else rest.push(p);
  }
  const create: Slot[] = [];
  // Prefer a leftover shift with nobody usual for a person, then any in the role.
  for (const p of rest) {
    let i = left.findIndex(e => e.role === p.role && e.usualWorkerId === null);
    if (i < 0) i = left.findIndex(e => e.role === p.role);
    if (i >= 0) { take(i); already++; } else create.push(p);
  }
  return { create, already };
}

/** A stage's hours (from its own times, or its shift type's). */
export interface StageHours { startsOn: string; endsOn: string; weekdays: readonly number[]; startTime: string; endTime: string; breakMinutes: number }
export interface DayHours { startTime: string; endTime: string; breakMinutes: number }

/**
 * The project supervisor's day: one shift on every working day of any stage (never two when stages overlap),
 * from the earliest start to the latest finish of the stages working that day (an overnight stage's finish wins).
 */
export function supervisorDays(stages: StageHours[]): Map<string, DayHours> {
  const out = new Map<string, DayHours & { overnight: boolean }>();
  for (const s of stages) {
    const overnight = s.endTime < s.startTime;
    for (const d of workingDays(s.startsOn, s.endsOn, s.weekdays)) {
      const cur = out.get(d);
      if (!cur) { out.set(d, { startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, overnight }); continue; }
      const startTime = s.startTime < cur.startTime ? s.startTime : cur.startTime;
      const endTime = cur.overnight ? (overnight && s.endTime > cur.endTime ? s.endTime : cur.endTime)
        : overnight ? s.endTime : (s.endTime > cur.endTime ? s.endTime : cur.endTime);
      out.set(d, { startTime, endTime, breakMinutes: Math.max(cur.breakMinutes, s.breakMinutes), overnight: cur.overnight || overnight });
    }
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)).map(([d, { overnight: _, ...h }]) => [d, h]));
}

/** The role the supervisor is rostered in: one of theirs that says supervisor, else their first role, else "Supervisor". */
export function supervisorRole(roles: readonly string[]): string {
  return roles.find(r => /supervis/i.test(r)) ?? roles[0] ?? 'Supervisor';
}

/** A place left open, with the first reason (never the leave kind: reasons come from eligibility). */
export interface LeftOpen { date: string; startTime: string; role: string; workerName: string | null; reason: string }

export interface RosterResult {
  created: number; assigned: number; alreadyRostered: number; pastDays: number;
  leftOpen: LeftOpen[]; supervisorCreated: number; supervisorAssigned: number;
}

export const emptyResult = (): RosterResult => ({ created: 0, assigned: 0, alreadyRostered: 0, pastDays: 0, leftOpen: [], supervisorCreated: 0, supervisorAssigned: 0 });

/** The reason for a gap: nobody is named in that place. */
export const GAP_REASON = 'Nobody named for this place';

/** One plain line about a "Roster" press, in the business's words. */
export function rosterSummary(r: RosterResult, w: Words = DEFAULT_WORDS): string {
  const parts: string[] = [];
  const made = r.created + r.supervisorCreated;
  if (made) {
    const open = made - r.assigned - r.supervisorAssigned;
    parts.push(`Created ${w.count(made, T.shift)}: ${r.assigned + r.supervisorAssigned} with their person${open ? `, ${open} left open` : ''}.`);
  } else parts.push(`No new ${w.lower(T.shift, true)} needed.`);
  if (r.alreadyRostered) parts.push(`${w.count(r.alreadyRostered, T.shift)} already rostered.`);
  if (r.pastDays) parts.push(`${r.pastDays === 1 ? '1 day' : `${r.pastDays} days`} already past left alone.`);
  if (made) parts.push(`They are in the Draft roster: nobody is told until you publish.`);
  return parts.join(' ');
}

/** "Mon 9 Nov – Thu 12 Nov · Mon–Fri · 4 working days". */
export function stageLine(s: { startsOn: string; endsOn: string; weekdays: readonly number[] }): string {
  const n = workingDays(s.startsOn, s.endsOn, s.weekdays).length;
  const dates = s.startsOn === s.endsOn ? fmtDate(s.startsOn) : `${fmtDate(s.startsOn)} – ${fmtDate(s.endsOn)}`;
  return `${dates} · ${weekdaysLine(s.weekdays)} · ${n === 1 ? '1 working day' : `${n} working days`}`;
}

/** A {shift} a stage's "Roster" made (or the supervisor's), with what decides whether it can be moved. */
export interface PlacedShift { id: string; stageId: string | null; supervisor: boolean; date: string; started: boolean; published: boolean; agency: boolean }
/** Why a {shift} off the stage's days is left where it is. */
export type KeptReason = 'started' | 'agency' | 'published';
export interface OutsideSort { cancel: string[]; kept: Record<KeptReason, number> }

/**
 * {Shifts} no longer on a working day of their stage (`stageDays`: stage id → its working dates; a stage taken off
 * has none), and supervisor {shifts} on no stage's working day (`supervisorDates`). Each is taken off (cancelled)
 * unless it has started, has an agency's person on it (another business is involved), or its week is published
 * (people have been told: the office changes those on the roster). {Shifts} of stages not in `stageDays` are ignored.
 */
export function shiftsOutside(shifts: PlacedShift[], stageDays: Map<string, Set<string>>, supervisorDates: Set<string>): OutsideSort {
  const out: OutsideSort = { cancel: [], kept: { started: 0, agency: 0, published: 0 } };
  for (const s of shifts) {
    const outside = s.supervisor ? !supervisorDates.has(s.date)
      : s.stageId !== null && stageDays.has(s.stageId) && !stageDays.get(s.stageId)!.has(s.date);
    if (!outside) continue;
    if (s.started) out.kept.started++;
    else if (s.agency) out.kept.agency++;
    else if (s.published) out.kept.published++;
    else out.cancel.push(s.id);
  }
  return out;
}

/** The reasons given when {shifts} come off with their stage. */
export const STAGE_MOVED_REASON = 'Stage dates changed';
export const STAGE_REMOVED_REASON = 'Stage taken off';

export interface MoveResult { cancelled: number; kept: Record<KeptReason, number>; roster: RosterResult | null }

/** One plain line about moving a stage's {shifts} to its dates (or taking them off with the stage). */
export function moveSummary(r: MoveResult, w: Words = DEFAULT_WORDS, removed = false): string {
  const parts: string[] = [];
  if (r.cancelled) parts.push(`Took ${w.count(r.cancelled, T.shift)} off the Draft roster${removed ? '' : ' (no longer on the stage’s working days)'}.`);
  if (r.roster && (r.roster.created || r.roster.supervisorCreated)) parts.push(rosterSummary(r.roster, w));
  const kept: string[] = [];
  if (r.kept.published) kept.push(`${r.kept.published} in published weeks (change ${r.kept.published === 1 ? 'it' : 'them'} on the roster, so people are told)`);
  if (r.kept.agency) kept.push(`${r.kept.agency} with ${w.a(T.agency)}’s person on ${r.kept.agency === 1 ? 'it' : 'them'}`);
  if (r.kept.started) kept.push(`${r.kept.started} already started`);
  if (kept.length) parts.push(`Left where they are: ${kept.join('; ')}.`);
  if (!parts.length) parts.push(`Every ${w.lower(T.shift)} is already on the stage’s dates.`);
  return parts.join(' ');
}
