/**
 * Worker app (backlog item 9): pure rules for what a signed-in person sees about their own work.
 * Data access is in worker-app.controller.ts.
 */

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
