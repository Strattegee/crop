import { startsIn, URGENT_HOURS } from '../roster/attention.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

/**
 * Needs attention on the agency's side (backlog items 8 and 12): what in Allocations wants the agency's office soon.
 * Pure rules and wording here; the data comes from `agency-attention.controller.ts`, which reads only the agency's own
 * rows (its inbox copies, its offers, its people, its links). Plain words; never credential details beyond what the
 * agency's own eligibility reasons already say (those are office-facing).
 */

export type AgencyAttentionKind = 'person_blocked' | 'open' | 'link_matching' | 'awaiting_employer';

/** An open request the agency has been sent and hasn't put anyone forward for yet. */
export interface AttentionRequest {
  id: string;
  startsAt: Date;
  employerName: string;
  /** How many of the agency's people are ready to go (null when they couldn't be checked). */
  ready: number | null;
  /** Must-haves not matched to the agency's credentials (nobody can be checked against them). */
  unmatchedMust: number;
  offersPending: number;
  /** Offers whose time limit passed with no reply. */
  offersExpired: number;
}

/** Someone the agency put forward who is waiting for the employer's approval or booked. */
export interface AttentionPlacement {
  id: string;
  startsAt: Date;
  employerName: string;
  personName: string;
  placement: 'waiting' | 'booked';
  /** Why the person can't work it now, by the agency's own checks (hard blocks only). */
  blocks: string[];
}

/** A link still waiting for the agency to match the employer's requirements (it can't be sent requests yet). */
export interface AttentionLink {
  connectionId: string;
  employerName: string;
}

export interface AgencyAttentionItem {
  kind: AgencyAttentionKind;
  /** The agency's copy of the request (inbox id), when the item is about one. */
  requestId: string | null;
  /** The link, for `link_matching`. */
  connectionId: string | null;
  urgent: boolean;
  title: string;
  detail: string;
  startsIn: string | null;
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** What the agency has done about an open request so far, and who could go, in a few words. */
export function requestNote(r: Pick<AttentionRequest, 'ready' | 'unmatchedMust' | 'offersPending' | 'offersExpired'>, w: Words = DEFAULT_WORDS): string {
  const parts: string[] = [];
  if (r.offersPending) parts.push(`offered to ${people(r.offersPending)}, no reply yet`);
  else if (r.offersExpired) parts.push(`offer to ${people(r.offersExpired)} ran out with no reply`);
  else parts.push('not offered to anyone yet');
  if (r.unmatchedMust) parts.push(`${r.unmatchedMust} must-have${r.unmatchedMust === 1 ? " isn't" : "s aren't"} matched to your credentials yet`);
  else if (r.ready === 0) parts.push(`none of your ${w.lower(T.worker, true)} meet the requirements`);
  else if (r.ready !== null) parts.push(`${r.ready} of your ${w.lower(T.worker, r.ready !== 1)} ready to go`);
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const RANK: Record<AgencyAttentionKind, number> = { person_blocked: 0, open: 1, link_matching: 2, awaiting_employer: 3 };

/**
 * Everything that needs the agency's attention, most pressing first: urgent items (starting within a day) before the
 * rest; within each, people it put forward who can no longer work the shift, then requests nobody has been put forward
 * for, then links waiting for matching, then people waiting for the employer's approval; then by start time. Shifts
 * that have started are left out (requests close then, and pulling out is refused).
 */
export function agencyAttentionItems(
  requests: AttentionRequest[], placements: AttentionPlacement[], links: AttentionLink[], now: Date,
  w: Words = DEFAULT_WORDS, urgentHours = URGENT_HOURS,
): AgencyAttentionItem[] {
  const shift = w.lower(T.shift);
  const out: Array<AgencyAttentionItem & { at: number }> = [];
  const timed = (startsAt: Date) => ({
    at: startsAt.getTime(), urgent: startsAt.getTime() - now.getTime() < urgentHours * 3_600_000, startsIn: startsIn(startsAt, now),
  });
  for (const r of requests) {
    if (r.startsAt.getTime() <= now.getTime()) continue;
    out.push({ ...timed(r.startsAt), kind: 'open', requestId: r.id, connectionId: null, title: `Nobody put forward for ${r.employerName} yet`, detail: requestNote(r, w) });
  }
  for (const p of placements) {
    if (p.startsAt.getTime() <= now.getTime()) continue;
    if (p.blocks.length) {
      out.push({
        ...timed(p.startsAt), kind: 'person_blocked', requestId: p.id, connectionId: null,
        title: `${p.personName} can't work ${p.employerName}'s ${shift} now`,
        detail: `${p.blocks.join(' ')} Pull them out so ${p.employerName} can fill it.`,
      });
    } else if (p.placement === 'waiting') {
      out.push({
        ...timed(p.startsAt), kind: 'awaiting_employer', requestId: p.id, connectionId: null,
        title: `Waiting for ${p.employerName} to approve ${p.personName}`,
        detail: `Nothing to do yet; you'll be emailed when ${p.employerName} decides`,
      });
    }
  }
  for (const l of links) {
    out.push({
      at: Number.MAX_SAFE_INTEGER, urgent: false, startsIn: null, kind: 'link_matching', requestId: null, connectionId: l.connectionId,
      title: `Match ${l.employerName}'s requirements`,
      detail: `${l.employerName} can't send you ${w.lower(T.shift, true)} until every must-have and should-have is matched to your credentials`,
    });
  }
  return out
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || RANK[a.kind] - RANK[b.kind] || a.at - b.at)
    .map(({ at: _at, ...i }) => i);
}

export function agencyAttentionCounts(items: AgencyAttentionItem[]) {
  const byKind: Record<AgencyAttentionKind, number> = { person_blocked: 0, open: 0, link_matching: 0, awaiting_employer: 0 };
  for (const i of items) byKind[i.kind]++;
  return { total: items.length, urgent: items.filter(i => i.urgent).length, byKind };
}
