/**
 * More requests on the manager side's Requests tab (7 Nov, with the office phone alerts that open it): shift swaps two
 * people have agreed (when the business's setting is approve) and changes to their details people asked for in the
 * app. Pure helpers; the data comes from the office endpoints as they are (`GET /shift-swaps?status=agreed`,
 * `GET /detail-changes`), which only owners and admins can decide.
 */

export interface SwapShiftView { localDate: string; localStart: string; localEnd: string; role: string; site: string; area: string | null }

export interface OfficeSwap {
  id: string; status: string; fromName: string; toName: string; summary: string; stateLine: string;
  shift: SwapShiftView; other: SwapShiftView | null; canDecide: boolean;
}

export interface DetailChange {
  id: string; workerName: string; label: string; what: string; status: string;
  askedLine: string | null; wasLine: string | null; nowLine: string | null; canDecide: boolean;
}

/** "Swap: Ana Example and Ben Example" / "Hand over: Ana Example to Ben Example". */
export function swapTitle(s: Pick<OfficeSwap, 'fromName' | 'toName' | 'other'>): string {
  return s.other ? `Swap: ${s.fromName} and ${s.toName}` : `Hand over: ${s.fromName} to ${s.toName}`;
}

/** Only swaps waiting for the office (both people said yes). */
export function swapsToDecide(list: OfficeSwap[]): OfficeSwap[] {
  return list.filter(s => s.status === 'agreed');
}

/** "Ana Example · Change mobile". */
export function detailTitle(c: Pick<DetailChange, 'workerName' | 'what'>): string {
  return `${c.workerName} · ${c.what}`;
}

/** What they asked for, what it was, and what it is now if the office changed it since. The office sees the values. */
export function detailLines(c: Pick<DetailChange, 'askedLine' | 'wasLine' | 'nowLine'>): string[] {
  const out: string[] = [];
  if (c.askedLine) out.push(`Asked for: ${c.askedLine}`);
  if (c.wasLine) out.push(`Was: ${c.wasLine}`);
  if (c.nowLine) out.push(`Now (changed since): ${c.nowLine}`);
  return out;
}

/** The message after deciding a swap. */
export function swapDecidedMessage(answer: 'approve' | 'refuse'): string {
  return answer === 'approve' ? 'Approved. Both have been told.' : 'Not approved. Both stay on their own and have been told.';
}

/** The message after deciding a change to someone's details. */
export function detailDecidedMessage(answer: 'approve' | 'decline', told: 'app' | 'email' | null | undefined): string {
  const how = told === 'app' ? ' They have been told in the app.' : told === 'email' ? ' They have been told by email.' : '';
  return (answer === 'approve' ? 'Approved and changed.' : 'Declined.') + how;
}
