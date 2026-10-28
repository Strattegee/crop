/**
 * Requested changes to a published roster (migration 0025). Pure helpers: the kinds of change, and how a
 * request reads in the roster's list. Never mentions leave kinds or credential details.
 */
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export type ChangeRequestKind = 'assign' | 'confirm' | 'remove' | 'pulled_out' | 'cancel' | 'other';
export const CHANGE_REQUEST_KINDS: ChangeRequestKind[] = ['assign', 'confirm', 'remove', 'pulled_out', 'cancel', 'other'];
export type ChangeRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** What the request asks for, in plain words. */
export function requestSummary(r: { kind: ChangeRequestKind; workerName: string | null; currentName?: string | null; reason: string | null }, w: Words = DEFAULT_WORDS): string {
  const sh = w.lower(T.shift);
  const current = r.currentName ?? 'the person on it';
  switch (r.kind) {
    case 'assign': return `Put ${r.workerName ?? 'someone'} on the ${sh}`;
    case 'confirm': return `Confirm ${current} (they have agreed)`;
    case 'remove': return `Take ${current} off the ${sh}`;
    case 'pulled_out': return `Record that ${current} pulled out`;
    case 'cancel': return r.reason ? `Cancel the ${sh}: ${r.reason}` : `Cancel the ${sh}`;
    case 'other': return r.reason ?? 'Another change';
  }
}

/**
 * Whether a request can be made for this shift as it is now; a plain reason when it can't.
 * `hasPerson`: someone is on it (assigned or confirmed).
 */
export function requestProblem(kind: ChangeRequestKind, shift: { status: string; equipmentOnly: boolean; hasPerson: boolean }, w: Words = DEFAULT_WORDS): string | null {
  const sh = w.lower(T.shift);
  if (shift.status === 'cancelled') return `This ${sh} is cancelled`;
  switch (kind) {
    case 'assign':
      if (shift.equipmentOnly) return `This ${sh} is for equipment only, so nobody can be put on it`;
      return shift.hasPerson ? `Someone is already on this ${sh}. Ask for them to be taken off first.` : null;
    case 'confirm':
      return shift.status === 'assigned' ? null : `There is nobody waiting to confirm on this ${sh}`;
    case 'remove':
    case 'pulled_out':
      return shift.hasPerson ? null : `Nobody is on this ${sh}`;
    default:
      return null;
  }
}

/** What an email about a request needs to say about it (no credential details, no leave kinds). */
export interface RequestForEmail {
  summary: string;
  reason: string | null;
  kind: ChangeRequestKind;
  requestedByName: string | null;
  facilityName: string;
  areaName: string | null;
  role: string;
  localDate: string;
  localStart: string;
  localEnd: string;
  weekStart: string;
  facilityId: string;
  shiftId: string;
}

const DAY = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "Tuesday 4 March, 07:00–15:00, Chef, Kitchen, Harbour Kitchen" */
export function shiftLine(r: Pick<RequestForEmail, 'localDate' | 'localStart' | 'localEnd' | 'role' | 'areaName' | 'facilityName'>) {
  const day = DAY.format(new Date(`${r.localDate}T00:00:00Z`));
  return [`${day}, ${r.localStart}–${r.localEnd}`, r.role, r.areaName, r.facilityName].filter(Boolean).join(', ');
}

/** Where the shift opens on the roster, or null without an app address. */
export function rosterLink(appUrl: string, r: Pick<RequestForEmail, 'weekStart' | 'facilityId' | 'shiftId'>) {
  const base = appUrl.replace(/\/$/, '');
  return base ? `${base}/roster?week=${r.weekStart}&site=${r.facilityId}&shift=${r.shiftId}` : null;
}

/** To owners and admins when a request arrives. */
export function requestArrivedEmail(r: RequestForEmail, appUrl: string, w: Words = DEFAULT_WORDS) {
  const sh = w.lower(T.shift);
  const roster = w.lower(T.roster);
  const who = r.requestedByName ?? 'Someone in the office';
  const link = rosterLink(appUrl, r);
  // For cancel and other, the reason is already the summary; for the rest it is extra context.
  const why = r.reason && r.kind !== 'cancel' && r.kind !== 'other' ? `Their note: ${r.reason}` : null;
  return {
    subject: `Change requested: ${r.facilityName}, ${shiftLine(r).split(',')[0]}`,
    body: [
      `${who} has asked for a change to the published ${roster} at ${r.facilityName}.`,
      ``,
      `${w.one(T.shift)}: ${shiftLine(r)}`,
      `Change: ${r.summary}`,
      ...(why ? [why] : []),
      ``,
      link ? `To approve or decline it, open the ${sh} on the ${roster}: ${link}` : `To approve or decline it, open the ${sh} on the ${roster} in CROP.`,
      ``,
      `CROP Workforce Management`,
    ].join('\n'),
  };
}

/** To the person who asked, once the request is approved, declined or withdrawn by someone else. */
export function requestDecidedEmail(r: RequestForEmail, outcome: 'approved' | 'declined' | 'withdrawn', decidedByName: string | null, note: string | null, appUrl: string, w: Words = DEFAULT_WORDS) {
  const sh = w.lower(T.shift);
  const roster = w.lower(T.roster);
  const who = decidedByName ?? 'An owner or admin';
  const link = rosterLink(appUrl, r);
  const what = outcome === 'approved'
    ? (r.kind === 'other' ? `${who} approved it and will make the change on the ${sh}.` : `${who} approved it, and the change has been made.`)
    : outcome === 'declined' ? `${who} declined it, so the ${sh} stays as it was.` : `${who} withdrew it, so the ${sh} stays as it was.`;
  return {
    subject: `Change ${outcome}: ${r.facilityName}, ${shiftLine(r).split(',')[0]}`,
    body: [
      `Your request for a change to the ${roster} at ${r.facilityName} has been ${outcome}.`,
      ``,
      `${w.one(T.shift)}: ${shiftLine(r)}`,
      `Change: ${r.summary}`,
      ``,
      what,
      ...(note ? [`Their note: ${note}`] : []),
      ...(link ? [``, `See the ${sh}: ${link}`] : []),
      ``,
      `CROP Workforce Management`,
    ].join('\n'),
  };
}
