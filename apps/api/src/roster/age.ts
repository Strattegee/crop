/**
 * Workers under 18 (David, 3 Nov, answer 8). Pure functions: no database access.
 *
 * A person's date of birth is office only. When someone is under 18 on a shift's local date, eligibility warns
 * (never blocks: minimum ages and rules differ by state and kind of work, so the office decides) when:
 * - the shift's role is set as 18 and over;
 * - a duty on the shift is set as 18 and over;
 * - the shift runs late at night or early in the morning (any time between 10pm and 6am, site time).
 * The reasons never say the person's age or date of birth.
 */
import type { Reason } from './eligibility.js';

/** Whole years old on a date (both YYYY-MM-DD); a 29 February birthday counts from 1 March in other years. */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const ADULT_AGE = 18;

export const isUnder18 = (dateOfBirth: string | null | undefined, onDate: string) =>
  !!dateOfBirth && ageOn(dateOfBirth, onDate) < ADULT_AGE;

/** Late-night work for under-18s: 10pm to 6am, site time. */
export const LATE_FROM = 22 * 60;
export const EARLY_UNTIL = 6 * 60;

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when a shift (site-local start and finish, HH:MM; a finish at or before the start is the next day) runs into 10pm–6am. */
export function runsLateAtNight(localStart: string, localEnd: string): boolean {
  const s = minutes(localStart);
  let e = minutes(localEnd);
  if (e <= s) e += 24 * 60;
  return s < EARLY_UNTIL || e > LATE_FROM;
}

export interface AgeFacts {
  /** The person's date of birth; null or missing = not recorded (nothing to check). */
  dateOfBirth?: string | null;
  /** The shift's role is set as 18 and over. */
  adultRole?: boolean;
  /** Duties on the shift set as 18 and over, by name. */
  adultDuties?: string[];
}

export function ageReasons(name: string, shift: { role: string; localDate: string; localStart?: string; localEnd?: string }, f: AgeFacts): Reason[] {
  if (!isUnder18(f.dateOfBirth, shift.localDate)) return [];
  const out: Reason[] = [];
  if (f.adultRole) out.push({ code: 'age', message: `${name} is under 18 and ${shift.role} is set as 18 and over` });
  for (const duty of f.adultDuties ?? []) out.push({ code: 'age', message: `${name} is under 18 and ${duty} is set as 18 and over` });
  if (shift.localStart && shift.localEnd && runsLateAtNight(shift.localStart, shift.localEnd)) {
    out.push({ code: 'age', message: `${name} is under 18 and this {shift} runs between 10pm and 6am` });
  }
  return out;
}
