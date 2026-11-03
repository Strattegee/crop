/**
 * Requests for a day in the app (David, 3 Nov, answer 3: Steve's "R"): "AM shift please", "finish by 14:00", or a
 * short note, for a date from today. Pure helpers, tested in test/day-requests.spec.ts.
 */
export type RequestKind = 'prefer_am' | 'prefer_pm' | 'prefer_night' | 'finish_by' | 'start_after' | 'other';
export const REQUEST_KINDS: RequestKind[] = ['prefer_am', 'prefer_pm', 'prefer_night', 'finish_by', 'start_after', 'other'];

export interface MyDayRequest {
  id: string; date: string; kind: RequestKind; atTime: string | null; note: string | null;
  status: 'open' | 'done' | 'not_possible' | 'withdrawn'; line: string; decidedNote: string | null;
}

/** The choice's label, in the business's word for a shift. */
export function kindLabel(kind: RequestKind, word: { lower: string }): string {
  return {
    prefer_am: `AM ${word.lower}`, prefer_pm: `PM ${word.lower}`, prefer_night: `Night ${word.lower}`,
    finish_by: 'Finish by', start_after: 'Start after', other: 'Something else',
  }[kind];
}

export const needsTime = (k: RequestKind) => k === 'finish_by' || k === 'start_after';

export const REQUEST_STATUS: Record<MyDayRequest['status'], string> = {
  open: 'Waiting for the office', done: 'Done', not_possible: 'Not possible this time', withdrawn: 'Withdrawn',
};

/** Half-hour steps for the time picker, from 05:00 to 23:30. */
export const TIMES: string[] = Array.from({ length: 38 }, (_, i) => {
  const m = 5 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`;
});

/** The next or previous time step, staying within the list. */
export function stepTime(t: string, by: 1 | -1): string {
  const i = TIMES.indexOf(t);
  return TIMES[Math.min(TIMES.length - 1, Math.max(0, (i < 0 ? TIMES.indexOf('14:00') : i) + by))];
}

/** What's wrong before sending, or null. */
export function requestProblem(kind: RequestKind, note: string): string | null {
  if (kind === 'other' && !note.trim()) return 'Say what you would like';
  if (note.trim().length > 200) return 'Keep the note to 200 characters';
  return null;
}

/** The API body for POST /my/day-requests. */
export function requestBody(date: string, kind: RequestKind, time: string, note: string) {
  return { date, kind, time: needsTime(kind) ? time : null, note: note.trim() || null };
}
