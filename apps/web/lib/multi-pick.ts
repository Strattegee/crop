import type { IndustryGroup } from './industry-groups';

/**
 * A compact multi-select drop-down (David, 7 Nov: the application form was too long with every role and ticket as a
 * tick box). The component is `app/apply/[slug]/multi-pick.tsx`; these pure rules are tested in test/multi-pick.test.ts.
 */

export type PickItem = { value: string; label: string };
export type PickGroup = { key: string; label: string; items: PickItem[] };
export type PickNoun = { one: string; many: string };

/** Industry groups (lib/industry-groups.ts) as drop-down groups. */
export function pickGroups<T>(groups: IndustryGroup<T>[], item: (x: T) => PickItem): PickGroup[] {
  return groups.map(g => ({ key: g.key, label: g.label, items: g.items.map(item) }));
}

/** Lower case without accents, so "creche" finds "Crèche". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every word typed appears somewhere in the label (or the group's name), in any order. Blank matches everything. */
export function matchesSearch(label: string, query: string, group = ''): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${fold(label)} ${fold(group)}`;
  return words.every(w => hay.includes(w));
}

/** The values to show for a search, and how many there are. Hidden ones stay in the form so ticks still post. */
export function visibleValues(groups: PickGroup[], query: string): Set<string> {
  const out = new Set<string>();
  for (const g of groups) for (const i of g.items) if (matchesSearch(i.label, query, g.label)) out.add(i.value);
  return out;
}

/** Chosen items in the order they appear in the list (not the order they were ticked), each once. */
export function chosenItems(groups: PickGroup[], chosen: Iterable<string>): PickItem[] {
  const want = new Set(chosen);
  const seen = new Set<string>();
  const out: PickItem[] = [];
  for (const g of groups) for (const i of g.items) {
    if (want.has(i.value) && !seen.has(i.value)) { seen.add(i.value); out.push(i); }
  }
  return out;
}

/** Ticks or unticks one value. */
export const toggle = (chosen: string[], value: string) =>
  chosen.includes(value) ? chosen.filter(v => v !== value) : [...chosen, value];

/** The drop-down button: "Choose roles" or "3 roles chosen". */
export function pickButtonLabel(count: number, noun: PickNoun): string {
  if (!count) return `Choose ${noun.many}`;
  return `${count} ${count === 1 ? noun.one : noun.many} chosen`;
}

/** Said when a search finds nothing. */
export const noMatchLine = (query: string, noun: PickNoun) => `No ${noun.many} match “${query.trim()}”.`;

/** A chip's remove button, for screen readers. */
export const removeLabel = (label: string) => `Remove ${label}`;

/** A file's name shortened for a small button: keeps the extension. */
export function shortFileName(name: string, max = 28): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}

/** Capital first letter, for a business word used at the start of a label. */
export const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
