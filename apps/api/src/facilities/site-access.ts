/**
 * Who works on which sites (David, 4 Nov 2026; migration 0086). Pure rules for Settings › Team access.
 *  - Owners and admins always see every site.
 *  - Allocators see every site unless sites are chosen for them.
 *  - Supervisors only ever see the sites chosen for them (none chosen = nothing to act on).
 */

export type OfficeRole = 'owner' | 'admin' | 'allocator' | 'supervisor';
export const LIMITABLE_ROLES = ['allocator', 'supervisor'] as const;
export type LimitableRole = (typeof LIMITABLE_ROLES)[number];

/** The sites someone may use: null = every site. Mirrors app_user_site_limits (migration 0086). */
export function sitesFor(role: string, chosen: string[]): string[] | null {
  if (role === 'supervisor') return chosen;
  if (role === 'allocator') return chosen.length ? chosen : null;
  return null;
}

/** Why a change to someone's role or sites can't be made, or null. `known` = the business's site ids. */
export function accessProblem(x: { currentRole: string; newRole: string | null; facilityIds: string[]; known: Set<string> }): string | null {
  const role = x.newRole ?? x.currentRole;
  if (x.newRole !== null && x.newRole !== x.currentRole) {
    if (!(LIMITABLE_ROLES as readonly string[]).includes(x.currentRole)) return 'Owners and admins are changed on the Platform screen';
    if (!(LIMITABLE_ROLES as readonly string[]).includes(x.newRole)) return 'Choose allocator or supervisor';
  }
  if (!(LIMITABLE_ROLES as readonly string[]).includes(role)) {
    return x.facilityIds.length ? 'Owners and admins always see every {site}' : null;
  }
  if (x.facilityIds.some(id => !x.known.has(id))) return 'Choose {sites} of this business';
  return null;
}

/** "Every site", "No sites yet" or the names in order ("Smith St and Jones Rd", "A, B and 2 more"). */
export function sitesWords(role: string, names: string[], words = { every: 'Every {site}', none: 'No {sites} yet' }): string {
  const sites = sitesFor(role, names);
  if (sites === null) return words.every;
  if (!sites.length) return words.none;
  const sorted = [...sites].sort((a, b) => a.localeCompare(b));
  if (sorted.length <= 3) return sorted.length === 1 ? sorted[0] : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
  return `${sorted.slice(0, 2).join(', ')} and ${sorted.length - 2} more`;
}

/** The set change: rows to add and remove. */
export function siteChanges(current: string[], wanted: string[]): { add: string[]; remove: string[] } {
  const now = new Set(current);
  const want = new Set(wanted);
  return { add: [...want].filter(id => !now.has(id)), remove: [...now].filter(id => !want.has(id)) };
}
