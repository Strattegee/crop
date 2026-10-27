import type { Actor } from '@crop/db';
import type { AuthContext } from '../auth/auth.types.js';
import { addDays } from '../workforce/compliance.js';

/**
 * Draft → Live → History (backlog item 2, migration 0022). A site's week is a draft until it is published,
 * live once published, and history once the week is over in the site's time zone (published or not).
 */
export type WeekState = 'draft' | 'live' | 'history';

export function weekState(weekStart: string, published: boolean, today: string): WeekState {
  if (addDays(weekStart, 6) < today) return 'history';
  return published ? 'live' : 'draft';
}

/** The Monday of the week a date is in. */
export function mondayOf(date: string): string {
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, -wd);
}

/** The person making a change, for the shift change log. */
export function actorOf(auth: AuthContext): Actor {
  return { id: auth.userId, name: auth.displayName || auth.email, via: 'office', role: auth.tenant?.role ?? null };
}

export type ChangeKind = 'created' | 'assigned' | 'booked' | 'confirmed' | 'unassigned' | 'pulled_out' | 'cancelled'
  | 'equipment_added' | 'equipment_removed' | 'times_changed' | 'notes_changed';

/** One line of the change log in plain English. Never includes leave kinds or credential details. */
export function changeSummary(c: { kind: ChangeKind; workerName: string | null; equipmentName: string | null; detail: string | null; via: string }): string {
  const who = c.workerName ?? 'Someone';
  const what = c.equipmentName ?? 'Equipment';
  switch (c.kind) {
    case 'created': return 'Shift added';
    case 'assigned': return `${who} put on the shift`;
    case 'booked': return c.via === 'link' ? `${who} accepted the offer (reply link) and is booked` : `${who} booked`;
    case 'confirmed': return `${who} confirmed`;
    case 'unassigned': return `${who} taken off the shift`;
    case 'pulled_out': return `${who} pulled out`;
    case 'cancelled': return c.detail ? `Shift cancelled: ${c.detail}` : 'Shift cancelled';
    case 'equipment_added': return `${what} booked`;
    case 'equipment_removed': return `${what} taken off the shift`;
    case 'times_changed': return 'Times changed';
    case 'notes_changed': return 'Notes changed';
  }
}

/** What may change once a week is published (tenant_settings.published_changes, migration 0024). */
export type PublishedChanges = 'open' | 'managers' | 'locked';
export const PUBLISHED_CHANGES: PublishedChanges[] = ['open', 'managers', 'locked'];

/** The rule in plain words, for the roster's status bar and Settings. */
export function publishedChangesLabel(rule: PublishedChanges): string {
  switch (rule) {
    case 'open': return 'Anyone in the office can make changes; every change is recorded';
    case 'managers': return 'Only owners and admins can make changes';
    case 'locked': return 'Changes are turned off';
  }
}

/** The database's code for a change refused by the business's after-publishing rule (migration 0024). */
export const ROSTER_LOCKED = 'CRLK1';

/** One of a person's shifts, as told to them when a week is published. */
export interface MyShift { localDate: string; localStart: string; localEnd: string; role: string; areaName: string | null; confirmed: boolean }

const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');
const shortDay = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');
const hm = (t: string) => t.replace(/^0(\d)/, '$1');

/**
 * The message a person gets when their week is published (David and Steve, 27 Oct: yes), or when it is
 * published again after changes that affect them. Shift times and roles only: never health or credential details.
 */
export function rosterMessage(o: {
  first: string; business: string; site: string; weekStart: string; shifts: MyShift[]; updated: boolean;
}) {
  const week = dayLabel(o.weekStart);
  const lines = o.shifts.map(s => `- ${dayLabel(s.localDate)}, ${hm(s.localStart)}–${hm(s.localEnd)}: ${s.role}${s.areaName ? ` (${s.areaName})` : ''}${s.confirmed ? '' : ' (please confirm with the office)'}`);
  const subject = o.updated
    ? `Your shifts at ${o.site} for the week of ${week} have changed`
    : `Your shifts at ${o.site} for the week of ${week}`;
  const intro = o.updated
    ? `${o.business} has changed the roster for ${o.site}, week of ${week}.`
    : `${o.business} has published the roster for ${o.site}, week of ${week}.`;
  const body = o.shifts.length
    ? `${o.updated ? 'Your shifts that week are now' : 'Your shifts'}:\n${lines.join('\n')}`
    : `You no longer have any shifts at ${o.site} that week.`;
  const email = [`Hi ${o.first},`, '', intro, '', body, '', `If you can't work any of these, contact ${o.business} as soon as you can.`].join('\n');
  const listed = o.shifts.slice(0, 5).map(s => `${shortDay(s.localDate)} ${hm(s.localStart)}-${hm(s.localEnd)}`).join(', ');
  const more = o.shifts.length > 5 ? ` +${o.shifts.length - 5} more (see email)` : '';
  const sms = o.shifts.length
    ? `${o.business}: ${o.updated ? 'your shifts have changed. Now' : 'your shifts'} at ${o.site}, wk of ${week}: ${listed}${more}.`
    : `${o.business}: you no longer have shifts at ${o.site} in the week of ${week}.`;
  return { subject, email, sms };
}
