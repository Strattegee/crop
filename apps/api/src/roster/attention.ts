/**
 * Needs attention (backlog item 12): what on the roster wants the office's attention soon. Pure rules here;
 * the data comes from `attention.controller.ts`. Plain words only, and never credential details beyond what
 * the eligibility reasons already say (those are office-facing).
 */

export type AttentionKind = 'person_blocked' | 'equipment_blocked' | 'open' | 'unconfirmed';

/** One shift starting soon, with what the controller found about it. */
export interface AttentionShift {
  id: string;
  startsAt: Date;
  equipmentOnly: boolean;
  workerName: string | null;
  /** assigned (waiting for them) or confirmed, when someone is on it. */
  assignmentStatus: 'assigned' | 'confirmed' | null;
  /** Offers still waiting for a reply. */
  offersPending: number;
  /** Offers whose time limit passed with no reply. */
  offersExpired: number;
  pulledOutName: string | null;
  /** Why the person on it can't work it now (hard blocks only). */
  personBlocks: string[];
  /** Equipment on it that can't be used now, with why. */
  equipmentBlocks: Array<{ name: string; reasons: string[] }>;
  /** Equipment-only shift with nothing booked on it. */
  equipmentMissing?: boolean;
}

export interface AttentionItem {
  shiftId: string;
  kind: AttentionKind;
  /** Starts within the urgent window (24 hours by default). */
  urgent: boolean;
  title: string;
  detail: string;
  startsIn: string;
}

export const URGENT_HOURS = 24;

/** "starts within the hour", "starts in 5 hours", "starts in 3 days". */
export function startsIn(startsAt: Date, now: Date): string {
  const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
  if (hours < 1) return 'starts within the hour';
  if (hours < 48) {
    const h = Math.floor(hours);
    return `starts in ${h} hour${h === 1 ? '' : 's'}`;
  }
  return `starts in ${Math.floor(hours / 24)} days`;
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** What the office has done about an open shift so far, in a few words. */
export function offerNote(s: Pick<AttentionShift, 'offersPending' | 'offersExpired' | 'pulledOutName'>): string {
  const parts: string[] = [];
  if (s.pulledOutName) parts.push(`${s.pulledOutName} pulled out`);
  if (s.offersPending) parts.push(`offered to ${people(s.offersPending)}, no reply yet`);
  else if (s.offersExpired) parts.push(`offer to ${people(s.offersExpired)} ran out with no reply`);
  else parts.push('not offered to anyone yet');
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const RANK: Record<AttentionKind, number> = { person_blocked: 0, equipment_blocked: 1, open: 2, unconfirmed: 3 };

/**
 * Everything that needs attention, most pressing first: urgent items (starting within a day) before the
 * rest; within each, people or equipment that can no longer work a booked shift, then shifts nobody is on,
 * then people who haven't confirmed; then by start time.
 * A shift can appear more than once (for example a blocked person and blocked equipment).
 */
export function attentionItems(shifts: AttentionShift[], now: Date, urgentHours = URGENT_HOURS): AttentionItem[] {
  const out: Array<AttentionItem & { at: number }> = [];
  for (const s of shifts) {
    const at = s.startsAt.getTime();
    if (at <= now.getTime()) continue;
    const base = { shiftId: s.id, urgent: at - now.getTime() < urgentHours * 3_600_000, startsIn: startsIn(s.startsAt, now), at };
    if (s.workerName && s.personBlocks.length) {
      out.push({ ...base, kind: 'person_blocked', title: `${s.workerName} can't work this shift now`, detail: s.personBlocks.join(' ') });
    }
    for (const e of s.equipmentBlocks) {
      out.push({ ...base, kind: 'equipment_blocked', title: `${e.name} can't be used on this shift now`, detail: e.reasons.join(' ') });
    }
    if (s.equipmentOnly) {
      if (s.equipmentMissing) out.push({ ...base, kind: 'open', title: 'No equipment booked', detail: 'Book equipment or cancel the shift' });
      continue;
    }
    if (!s.workerName) {
      out.push({ ...base, kind: 'open', title: 'Nobody on this shift', detail: offerNote(s) });
    } else if (s.assignmentStatus === 'assigned' && !s.personBlocks.length) {
      out.push({ ...base, kind: 'unconfirmed', title: `${s.workerName} hasn't confirmed`, detail: 'Waiting for them to agree to the shift' });
    }
  }
  return out
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || RANK[a.kind] - RANK[b.kind] || a.at - b.at)
    .map(({ at: _at, ...i }) => i);
}

/** Counts for the roster's heading: how many items, and how many are urgent. */
export function attentionCounts(items: AttentionItem[]) {
  return { total: items.length, urgent: items.filter(i => i.urgent).length };
}
