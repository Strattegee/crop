/**
 * Upload by link (approved by David 29 Oct): pure rules and wording. A person asked for their documents gets a one-off
 * link; through it they can send only what is still needed, and everything waits for the office to check it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ComplianceIssue } from './compliance.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

/** How long a link works. */
export const UPLOAD_LINK_DAYS = 7;
/** Files one link may add to one credential, or to the right to work record. */
export const LINK_MAX_FILES = 10;

export const UPLOAD_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const hashUploadToken = (token: string) => createHash('sha256').update(token, 'utf8').digest();
export function newUploadLink() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashUploadToken(token) };
}
export const uploadLinkUrl = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, '')}/upload/${token}`;

export type LinkState = 'ok' | 'expired' | 'stopped';
export function linkState(l: { expiresAt: Date | string; revokedAt: Date | string | null }, now = new Date()): LinkState {
  if (l.revokedAt) return 'stopped';
  return new Date(l.expiresAt).getTime() <= now.getTime() ? 'expired' : 'ok';
}

export interface LinkNeed { credentialTypeId: string; typeName: string; required: boolean }

/**
 * What a link lets the person send: credentials their onboarding still needs (steps "to do") and credentials their
 * roles need that are missing, not accepted, run out, running out or sent and not checked yet. Right to work is
 * handled on its own.
 */
export function linkNeeds(
  issues: Pick<ComplianceIssue, 'credentialTypeId' | 'typeName' | 'severity' | 'problem'>[],
  steps: { kind: string; credentialTypeId: string | null; typeName: string | null; required: boolean; state: string }[],
): LinkNeed[] {
  const out = new Map<string, LinkNeed>();
  const add = (id: string, typeName: string, required: boolean) => {
    const prev = out.get(id);
    out.set(id, { credentialTypeId: id, typeName, required: required || !!prev?.required });
  };
  for (const s of steps) {
    if (s.kind === 'credential' && s.credentialTypeId && s.state === 'to_do') add(s.credentialTypeId, s.typeName ?? 'Credential', s.required);
  }
  for (const i of issues) {
    if (i.credentialTypeId === 'right-to-work') continue;
    // Unchecked ones stay on the list so the person sees they've been sent (and can add another file).
    if (['missing', 'rejected', 'expired', 'expiring', 'unverified'].includes(i.problem)) add(i.credentialTypeId, i.typeName, i.severity === 'hard');
  }
  return [...out.values()].sort((a, b) => Number(b.required) - Number(a.required) || a.typeName.localeCompare(b.typeName));
}

/** Whether right to work proof is still needed from the person (and so can be sent through the link). */
export function rightToWorkNeeded(
  issues: Pick<ComplianceIssue, 'credentialTypeId' | 'problem'>[],
  steps: { kind: string; state: string }[],
): boolean {
  return steps.some(s => s.kind === 'right_to_work' && s.state === 'to_do')
    || issues.some(i => i.credentialTypeId === 'right-to-work');
}

const longDate = (d: Date, zone: string) =>
  new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(d);

/** The lines added to the message asking for documents. */
export function uploadLinkLines(url: string, expiresAt: Date, zone: string): { email: string; sms: string } {
  return {
    email: `You can send photos or files of these here, without signing in: ${url}\nThe link is just for you and works until ${longDate(expiresAt, zone)}.`,
    sms: `Send them here: ${url}`,
  };
}

/** Tells owners and admins something arrived through a link. Never the number; a vaccination is only "a vaccination record". */
export function linkUploadEmail(p: { name: string; workerId: string; what: string }, appUrl: string, w: Words = DEFAULT_WORDS) {
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/workers/${p.workerId}?tab=credentials` : '';
  return {
    subject: `${p.name} sent ${p.what} through their upload link`,
    body: [
      `${p.name} has sent ${p.what} through the upload link they were sent. It doesn't count until an owner or admin checks it.`,
      ``,
      link ? `To check it, open their page: ${link}` : `To check it, open their page in CROP (${w.many(T.worker)}).`,
      ``,
      `CROP Workforce Management`,
    ].join('\n'),
  };
}
