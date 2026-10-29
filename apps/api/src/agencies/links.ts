import { createHash, randomBytes } from 'node:crypto';

/**
 * Agency connections (migration 0038): pure rules for invitation links and the order agencies are asked in.
 * Design: docs/decisions/2026-10-28-agency-connections-design.md (approved by David 29 Oct).
 */

/** How long an invitation link works. */
export const INVITE_DAYS = 7;
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const hashInviteToken = (token: string) => createHash('sha256').update(token, 'utf8').digest();
export function newInviteLink() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}
export const inviteUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, '')}/agency-invite/${token}`;

export type InviteState = 'pending' | 'used' | 'cancelled' | 'expired';
export function inviteState(i: { acceptedAt: Date | null; cancelledAt: Date | null; expiresAt: Date }, now = new Date()): InviteState {
  if (i.acceptedAt) return 'used';
  if (i.cancelledAt) return 'cancelled';
  return i.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}

export type LinkStatus = 'matching' | 'active' | 'ended';
/** The link's state in plain words, for the side reading it. */
export function linkStatusWords(status: LinkStatus, side: 'employer' | 'agency', other: string, unmatched?: number): string {
  if (status === 'ended') return 'Ended';
  if (status === 'active') return side === 'employer' ? `${other} can be sent requests` : `You can be sent requests by ${other}`;
  const n = unmatched && unmatched > 0 ? `${unmatched} requirement${unmatched === 1 ? '' : 's'}` : null;
  return side === 'employer'
    ? `Linked. Waiting for ${other} to match ${n ? `${n} of yours` : 'your requirements'} before requests can go to them`
    : `Linked. Match ${n ? `${n} of ${other}'s` : `${other}'s requirements`} to your credentials before they can send you requests`;
}

/**
 * A new order for the employer's live links: `ids` must name each live link exactly once.
 * Returns the error to show, or null when it is a valid order.
 */
export function orderProblem(ids: unknown, live: string[]): string | null {
  if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) return 'Give the agencies in order';
  if (new Set(ids).size !== ids.length) return 'Each agency can appear only once';
  const known = new Set(live);
  if (ids.length !== live.length || ids.some(i => !known.has(i))) return 'The list of agencies has changed. Refresh the page and try again.';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the shape of `{ matches: [{ requirementId, credentialTypeId | null }] }`; returns the error to show or null. */
export function matchesProblem(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return 'Choose at least one match';
  if (list.length > 200) return 'Too many matches at once';
  const seen = new Set<string>();
  for (const m of list) {
    if (!m || typeof m !== 'object') return 'Choose a credential for each requirement';
    const { requirementId, credentialTypeId } = m as Record<string, unknown>;
    if (typeof requirementId !== 'string' || !UUID.test(requirementId)) return 'Choose a requirement';
    if (credentialTypeId !== null && (typeof credentialTypeId !== 'string' || !UUID.test(credentialTypeId))) return 'Choose one of your credentials';
    if (seen.has(requirementId)) return 'Each requirement can be matched only once';
    seen.add(requirementId);
  }
  return null;
}
