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
