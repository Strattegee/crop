/**
 * Grouping by industry (David, 31 Oct): credentials, roles, duties, equipment types and items are shown under the
 * industries the business works in (the industry templates it applied), so a café doesn't wade through nursing
 * registrations. Pure, tested in test/industry-groups.test.ts.
 */
export type PackInfo = { id: string; name: string; appliedAt: string | null };
export type IndustryGroup<T> = { key: string; label: string; items: T[] };

export const SHARED_LABEL = 'Across your industries';
export const OWN_LABEL = 'Added by you';
export const NOT_YOURS = 'not one of your industries';
export const COMMON_LABEL = 'Common to several industries';

/**
 * Groups in this order: each industry the business uses (template order), then things shared by several of them,
 * then the business's own, then things common to several other industries, then each other industry by name
 * (marked "not one of your industries" once the business has picked any). Empty groups are left out.
 */
export function industryGroups<T extends { industries?: string[] }>(list: T[], packs: PackInfo[]): IndustryGroup<T>[] {
  const applied = packs.filter(p => p.appliedAt);
  const groups = new Map<string, IndustryGroup<T>>();
  for (const p of applied) groups.set(p.id, { key: p.id, label: p.name, items: [] });
  groups.set('shared', { key: 'shared', label: SHARED_LABEL, items: [] });
  groups.set('own', { key: 'own', label: OWN_LABEL, items: [] });
  groups.set('common', { key: 'common', label: COMMON_LABEL, items: [] });
  for (const p of packs.filter(p => !p.appliedAt)) {
    groups.set(p.id, { key: p.id, label: applied.length ? `${p.name} (${NOT_YOURS})` : p.name, items: [] });
  }
  for (const x of list) {
    const ind = x.industries ?? [];
    const hits = applied.filter(p => ind.includes(p.id));
    const others = ind.filter(i => groups.has(i));
    const key = hits.length === 1 ? hits[0].id : hits.length > 1 ? 'shared'
      : others.length > 1 ? 'common' : others[0] ?? 'own';
    groups.get(key)!.items.push(x);
  }
  return [...groups.values()].filter(g => g.items.length > 0);
}

/** When everything falls in one group a heading adds nothing. */
export const needsHeadings = <T>(groups: IndustryGroup<T>[]) => groups.length > 1;
