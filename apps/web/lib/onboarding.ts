/**
 * Onboarding checklists chosen by role. The same rule as the API's `checklistForRoles`
 * (apps/api/src/workforce/onboarding.ts): the checklist written for the most of the person's roles (roles match
 * exactly), else one for anyone, alphabetically on ties; none when every checklist is for other roles.
 */
export type ChecklistChoice = { id: string; name: string; forRoles?: string[] };

export function suggestedChecklist<C extends ChecklistChoice>(checklists: C[], roles: string[]): C | null {
  const mine = new Set(roles);
  const byName = (a: C, b: C) => a.name.localeCompare(b.name);
  const scored = checklists
    .filter(c => c.forRoles?.length)
    .map(c => ({ c, n: c.forRoles!.filter(r => mine.has(r)).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || byName(a.c, b.c));
  if (scored.length) return scored[0].c;
  return checklists.filter(c => !c.forRoles?.length).sort(byName)[0] ?? null;
}

/** "Kitchen starter (for Chef)" in pickers; plain name when it's for anyone. */
export function checklistOption(c: ChecklistChoice): string {
  return c.forRoles?.length ? `${c.name} (for ${listWords(c.forRoles)})` : c.name;
}

/** "For anyone" / "For Chef and Kitchen hand" on the settings page. */
export function forRolesLine(forRoles: string[] | undefined): string {
  return forRoles?.length ? `For ${listWords(forRoles)}` : 'For anyone';
}

/** Roles typed as "Chef, Kitchen hand": trimmed and kept exactly as written (rules match roles exactly). */
export function parseRoles(typed: string | undefined | null): string[] {
  return [...new Set((typed ?? '').split(',').map(r => r.trim()).filter(Boolean))];
}

function listWords(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
