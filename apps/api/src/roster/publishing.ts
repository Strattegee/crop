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
