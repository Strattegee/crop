/**
 * Requests for a day (David, 3 Nov, answer 3: Steve's "R"; migration 0080). A member of staff asks for something on a
 * date in the app ("AM shift please", "must finish before 14:00", a short note). The office sees them on the roster and
 * in the App requests panel and marks each done or not possible. Pure rules: no database.
 * Requests guide; they never block: a shift that doesn't fit one is a warning (code `request`).
 */
import { shiftPeriod, type Period } from './availability.js';
type Reason = { code: 'request'; message: string };

export const DAY_REQUEST_KINDS = ['prefer_am', 'prefer_pm', 'prefer_night', 'finish_by', 'start_after', 'other'] as const;
export type DayRequestKind = (typeof DAY_REQUEST_KINDS)[number];
export type DayRequestStatus = 'open' | 'done' | 'not_possible' | 'withdrawn';
export const DAY_REQUEST_DAYS = 90;
/** The most requests one person can have waiting for one date. */
export const MAX_OPEN_PER_DATE = 3;

export interface DayRequestFacts { kind: DayRequestKind; atTime: string | null; note: string | null; status: DayRequestStatus }

const PREFER: Partial<Record<DayRequestKind, Period>> = { prefer_am: 'am', prefer_pm: 'pm', prefer_night: 'night' };
const PERIOD_WORD: Record<Period, string> = { am: 'AM', pm: 'PM', night: 'night' };
const LINE_WORD: Record<Period, string> = { am: 'AM', pm: 'PM', night: 'Night' };

/** The request in a few words, for the roster's R line, the panel and the app. The note follows when there is one. */
export function requestLine(r: { kind: DayRequestKind; atTime: string | null; note: string | null }): string {
  const what = r.kind === 'finish_by' ? `Finish by ${r.atTime}` : r.kind === 'start_after' ? `Start after ${r.atTime}`
    : r.kind === 'other' ? '' : `${LINE_WORD[PREFER[r.kind]!]} {shift} please`;
  return [what, r.note ? (what ? `“${r.note}”` : r.note) : ''].filter(Boolean).join(' · ');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };

/**
 * Whether a shift on the request's date goes against it: a different part of the day than asked for, finishing after
 * `finish_by` (an overnight shift always does), or starting before `start_after`. `other` is never checked.
 */
export function breaksRequest(r: DayRequestFacts, localStart: string, localEnd?: string | null): boolean {
  const want = PREFER[r.kind];
  if (want) return shiftPeriod(localStart) !== want;
  if (r.kind === 'start_after') return !!r.atTime && localStart < r.atTime;
  if (r.kind === 'finish_by') {
    if (!r.atTime || !localEnd) return false;
    return localEnd <= localStart || localEnd > r.atTime;
  }
  return false;
}

/**
 * Warnings for a person's requests on the shift's date (only those waiting or done: not possible and withdrawn ones are
 * finished with). Written with word tokens, filled where eligibility is worked out.
 */
export function requestReasons(name: string, localDate: string, localStart: string | undefined, localEnd: string | null | undefined, requests: DayRequestFacts[]): Reason[] {
  if (!localStart) return [];
  return requests
    .filter(r => (r.status === 'open' || r.status === 'done') && breaksRequest(r, localStart, localEnd))
    .map(r => ({
      code: 'request',
      message: PREFER[r.kind] ? `${name} asked for ${PERIOD_WORD[PREFER[r.kind]!]} {shifts} on ${dayLabel(localDate)}`
        : r.kind === 'finish_by' ? `${name} asked to finish by ${r.atTime} on ${dayLabel(localDate)}`
        : `${name} asked to start after ${r.atTime} on ${dayLabel(localDate)}`,
    }));
}

/** Why the person can't make this request in the app, or null. Dates are the business's; today up to 90 days ahead. */
export function myDayRequestRefusal(onDate: string, today: string, openThatDay: number): string | null {
  if (onDate < today) return 'Choose today or a later date';
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_REQUEST_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (onDate > last) return `Choose a date in the next ${DAY_REQUEST_DAYS} days`;
  if (openThatDay >= MAX_OPEN_PER_DATE) return `You already have ${MAX_OPEN_PER_DATE} requests waiting for that day. Withdraw one first`;
  return null;
}

/** Why the office can't mark this request, or null. */
export function decideRefusal(status: DayRequestStatus): string | null {
  if (status === 'withdrawn') return 'They withdrew this request';
  if (status !== 'open') return 'This request has already been answered';
  return null;
}

/** The one message telling the person what the office decided (push in the app, else email). Never anyone else's detail. */
export function answeredMessage(firstName: string, onDate: string, line: string, outcome: 'done' | 'not_possible', note: string | null, business: string) {
  const what = outcome === 'done' ? 'has been looked after' : "couldn't be done this time";
  const title = outcome === 'done' ? `Request for ${dayLabel(onDate)} done` : `Request for ${dayLabel(onDate)}`;
  const body = `Your request for ${dayLabel(onDate)} (${line}) ${what}.${note ? ` ${note}` : ''}`;
  return {
    push: { title, body },
    email: {
      subject: `${business}: your request for ${dayLabel(onDate)}`,
      body: `Hi ${firstName},\n\n${body}\n\n${business}`,
    },
  };
}
