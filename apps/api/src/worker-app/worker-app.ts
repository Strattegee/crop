/**
 * Worker app (backlog item 9): pure rules for what a signed-in person sees about their own work.
 * Data access is in worker-app.controller.ts.
 */
import { fmtDate } from '../roster/eligibility.js';
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export type AppAccessState = 'none' | 'invited' | 'active';

/** Whether a person can use the app: signed in and linked (active), invited and not yet signed in, or neither. */
export function appAccessState(a: { member: boolean; pendingInvite: boolean }): AppAccessState {
  if (a.member) return 'active';
  if (a.pendingInvite) return 'invited';
  return 'none';
}

/** How the app shows a shift the person is on: booked, or put on it and waiting for them to be confirmed. */
export type MyShiftState = 'booked' | 'to_confirm';
export function myShiftState(assignmentStatus: string): MyShiftState {
  return assignmentStatus === 'confirmed' ? 'booked' : 'to_confirm';
}

/** Said when the signed-in account isn't any person's in this business. */
export function notLinkedMessage(business: string): string {
  return `Your sign-in isn't linked to anyone at ${business} yet. Ask the office to give you access to the app.`;
}

/** A plain reason why the office can't give someone app access, or null when it can. */
export function appAccessRefusal(w: { status: string; email: string | null; name: string }): string | null {
  if (w.status === 'agency') return "Agency people use their agency's app, not this business's";
  if (!w.email) return `Add an email address for ${w.name} first: they sign in with it`;
  return null;
}

/**
 * Taking away someone's app access (David, 31 Oct: owners and admins can do it themselves). Refused when there is
 * nothing to take away, or when their sign-in is an office one here (that is changed in Platform, not here).
 */
export function removeAccessRefusal(a: { state: AppAccessState; memberRole: string | null; name: string }): string | null {
  if (a.state === 'none') return `${a.name} doesn't have the app`;
  if (a.memberRole && a.memberRole !== 'worker') return `${a.name} signs in to the office with this account, so their access is changed by CROP support, not here`;
  return null;
}

/** The range of days the app asks for, checked: at most 62 days, end not before start. */
export const MAX_MY_DAYS = 62;

/** How far ahead someone can change their availability or ask for leave in the app (days from today). */
export const MY_AHEAD_DAYS = 366;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Why a person can't change their availability for a date in the app, or null when they can. */
export function myDateRefusal(onDate: string, today: string): string | null {
  if (onDate < today) return 'Choose today or a later date';
  if (dayDiff(today, onDate) > MY_AHEAD_DAYS) return 'Choose a date within the next year';
  return null;
}

/** Why a person can't ask for this leave in the app, or null when they can. */
export function myLeaveRefusal(startsOn: string, endsOn: string, today: string): string | null {
  if (endsOn < startsOn) return 'The leave ends before it starts';
  if (startsOn < today) return 'Leave can start today at the earliest. For days already gone, contact the office.';
  if (dayDiff(today, startsOn) > MY_AHEAD_DAYS) return 'Ask for leave starting within the next year';
  if (dayDiff(startsOn, endsOn) > 366) return 'Leave can be at most a year at a time';
  return null;
}

/** Why a person can't withdraw their own leave in the app, or null when they can (only requests still waiting). */
export function myLeaveCancelRefusal(status: string): string | null {
  if (status === 'requested') return null;
  if (status === 'approved') return 'This leave is approved. Contact the office to cancel it.';
  return `This leave is already ${status}`;
}

// ---- My credentials (backlog item 9: credentials with upload) ----

/** How the app shows one of the person's credentials: checked by the office, waiting to be checked, or not accepted. */
export type MyCheckState = 'checked' | 'to_check' | 'not_accepted';
export function myCheckState(verification: string): MyCheckState {
  return verification === 'verified' ? 'checked' : verification === 'rejected' ? 'not_accepted' : 'to_check';
}

/** Most files someone can add to one credential from the app. */
export const MY_MAX_FILES = 10;

/** Why the person can't add a credential of this type in the app, or null when they can. */
export function myAddRefusal(a: { typeName: string; waiting: boolean }): string | null {
  if (a.waiting) return `You've already added a ${a.typeName} that the office hasn't checked yet. Add a photo or file to that one instead.`;
  return null;
}

/** Dates someone gives for their own credential: an expiry already gone or an issue date still to come are refused. */
export function myCredentialDatesRefusal(issueDate: string | null, expiryDate: string | null, today: string): string | null {
  if (issueDate && issueDate > today) return 'The issue date is in the future';
  if (expiryDate && expiryDate < today) return 'This has already run out. Add it once you have the new one.';
  return null;
}

/** Why the person can't add a photo or file to this credential in the app, or null when they can. */
export function myEvidenceRefusal(verification: string, files: number, word = 'credential'): string | null {
  if (verification === 'verified') return `The office has already checked this one. If you have a new one, add it as a new ${word}.`;
  if (verification === 'rejected') return `This one wasn't accepted. Add it again as a new ${word}, or contact the office.`;
  if (files >= MY_MAX_FILES) return `You can add up to ${MY_MAX_FILES} files to one ${word}`;
  return null;
}

/**
 * One line telling the person what they need to do about a requirement that isn't met (from workerCompliance's issues).
 * Right to work is recorded by the office, so the app only says to contact them. Vaccinations are named by their type,
 * which the person sees on their own phone only (never in a message).
 */
export function myNeedLine(i: { typeName: string; problem: string; credentialTypeId: string; forDuty?: string }): string {
  if (i.credentialTypeId === 'right-to-work') {
    return i.problem === 'unverified' ? 'Right to work: the office is checking it' : 'Right to work: please contact the office';
  }
  switch (i.problem) {
    case 'missing': return `Add your ${i.typeName}`;
    case 'rejected': return `Your ${i.typeName} wasn't accepted: add it again or contact the office`;
    case 'expired': return `Your ${i.typeName} has run out: add the new one`;
    case 'expiring': return `Your ${i.typeName} runs out soon: add the new one when you have it`;
    case 'unverified': return `${i.typeName}: waiting for the office to check it`;
    default: return `${i.typeName}: please contact the office`;
  }
}

/** Whether the person can do something about a requirement in the app (add or replace a credential). */
export function myNeedAddable(i: { problem: string; credentialTypeId: string }): boolean {
  return i.credentialTypeId !== 'right-to-work' && ['missing', 'rejected', 'expired', 'expiring'].includes(i.problem);
}

/**
 * Emails to the office when something arrives from the app (owners and admins, who decide leave and check credentials).
 * Never the leave kind or the person's note (it may hold health details), never a credential's number, and a
 * vaccination is only "a vaccination record". The person's name is fine: the email goes to their own business.
 */
const officeLink = (appUrl: string, path: string) => (appUrl ? `${appUrl.replace(/\/+$/, '')}${path}` : null);

export function appLeaveEmail(
  p: { name: string; workerId: string; startsOn: string; endsOn: string; shiftsDuring: number },
  appUrl: string, w: Words = DEFAULT_WORDS,
) {
  const days = p.startsOn === p.endsOn ? fmtDate(p.startsOn) : `${fmtDate(p.startsOn)} to ${fmtDate(p.endsOn)}`;
  const shifts = p.shiftsDuring === 0
    ? `They have no ${w.lower(T.shift, true)} on the ${w.lower(T.roster)} in those days.`
    : `${w.count(p.shiftsDuring, T.shift)} of theirs ${p.shiftsDuring === 1 ? 'falls' : 'fall'} in those days and will need cover if it is approved.`;
  const link = officeLink(appUrl, '/leave');
  return {
    subject: `Leave request from ${p.name}: ${days}`,
    body: [
      `${p.name} has asked for leave in the CROP app: ${days}.`,
      shifts,
      ``,
      link ? `To approve or decline it, open the Leave page: ${link}` : `To approve or decline it, open the Leave page in CROP.`,
      ``,
      `CROP Workforce Management`,
    ].join('\n'),
  };
}

export function appCredentialEmail(
  p: { name: string; workerId: string; typeName: string; category: string },
  appUrl: string, w: Words = DEFAULT_WORDS,
) {
  const what = p.category === 'vaccination' ? 'a vaccination record' : p.typeName;
  const link = officeLink(appUrl, `/workers/${p.workerId}`);
  return {
    subject: `${p.name} added ${p.category === 'vaccination' ? 'a vaccination record' : w.a(T.credential)} in the app`,
    body: [
      `${p.name} has added ${what} in the CROP app. It doesn't count until an owner or admin checks it.`,
      ``,
      link ? `To check it, open their page: ${link}` : `To check it, open their page in CROP.`,
      ``,
      `CROP Workforce Management`,
    ].join('\n'),
  };
}

// ---- Getting started (onboarding in the worker app, backlog item 11 "staff completing their own steps") ----

/** What the person sees about one onboarding step: done, sent and waiting for the office, or still to do. */
export type MyStepState = 'done' | 'waiting' | 'to_do';
export interface MyStep {
  id: string;
  title: string;
  kind: 'task' | 'credential' | 'right_to_work' | 'employment';
  required: boolean;
  state: MyStepState;
  /** Plain words for the person, e.g. "Add it in Credentials". */
  line: string;
  /** The person can do this step in the app (add a credential). */
  yours: boolean;
  credentialTypeId: string | null;
  /** For a credential step still to do: what is wrong (as in myNeedLine's problems). */
  need?: 'missing' | 'expired' | 'rejected';
}

/**
 * One onboarding step worded for the person themselves (the office's wording says who ticked it; this never does).
 * Tasks and employment terms are the office's; right to work is recorded by the office, so the person is told to
 * contact them; credentials they add in the app (`credentialsWord` is the business's word, e.g. "Credentials").
 * The office's tick notes and step help aren't shown: they are written for the office.
 */
export function myStep(
  s: { id: string; title: string; kind: MyStep['kind']; required: boolean; credentialTypeId: string | null; state: MyStepState; detail: string },
  credentialsWord = 'Credentials',
): MyStep {
  const base = { id: s.id, title: s.title, kind: s.kind, required: s.required, state: s.state, credentialTypeId: s.credentialTypeId, yours: false };
  if (s.state === 'done') return { ...base, line: s.kind === 'credential' || s.kind === 'right_to_work' ? 'Checked' : 'Done' };
  switch (s.kind) {
    case 'task': return { ...base, line: 'The office will tick this off' };
    case 'employment': return { ...base, line: 'The office will set up your employment' };
    case 'right_to_work':
      return { ...base, line: s.state === 'waiting' ? 'Sent: the office is checking it' : 'Please contact the office about your right to work' };
    case 'credential': {
      if (s.state === 'waiting') return { ...base, line: 'Sent: waiting for the office to check it' };
      const need = s.detail.startsWith('Has run out') ? 'expired' : s.detail.startsWith('Rejected') ? 'rejected' : 'missing';
      const why = need === 'expired' ? 'Yours has run out: add the new one' : need === 'rejected' ? 'Not accepted: add it again' : 'Add it';
      return { ...base, yours: true, need, line: `${why} in ${credentialsWord}` };
    }
  }
}

/** The heading line for the person's checklist, e.g. "3 of 5 done" or "All done: the office will let you know when you can start". */
export function myOnboardingLine(done: number, total: number): string {
  if (total === 0 || done >= total) return 'All done: the office will let you know when you can start';
  return `${done} of ${total} done`;
}
