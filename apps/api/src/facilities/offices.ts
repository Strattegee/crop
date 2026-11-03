/**
 * Offices (David, 3 Nov 2026, answer 1): a business's branches. Each site belongs to at most one office; office
 * people can be attached to offices. Pure rules: no database access.
 */

/** What the Allocations queue filters on: every office, the caller's offices, sites with no office, or one office. */
export type OfficeFilter = { kind: 'all' } | { kind: 'mine' } | { kind: 'none' } | { kind: 'one'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads `?office=`: `all`, `mine`, `none` or an office id. Left out, someone attached to offices sees theirs
 * (`mine`), everyone else sees all. Anything else is "all".
 */
export function parseOfficeFilter(v: string | undefined, hasOffices: boolean): OfficeFilter {
  const s = v?.trim().toLowerCase();
  if (!s) return hasOffices ? { kind: 'mine' } : { kind: 'all' };
  if (s === 'mine') return hasOffices ? { kind: 'mine' } : { kind: 'all' };
  if (s === 'none') return { kind: 'none' };
  if (UUID.test(s)) return { kind: 'one', id: s };
  return { kind: 'all' };
}

/** The filter as the URL value (`null` for "all"). */
export const officeParam = (f: OfficeFilter): string | null => (f.kind === 'all' ? null : f.kind === 'one' ? f.id : f.kind);

/** Whether a row whose site is in `officeId` passes the filter. */
export function inOffice(f: OfficeFilter, officeId: string | null, mine: ReadonlySet<string>): boolean {
  switch (f.kind) {
    case 'all': return true;
    case 'none': return officeId === null;
    case 'mine': return officeId !== null && mine.has(officeId);
    case 'one': return officeId === f.id;
  }
}

export interface OfficeChip { id: string; name: string; count: number; mine: boolean }

/**
 * The queue's office chips: the caller's offices first, then the rest by name; only offices that are active or still
 * have rows. `noOffice` counts rows at sites without one (shown as "No office" when above nought).
 */
export function officeChips(
  offices: readonly { id: string; name: string; active: boolean }[], rows: readonly { officeId: string | null }[], mine: ReadonlySet<string>,
): { offices: OfficeChip[]; noOffice: number } {
  const count = (id: string | null) => rows.filter(r => r.officeId === id).length;
  const chips = offices
    .map(o => ({ id: o.id, name: o.name, count: count(o.id), mine: mine.has(o.id), active: o.active }))
    .filter(o => o.active || o.count > 0)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name))
    .map(({ active: _a, ...o }) => o);
  return { offices: chips, noOffice: count(null) };
}

/** Problems with a set of people for an office: everyone must be one of the business's office people. */
export function peopleProblem(userIds: readonly string[], officePeople: ReadonlySet<string>): string | null {
  if (userIds.some(id => !UUID.test(id))) return 'Choose people from your office';
  if (userIds.some(id => !officePeople.has(id))) return 'Only owners, administrators and allocators can belong to an office';
  return null;
}
