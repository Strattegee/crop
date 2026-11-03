/**
 * The call log (David, 3 Nov 2026, answer 1: "calls made" per allocation officer). CROP doesn't dial; the office
 * records a call in one or two clicks. Pure: no database access.
 */
export type CallOutcome = 'answered' | 'no_answer' | 'left_message' | 'said_yes' | 'said_no';
export const CALL_OUTCOMES: readonly CallOutcome[] = ['said_yes', 'said_no', 'no_answer', 'left_message', 'answered'];
export type CallDirection = 'out' | 'in';

export const OUTCOME_WORDS: Record<CallOutcome, string> = {
  answered: 'Answered', no_answer: 'No answer', left_message: 'Left a message', said_yes: 'Said yes', said_no: 'Said no',
};

/** A call is with a worker or a client (or both: a client contact about a worker is still the client's call). */
export function callProblem(c: { workerId: string | null; clientId: string | null; contactId: string | null }): string | null {
  if (!c.workerId && !c.clientId && !c.contactId) return 'Choose who the call was with';
  return null;
}

/** "Said yes · Jo Allocator 14:05 · back from leave Monday" */
export function callLine(c: { outcome: CallOutcome; userName: string; time: string; note: string | null; direction?: CallDirection }): string {
  return [OUTCOME_WORDS[c.outcome] + (c.direction === 'in' ? ' (they rang)' : ''), `${c.userName} ${c.time}`, c.note].filter(Boolean).join(' · ');
}
