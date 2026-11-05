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

/** A placed {shift} with its hours now (site local time) and shift type, to compare with its stage's hours. */
export interface TimedShift extends PlacedShift { role: string; startTime: string; endTime: string; breakMinutes: number; shiftCodeId: string | null }
/** The hours (and shift type) a stage's {shifts} should have. */
export interface WantedHours extends DayHours { shiftCodeId: string | null }
export interface Retime { id: string; date: string; role: string; hours: WantedHours; supervisor: boolean }
export interface RetimeSort { retime: Retime[]; kept: Record<KeptReason, number> }

const sameHours = (s: TimedShift, h: WantedHours, code: boolean) =>
  s.startTime === h.startTime && s.endTime === h.endTime && s.breakMinutes === h.breakMinutes && (!code || s.shiftCodeId === h.shiftCodeId);

/**
 * {Shifts} on their stage's working days whose hours (start, finish, break) or shift type differ from the stage's
 * (`stageHours`: stage id → its hours now), and supervisor {shifts} whose hours differ from that day's
 * (`supervisorHours`, from `supervisorDays`; a supervisor {shift} never has a shift type). Each gets the new hours
 * unless it has started, has an agency's person on it, or its week is published, like `shiftsOutside`. {Shifts} off
 * their stage's days are `shiftsOutside`'s, and stages not in `stageHours` are ignored.
 */
export function shiftsToRetime(shifts: TimedShift[], stageHours: Map<string, WantedHours>, stageDays: Map<string, Set<string>>,
  supervisorHours: Map<string, DayHours>, supervisorToo = true): RetimeSort {
  const out: RetimeSort = { retime: [], kept: { started: 0, agency: 0, published: 0 } };
  for (const s of shifts) {
    let want: WantedHours | undefined;
    if (s.supervisor) {
      const h = supervisorToo ? supervisorHours.get(s.date) : undefined;
      want = h ? { ...h, shiftCodeId: null } : undefined;
    } else if (s.stageId !== null && stageDays.get(s.stageId)?.has(s.date)) want = stageHours.get(s.stageId);
    if (!want || sameHours(s, want, !s.supervisor)) continue;
    if (s.started) out.kept.started++;
    else if (s.agency) out.kept.agency++;
    else if (s.published) out.kept.published++;
    else out.retime.push({ id: s.id, date: s.date, role: s.role, hours: want, supervisor: s.supervisor });
  }
  return out;
}

/** A {shift} whose person couldn't do the new hours (taken off, left open) or whose equipment couldn't (kept at the old hours). */
export interface HoursProblem { date: string; startTime: string; role: string; workerName: string | null; reason: string }

export interface MoveResult {
  cancelled: number; kept: Record<KeptReason, number>; roster: RosterResult | null;
  /** {Shifts} given the stage's new hours; those left at the old hours (`retimeKept`); people taken off because they couldn't work them; equipment that kept a {shift} at its old hours. */
  retimed: number; retimeKept: Record<KeptReason, number>; takenOff: HoursProblem[]; equipmentKept: HoursProblem[];
}

export const noRetime = () => ({ retimed: 0, retimeKept: { started: 0, agency: 0, published: 0 }, takenOff: [] as HoursProblem[], equipmentKept: [] as HoursProblem[] });

const keptWords = (k: Record<KeptReason, number>, w: Words) => {
  const out: string[] = [];
  if (k.published) out.push(`${k.published} in published weeks (change ${k.published === 1 ? 'it' : 'them'} on the roster, so people are told)`);
  if (k.agency) out.push(`${k.agency} with ${w.a(T.agency)}’s person on ${k.agency === 1 ? 'it' : 'them'}`);
  if (k.started) out.push(`${k.started} already started`);
  return out;
};

/** One plain line about moving a stage's {shifts} to its dates (or taking them off with the stage). */
export function moveSummary(r: MoveResult, w: Words = DEFAULT_WORDS, removed = false): string {
  const parts: string[] = [];
  if (r.cancelled) parts.push(`Took ${w.count(r.cancelled, T.shift)} off the Draft roster${removed ? '' : ' (no longer on the stage’s working days)'}.`);
  if (r.retimed) parts.push(`Changed ${w.count(r.retimed, T.shift)} to the stage’s hours.`);
  if (r.takenOff.length) {
    const n = r.takenOff.length;
    parts.push(`${n === 1 ? '1 person' : `${n} people`} couldn’t work the new hours, so ${n === 1 ? 'that' : 'those'} ${w.lower(T.shift, n !== 1)} ${n === 1 ? 'is' : 'are'} open again.`);
  }
  if (r.equipmentKept.length) parts.push(`${w.count(r.equipmentKept.length, T.shift)} kept the old hours because the ${w.lower(T.equipment)} on ${r.equipmentKept.length === 1 ? 'it' : 'them'} can’t be used at the new ones.`);
  if (r.roster && (r.roster.created || r.roster.supervisorCreated)) parts.push(rosterSummary(r.roster, w));
  const kept = keptWords(r.kept, w);
  if (kept.length) parts.push(`Left where they are: ${kept.join('; ')}.`);
  const keptHours = keptWords(r.retimeKept, w);
  if (keptHours.length) parts.push(`Left at the old hours: ${keptHours.join('; ')}.`);
  if (!parts.length) parts.push(`Every ${w.lower(T.shift)} is already on the stage’s dates and hours.`);
  return parts.join(' ');
}

/**
 * Copying a project's stages to another project (stage templates, 5 Nov): each stage starts the same number of days
 * after the first stage as it did in the source, moved on to its first working day when that date isn't one, and
 * keeps its number of working days (so a 4-day demolition is still 4 working days however the weekdays fall).
 */
export function copyStageDates(s: { startsOn: string; endsOn: string; weekdays: readonly number[] }, by: number): { startsOn: string; endsOn: string } {
  const n = workingDays(s.startsOn, s.endsOn, s.weekdays).length;
  let start = addDays(s.startsOn, by);
  if (!n) return { startsOn: start, endsOn: addDays(s.endsOn, by) };
  while (!s.weekdays.includes(isoWeekday(start))) start = addDays(start, 1);
  let end = start;
  for (let count = 1; count < n;) {
    end = addDays(end, 1);
    if (s.weekdays.includes(isoWeekday(end))) count++;
  }
  return { startsOn: start, endsOn: end };
}

/** How far the stages move: from the source's first stage to the chosen first day. */
export function copyOffset(stages: { startsOn: string }[], firstDay: string): number {
  if (!stages.length) return 0;
  return daysBetween(stages.reduce((m, s) => (s.startsOn < m ? s.startsOn : m), stages[0].startsOn), firstDay);
}

export interface CopyResult {
  copied: number;
  people: number;
  peopleLeftOff: { name: string; stage: string; reason: string }[];
  items: number;
  itemsLeftOff: { name: string; stage: string }[];
  areasAdded: string[];
  areasMissing: string[];
  /** Stages whose site-only shift type couldn't come with them, so they keep its hours instead. */
  hoursInstead: number;
  equipment: number;
}

/** "Copied 3 stages from Beach Hut, the first starting Mon 16 Nov. 5 people named, 1 left off: …". */
export function copySummary(r: CopyResult, from: string, firstDay: string, w: Words = DEFAULT_WORDS): string {
  if (!r.copied) return `${from} has no stages to copy.`;
  const parts = [`Copied ${r.copied === 1 ? '1 stage' : `${r.copied} stages`} from ${from}, the first starting ${fmtDate(firstDay)}.`];
  if (r.people || r.peopleLeftOff.length) {
    const left = r.peopleLeftOff.map(p => `${p.name} (${p.reason})`).join(', ');
    parts.push(`${r.people === 1 ? '1 person' : `${r.people} people`} named${left ? `; left off: ${left}` : ''}.`);
  }
  if (r.items || r.itemsLeftOff.length) {
    const left = [...new Set(r.itemsLeftOff.map(i => i.name))].join(', ');
    parts.push(`${r.items === 1 ? '1 planned item' : `${r.items} planned items`}${left ? `; no longer in use: ${left}` : ''}.`);
  }
  if (r.areasAdded.length) parts.push(`Added ${r.areasAdded.length === 1 ? w.lower(T.area) : w.lower(T.area, true)}: ${r.areasAdded.join(', ')}.`);
  if (r.areasMissing.length) parts.push(`Not ${w.a(T.area)} of this ${w.lower(T.project)}, so left without one: ${r.areasMissing.join(', ')}.`);
  if (r.hoursInstead) parts.push(`${r.hoursInstead === 1 ? '1 stage keeps' : `${r.hoursInstead} stages keep`} the hours of a shift type that belongs to the other ${w.lower(T.site)}.`);
  if (r.equipment) parts.push(`${w.one(T.equipment)} isn't copied: book it for each stage.`);
  parts.push(`Nothing is rostered until you press Roster.`);
  return parts.join(' ');
}
