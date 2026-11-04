/**
 * What each office role may use (David, 4 Nov 2026; migration 0086). Pure, tested. Keep in step with the API's
 * SITE_ROLES endpoints: supervisors get the dashboard and live numbers (business-wide), the roster at their sites,
 * their people (shift-related facts only) and their projects. Owners, admins and allocators get every screen they had.
 */

/** Function codes (lib/functions.ts) a supervisor can open. */
export const SUPERVISOR_CODES = [1000, 1100, 2000, 3000, 4200] as const;

export const isSupervisor = (role: string | null | undefined) => role === 'supervisor';

/** Whether someone with this role can open the screen with this function code. */
export function canUse(role: string | null | undefined, code: number): boolean {
  if (!isSupervisor(role)) return true;
  return (SUPERVISOR_CODES as readonly number[]).includes(code);
}

/** The person-page tabs a supervisor sees (no right-to-work details, employment, availability records or details). */
export const SUPERVISOR_PERSON_TABS = ['overview', 'credentials', 'shifts'] as const;

/** A line for the top of a screen when the person only sees some sites ("You see 2 sites: …"), or null. */
export function limitLine(sites: string[] | null | undefined, names: string[], siteWord: { one: string; many: string }): string | null {
  if (sites == null) return null;
  if (!sites.length) return `You haven't been given any ${siteWord.many} yet. Ask an owner or admin.`;
  const list = [...names].sort((a, b) => a.localeCompare(b));
  const words = list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `You see ${sites.length === 1 ? `1 ${siteWord.one}` : `${sites.length} ${siteWord.many}`}${words ? `: ${words}` : ''}`;
}
