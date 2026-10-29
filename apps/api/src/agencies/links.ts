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
export function linkStatusWords(status: LinkStatus, side: 'employer' | 'agency', other: string): string {
  if (status === 'ended') return 'Ended';
  if (status === 'active') return side === 'employer' ? `${other} can be sent requests` : `You can be sent requests by ${other}`;
  return side === 'employer'
    ? `Linked. Waiting for ${other} to match your requirements before requests can go to them`
    : `Linked. Match ${other}'s requirements to your credentials before they can send you requests`;
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
