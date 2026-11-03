/**
 * The call log's wording (David, 3 Nov 2026). Outcomes match the API's `CALL_OUTCOMES` (clients/calls.ts); keep the
 * two in step. Pure, tested in test/calls.test.ts.
 */
export type CallOutcome = 'answered' | 'no_answer' | 'left_message' | 'said_yes' | 'said_no';
/** In the order the buttons show: the answers that matter most first. */
export const CALL_OUTCOMES: readonly CallOutcome[] = ['said_yes', 'said_no', 'no_answer', 'left_message', 'answered'];
export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  said_yes: 'Said yes', said_no: 'Said no', no_answer: 'No answer', left_message: 'Left a message', answered: 'Answered',
};

export type CallRow = {
  id: string; at: string; direction: 'out' | 'in'; outcome: CallOutcome; note: string | null; userName: string;
  workerId: string | null; workerName: string | null; clientId: string | null; clientName: string | null; contactName: string | null;
  shiftId: string | null; localDate: string; localTime: string;
};

/** Who the call was with: the person, else the contact and client ("Pat Ward (Bayside Health)"). */
export function callWith(c: Pick<CallRow, 'workerName' | 'contactName' | 'clientName'>): string {
  if (c.workerName) return c.workerName;
  if (c.contactName && c.clientName) return `${c.contactName} (${c.clientName})`;
  return c.contactName ?? c.clientName ?? 'Someone';
}

/** "Said yes · 14:05 by Jo Allocator · note"; another day shows the date first. */
export function callLine(c: Pick<CallRow, 'outcome' | 'direction' | 'note' | 'userName' | 'localDate' | 'localTime'>, today: string): string {
  const when = c.localDate === today ? c.localTime : `${c.localDate.slice(8)}/${c.localDate.slice(5, 7)} ${c.localTime}`;
  return [`${OUTCOME_LABEL[c.outcome]}${c.direction === 'in' ? ' (they rang)' : ''}`, `${when} by ${c.userName}`, c.note].filter(Boolean).join(' · ');
}
