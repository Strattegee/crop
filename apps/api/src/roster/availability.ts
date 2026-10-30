/**
 * Availability and leave rules (backlog item 10). Pure functions: no database access.
 *
 * - A shift belongs to one part of the day, by its local start time: AM (05:00–11:59), PM (12:00–18:59),
 *   night (19:00–04:59).
 * - A date entry replaces the weekly pattern for that day. Nothing recorded means available.
 * - Not available: a warning. Approved leave on the shift's start date: a hard block. Requested leave: a warning.
 * - Reasons never say what kind of leave it is.
 */
import type { Reason } from './eligibility.js';

export const PERIODS = ['am', 'pm', 'night'] as const;
export type Period = (typeof PERIODS)[number];

export const LEAVE_KINDS = ['annual', 'personal', 'long_service', 'unpaid', 'other'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];
export type LeaveStatus = 'requested' | 'approved' | 'declined' | 'cancelled';

export interface AvailabilityFacts {
  /** Weekly pattern: ISO weekday (1 = Monday) → parts of the day they can work. Missing day = nothing said. */
  pattern: Map<number, Period[]>;
  /** Date entries (YYYY-MM-DD) → parts of the day they can work that day. */
  dates: Map<string, Period[]>;
}

export interface LeaveFacts { startsOn: string; endsOn: string; status: LeaveStatus }

const PERIOD_WORDS: Record<Period, string> = { am: 'AM', pm: 'PM', night: 'night' };
const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
};

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** The part of the day a shift belongs to, from its local start time (HH:MM). */
export function shiftPeriod(localStart: string): Period {
  const h = Number(localStart.slice(0, 2));
  if (h >= 5 && h < 12) return 'am';
  if (h >= 12 && h < 19) return 'pm';
  return 'night';
}

/** A warning when the person has said they can't work this part of this day; null when available or nothing is recorded. */
export function availabilityReason(name: string, localDate: string, localStart: string, a: AvailabilityFacts): Reason | null {
  const period = shiftPeriod(localStart);
  const onDate = a.dates.get(localDate);
  if (onDate) {
    if (onDate.includes(period)) return null;
    return {
      code: 'availability',
      message: onDate.length
        ? `${name} isn't available for ${PERIOD_WORDS[period]} shifts on ${fmt(localDate)}`
        : `${name} isn't available on ${fmt(localDate)}`,
    };
  }
  const weekday = isoWeekday(localDate);
  const usual = a.pattern.get(weekday);
  if (!usual || usual.includes(period)) return null;
  return {
    code: 'availability',
    message: usual.length
      ? `${name} isn't usually available for ${PERIOD_WORDS[period]} shifts on ${WEEKDAYS[weekday - 1]}`
      : `${name} doesn't usually work on ${WEEKDAYS[weekday - 1]}`,
  };
}

/** Approved leave on the shift's start date blocks; requested leave warns. Declined and cancelled leave is ignored. */
export function leaveReason(name: string, localDate: string, leave: LeaveFacts[]): { hard: boolean; reason: Reason } | null {
  const on = leave.filter(l => l.startsOn <= localDate && l.endsOn >= localDate);
  if (on.some(l => l.status === 'approved')) {
    return { hard: true, reason: { code: 'leave', message: `${name} is on leave on ${fmt(localDate)}` } };
  }
  if (on.some(l => l.status === 'requested')) {
    return { hard: false, reason: { code: 'leave', message: `${name} has asked for leave on ${fmt(localDate)}` } };
  }
  return null;
}

/** Checks a list of parts of the day from a request body. */
export function parsePeriods(v: unknown): Period[] | null {
  if (!Array.isArray(v) || v.some(p => typeof p !== 'string' || !(PERIODS as readonly string[]).includes(p))) return null;
  return PERIODS.filter(p => (v as string[]).includes(p));
}

/**
 * Checks a weekly pattern from a request body: [{ weekday: 1–7 (Monday = 1), periods: ['am', 'pm', 'night'] }].
 * Returns the days, or a plain message saying what is wrong.
 */
export function parseDays(raw: unknown): { weekday: number; periods: Period[] }[] | string {
  if (!Array.isArray(raw)) return 'Days must be a list';
  const days: { weekday: number; periods: Period[] }[] = [];
  for (const d of raw) {
    const weekday = (d as Record<string, unknown>)?.weekday;
    const periods = parsePeriods((d as Record<string, unknown>)?.periods);
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      return 'Each day needs a weekday from 1 (Monday) to 7 (Sunday)';
    }
    if (!periods) return 'Times of day must be a list of am, pm and night';
    days.push({ weekday, periods });
  }
  if (new Set(days.map(d => d.weekday)).size !== days.length) return 'Each weekday can only appear once';
  return days;
}
