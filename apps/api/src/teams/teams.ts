/**
 * Standing teams (David, 5 Nov 2026; migration 0092): groups of people the business keeps together over time, outside
 * any project. A team has a make-up (how many of each role it needs; exact role names, like credential rules) and
 * named people, each in one of their roles. The named people are the normal case; the make-up shows which trade is
 * missing when someone is away or leaves. Pure rules, tested in test/teams.spec.ts.
 */
import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';

export interface MakeUpRow { role: string; count: number }

/** Most roles in one team's make-up, and most of one role. */
export const MAX_MAKE_UP_ROLES = 40;
export const MAX_ROLE_COUNT = 99;

/**
 * The make-up from a request body (`roles: [{role, count}]`; [] = no make-up). `known` are the business's role names
 * (its role list and the roles its people have). Returns the rows in a steady order, or a plain problem.
 */
export function parseMakeUp(value: unknown, known: string[], w: Words = DEFAULT_WORDS): { roles: MakeUpRow[] } | { problem: string } {
  if (!Array.isArray(value)) return { problem: `Give the ${w.lower(T.role, true)} as a list` };
  if (value.length > MAX_MAKE_UP_ROLES) return { problem: `Up to ${MAX_MAKE_UP_ROLES} ${w.lower(T.role, true)} in one ${w.lower(T.team)}` };
  const out: MakeUpRow[] = [];
  for (const v of value) {
    const role = v && typeof v === 'object' && typeof (v as { role?: unknown }).role === 'string' ? (v as { role: string }).role.trim() : '';
    if (!role) return { problem: `Choose a ${w.lower(T.role)} for each line` };
    if (!known.includes(role)) return { problem: `${role} isn't one of your ${w.lower(T.role, true)}` };
    const count = (v as { count?: unknown }).count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_ROLE_COUNT) {
      return { problem: `How many ${role}: a whole number from 1 to ${MAX_ROLE_COUNT}` };
    }
    if (out.some(r => r.role === role)) return { problem: `${role} is listed twice` };
    out.push({ role, count });
  }
  return { roles: out };
}

/** Facts about a person being added to a team. */
export interface JoinFacts { name: string; status: string; roles: string[] }

/** Why this person can't join a team in this role, or null. Only active people, and only in a role they have. */
export function joinRefusal(p: JoinFacts, role: string, w: Words = DEFAULT_WORDS): string | null {
  if (p.status !== 'active') return `Only active ${w.lower(T.worker, true)} can join a ${w.lower(T.team)}. ${p.name} isn't active.`;
  if (!role.trim()) return `Choose the ${w.lower(T.role)} they fill in the ${w.lower(T.team)}`;
  if (!p.roles.includes(role)) return `${p.name} doesn't have the ${w.lower(T.role)} ${role}. Add it on their page first.`;
  return null;
}

/** "current" (on the team today), "upcoming" (starts later) or "ended". */
export type MemberState = 'current' | 'upcoming' | 'ended';
export function memberState(from: string, to: string | null, today: string): MemberState {
  if (from > today) return 'upcoming';
  if (to !== null && to < today) return 'ended';
  return 'current';
}

/** One person's place for the gap count. `available` = active and not on approved leave today. */
export interface MemberFact { role: string; state: MemberState; active: boolean; onLeave: boolean }

export interface RoleGap { role: string; needed: number; named: number; here: number; short: number; shortToday: number }

/**
 * Per role of the make-up: how many are needed, named (current members still active), here today (named and not on
 * leave), and how many short. `short` = a place nobody fills (someone left); `shortToday` adds people away today.
 * Members in roles outside the make-up don't fill a gap (rules match roles exactly).
 */
export function teamGaps(makeUp: MakeUpRow[], members: MemberFact[]): RoleGap[] {
  return makeUp.map(m => {
    const mine = members.filter(x => x.role === m.role && x.state === 'current' && x.active);
    const named = mine.length;
    const here = mine.filter(x => !x.onLeave).length;
    return { role: m.role, needed: m.count, named, here, short: Math.max(0, m.count - named), shortToday: Math.max(0, m.count - here) };
  });
}

const counted = (rows: { role: string; n: number }[]) => rows.filter(r => r.n > 0).map(r => `${r.n} ${r.role}`).join(', ');

/** "2 Carpenter · 2 Plasterer · 1 Painter", or null with no make-up. */
export function makeUpLine(makeUp: MakeUpRow[]): string | null {
  return makeUp.length ? makeUp.map(r => `${r.count} ${r.role}`).join(' · ') : null;
}

/** "Short: 1 Painter, 2 Cleaner" (places nobody fills), or null. */
export function shortLine(gaps: RoleGap[]): string | null {
  const s = counted(gaps.map(g => ({ role: g.role, n: g.short })));
  return s ? `Short: ${s}` : null;
}

/** "Short today: 1 Carpenter" (places not filled today, including people away), only when it differs from `shortLine`. */
export function shortTodayLine(gaps: RoleGap[]): string | null {
  if (gaps.every(g => g.shortToday === g.short)) return null;
  const s = counted(gaps.map(g => ({ role: g.role, n: g.shortToday })));
  return s ? `Short today: ${s}` : null;
}

/** The make-up and the people, sorted the same way everywhere: make-up order, then roles outside it by name, then name. */
export function sortMembers<M extends { role: string; name: string }>(members: M[], makeUp: MakeUpRow[]): M[] {
  const at = (role: string) => { const i = makeUp.findIndex(r => r.role === role); return i < 0 ? makeUp.length : i; };
  return [...members].sort((a, b) => at(a.role) - at(b.role) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

/** The last day for someone leaving a team, from the request (`lastDay`) or yesterday; null = a mistaken entry to remove. */
export function leaving(startsOn: string, today: string, lastDay: string | null, yesterday: string): { endsOn: string } | { remove: true } | { problem: string } {
  if (lastDay !== null) {
    if (lastDay < startsOn) return { problem: 'Their last day can’t be before they joined' };
    return { endsOn: lastDay };
  }
  if (startsOn >= today) return { remove: true };
  return { endsOn: yesterday };
}
