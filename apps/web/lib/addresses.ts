/**
 * A person's addresses on their Details tab (David, 3 Nov 2026, answer 5; API `GET /workers/:id/addresses`). The API
 * words each address (`line`); this only words the history. Pure, tested.
 */
export type Address = {
  id: string; label: string | null; line1: string; line2: string | null; suburb: string | null; region: string | null;
  postcode: string | null; country: string; current: boolean; line: string; createdAt: string;
  replacedAt: string | null; removedAt: string | null; removedReason: string | null; replacesId: string | null;
};
export type Earlier = Address & { ended: 'corrected' | 'removed' };
export type Addresses = { current: Address | null; others: Address[]; earlier: Earlier[] };

/** "Home: 12 Example Street, Richmond VIC 3121" */
export const addressTitle = (a: Pick<Address, 'label' | 'line'>) => (a.label ? `${a.label}: ${a.line}` : a.line);

/** "Corrected 4 Nov" / "Taken off the list 4 Nov · Moved out" (`when` formats a timestamp in the business's zone). */
export function earlierLine(e: Pick<Earlier, 'ended' | 'replacedAt' | 'removedAt' | 'removedReason'>, when: (iso: string) => string): string {
  if (e.ended === 'corrected') return `Corrected ${when(e.replacedAt!)}`;
  return [`Taken off the list ${when(e.removedAt!)}`, e.removedReason].filter(Boolean).join(' · ');
}

/** What the Details tab says when there is no current address. */
export function noCurrentLine(others: number): string {
  return others ? 'No current address: choose one below or add a new one.' : 'No address recorded yet.';
}
