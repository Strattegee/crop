/**
 * Standing teams (David, 5 Nov 2026): the business's own teams, each with a make-up of roles and named people.
 * Pure helpers for the Teams page (`(office)/teams`) and the person's Overview, tested in test/teams.test.ts.
 * Keep `MAX_ROLE_COUNT` in step with the API's (`apps/api/src/teams/teams.ts`).
 */

export const MAX_ROLE_COUNT = 99;
/** Blank lines the make-up form offers under the current ones. */
export const BLANK_MAKE_UP_LINES = 3;

export type MakeUpRow = { role: string; count: number };
export type TeamMember = {
  id: string; workerId: string; name: string; role: string; startsOn: string; endsOn: string | null; endReason: string | null;
  state: 'current' | 'upcoming' | 'ended'; away: 'on_leave' | 'not_active' | null; roleMissing: boolean;
};
export type Team = {
  id: string; name: string; description: string | null; active: boolean; roles: MakeUpRow[]; makeUpLine: string | null; needed: number;
  members: TeamMember[]; earlier: TeamMember[]; gaps: { role: string; needed: number; named: number; short: number; shortToday: number }[];
  shortLine: string | null; shortTodayLine: string | null;
  awayToday: { workerId: string; name: string; role: string; away: 'on_leave' | 'not_active' }[];
  counts: { current: number; upcoming: number };
};
export type PickPerson = { id: string; name: string; roles: string[] };

/**
 * The make-up from the form: lines `role_<n>` / `count_<n>` (a blank role or a count of 0 drops the line; the same
 * role twice adds up). The API checks the role names.
 */
export function makeUpFromForm(get: (key: string) => string | undefined, lines: number): MakeUpRow[] | { problem: string } {
  const out: MakeUpRow[] = [];
  for (let i = 0; i < lines; i++) {
    const role = get(`role_${i}`)?.trim();
    const raw = get(`count_${i}`)?.trim();
    if (!role) continue;
    const count = raw === undefined || raw === '' ? 1 : Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > MAX_ROLE_COUNT) return { problem: `How many ${role}: a whole number from 1 to ${MAX_ROLE_COUNT}` };
    if (count === 0) continue;
    const had = out.find(r => r.role === role);
    if (had) had.count = Math.min(MAX_ROLE_COUNT, had.count + count);
    else out.push({ role, count });
  }
  return out;
}

/** Why someone isn't there today, in plain words (never the leave kind). */
export const awayWords = (away: TeamMember['away']): string | null =>
  away === 'on_leave' ? 'Away today' : away === 'not_active' ? 'No longer active' : null;

/** "Away today: Cy Example (Plasterer)", or null. */
export function awayLine(t: Pick<Team, 'awayToday'>): string | null {
  const here = t.awayToday.filter(a => a.away === 'on_leave');
  return here.length ? `Away today: ${here.map(a => `${a.name} (${a.role})`).join(', ')}` : null;
}

/** "3 of 7 named", "7 named", or "No one yet". */
export function namedLine(t: Pick<Team, 'needed' | 'counts'>): string {
  const n = t.counts.current;
  if (!n && !t.counts.upcoming) return 'No one yet';
  const base = t.needed ? `${n} of ${t.needed} named` : `${n} named`;
  return t.counts.upcoming ? `${base} · ${t.counts.upcoming} starting later` : base;
}

/**
 * Who can be added, grouped by role for the picker: the make-up's roles first (those still short marked), then the
 * person's other roles. Only people who have the role, and not already on the team. Option value "workerId|role".
 */
export function pickerGroups(t: Pick<Team, 'roles' | 'members' | 'gaps'>, people: PickPerson[]): { role: string; label: string; options: { value: string; label: string }[] }[] {
  const on = new Set(t.members.map(m => m.workerId));
  const free = people.filter(p => !on.has(p.id));
  const others = [...new Set(free.flatMap(p => p.roles))].filter(r => !t.roles.some(m => m.role === r)).sort((a, b) => a.localeCompare(b));
  const groups = [...t.roles.map(r => r.role), ...others].map(role => {
    const short = t.gaps.find(g => g.role === role)?.short ?? 0;
    const options = free.filter(p => p.roles.includes(role)).sort((a, b) => a.name.localeCompare(b.name))
      .map(p => ({ value: `${p.id}|${role}`, label: p.name }));
    const label = t.roles.some(m => m.role === role) ? (short ? `${role} (short ${short})` : role) : `${role} (not in the make-up)`;
    return { role, label, options };
  });
  return groups.filter(g => g.options.length > 0);
}

/** Splits the picker's "workerId|role" value. */
export function splitPick(value: string | undefined): { workerId: string; role: string } | null {
  if (!value) return null;
  const at = value.indexOf('|');
  if (at <= 0 || at === value.length - 1) return null;
  return { workerId: value.slice(0, at), role: value.slice(at + 1) };
}

/** "Teams" filter in the URL: live (default), archived or all. */
export const teamFilter = (v: string | undefined): 'live' | 'archived' | 'all' => (v === 'archived' || v === 'all' ? v : 'live');
