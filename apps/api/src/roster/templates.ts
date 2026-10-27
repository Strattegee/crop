import { addDays } from '../workforce/compliance.js';

/**
 * Roster templates and copying a week (backlog item 2, Steve's "ideal week"; migration 0023).
 * A slot is one shift of a usual week: the weekday and local times, so it lands on the same local
 * times in any week, whatever daylight saving is doing.
 */
export interface Slot {
  weekday: number; // ISO: 1 = Monday … 7 = Sunday
  startTime: string; // HH:MM, local to the site
  endTime: string; // earlier than startTime means it finishes the next day
  breakMinutes: number;
  areaId: string | null;
  shiftCodeId: string | null;
  role: string;
  needsPerson: boolean;
  workerId: string | null;
  notes: string | null;
  /** Equipment usually booked on this shift. */
  equipmentIds: string[];
  /** Duties the shift carries (migration 0029); they always go with it, before anyone is put on. */
  dutyIds?: string[];
}

export interface PlannedShift extends Slot {
  date: string; // the local date the shift starts
  overnight: boolean;
}

/** Where each slot falls in the week starting `weekStart` (a Monday), in day and time order. */
export function planWeek(slots: Slot[], weekStart: string): PlannedShift[] {
  return slots
    .map(s => ({ ...s, date: addDays(weekStart, s.weekday - 1), overnight: s.endTime < s.startTime }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.role.localeCompare(b.role));
}

/** A shift left open because its usual person couldn't be put on it, and why (plain words, never credential details). */
export interface LeftOpen { date: string; startTime: string; role: string; workerName: string; reason: string }

/** Equipment that couldn't be booked again, and why (plain words). */
export interface EquipmentLeftOff { date: string; startTime: string; role: string; equipmentName: string; reason: string }

export interface ApplyResult { created: number; assigned: number; leftOpen: LeftOpen[]; equipmentBooked: number; equipmentLeftOff: EquipmentLeftOff[] }

const list = (reasons: string[]) => reasons.slice(0, 5).join('; ') + (reasons.length > 5 ? `; and ${reasons.length - 5} more` : '');

/** The office's confirmation after applying a template or copying a week. */
export function applySummary(r: ApplyResult): string {
  if (!r.created) return 'There were no shifts to add.';
  const shifts = `${r.created} ${r.created === 1 ? 'shift' : 'shifts'} added`;
  const people = r.assigned ? `, ${r.assigned} with their usual person (waiting for them to confirm)` : '';
  const open = r.leftOpen.length
    ? `. ${r.leftOpen.length} left open because the usual person can't work ${r.leftOpen.length === 1 ? 'it' : 'them'}: ${list(r.leftOpen.map(o => o.reason))}`
    : '';
  const booked = r.equipmentBooked ? `. ${r.equipmentBooked} equipment ${r.equipmentBooked === 1 ? 'booking' : 'bookings'} made` : '';
  const off = r.equipmentLeftOff.length
    ? `. ${r.equipmentLeftOff.length} equipment ${r.equipmentLeftOff.length === 1 ? 'booking' : 'bookings'} left off: ${list(r.equipmentLeftOff.map(o => o.reason))}`
    : '';
  return `${shifts}${people}${open}${booked}${off}.`;
}

/**
 * Why someone can't go on a shift, in plain words for the summary. Takes the first block's message,
 * which eligibility already writes with the person's name and without credential numbers or leave kinds.
 */
export function firstReason(blocks: { message: string }[]): string {
  const m = blocks[0]?.message ?? 'not eligible';
  return m.replace(/\.$/, '');
}

/** The most weeks copied in one go (a month is four or five). */
export const MAX_COPY_WEEKS = 6;

/**
 * Pairs each source week with the week it is copied into, for copying a run of weeks (e.g. a month).
 * Source week i (from `fromWeek`) goes to `toWeek` + i weeks. Both must be Mondays. Returns the reason in
 * plain words when the two runs overlap, since copying a week onto itself or onto a week still to be copied
 * would double shifts.
 */
export function weekPairs(fromWeek: string, weeks: number, toWeek: string): { pairs: Array<{ from: string; to: string }> } | { error: string } {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_COPY_WEEKS) return { error: `Choose from 1 to ${MAX_COPY_WEEKS} weeks to copy` };
  const pairs = Array.from({ length: weeks }, (_, i) => ({ from: addDays(fromWeek, 7 * i), to: addDays(toWeek, 7 * i) }));
  const sources = new Set(pairs.map(p => p.from));
  if (pairs.some(p => sources.has(p.to))) {
    return { error: 'The weeks you are copying into overlap the weeks you are copying from. Choose a later start.' };
  }
  return { pairs };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14 Jun" (written out, as Intl spells some short months in full). */
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** The office's confirmation after copying several weeks: the totals, then the same detail as a single week. */
export function copyWeeksSummary(r: ApplyResult & { weeks: Array<{ from: string; to: string; created: number }>; emptyWeeks: string[] }): string {
  const copied = r.weeks.filter(w => w.created > 0);
  if (!copied.length) return 'There were no shifts to add.';
  const span = copied.length === 1 ? `the week of ${dm(copied[0].to)}` : `${copied.length} weeks, from the week of ${dm(copied[0].to)} to the week of ${dm(copied[copied.length - 1].to)}`;
  const empty = r.emptyWeeks.length
    ? ` ${r.emptyWeeks.length === 1 ? 'The week of' : 'The weeks of'} ${r.emptyWeeks.map(dm).join(', ')} had no shifts, so nothing was copied from ${r.emptyWeeks.length === 1 ? 'it' : 'them'}.`
    : '';
  return `Copied into ${span}. ${applySummary(r)}${empty}`;
}
