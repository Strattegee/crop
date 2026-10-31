import { DEFAULT_WORDS, T, type Words } from '../terms/words.js';
import { genderRequestWords, localDay, localWhen } from './requests.js';

/**
 * Agencies not on CROP (migration 0059; David's answer 4, 29 Oct): the email that lists everything a shift needs.
 * "All standard requirements for the position are noted with a section of special requirements if any. The email
 * should also note on each requirement what is optional or ideal." The agency replies outside CROP.
 */

export type Level = 'hard' | 'warning' | 'optional';
/** One rule that applies to the shift: from the role (`forDuty` null) or from something on this shift (a duty, equipment). */
export type RuleRow = { name: string; severity: Level; forDuty: string | null };
export type ListedRequirement = { name: string; level: Level; levelWords: string; forWhat: string | null };

/** David's words for agencies: must have, ideal (should have), optional. */
export const LEVEL_WORDS: Record<Level, string> = { hard: 'Must have', warning: 'Ideal', optional: 'Optional' };
const RANK: Record<Level, number> = { hard: 1, warning: 2, optional: 3 };

/**
 * Splits a shift's rules into the role's standard requirements and the shift's special ones. Each credential is
 * listed once, at the strongest level it is needed at: under standard when the role already needs it at least as
 * strongly, otherwise under special with what it is for. Must haves first, then by name.
 */
export function outsideRequirements(rows: RuleRow[]): { standard: ListedRequirement[]; special: ListedRequirement[] } {
  const role = new Map<string, Level>();
  const extra = new Map<string, { level: Level; forWhat: string[] }>();
  for (const r of rows) {
    if (r.forDuty === null) {
      const had = role.get(r.name);
      if (!had || RANK[r.severity] < RANK[had]) role.set(r.name, r.severity);
    } else {
      const had = extra.get(r.name);
      if (!had) extra.set(r.name, { level: r.severity, forWhat: [r.forDuty] });
      else {
        if (RANK[r.severity] < RANK[had.level]) had.level = r.severity;
        if (!had.forWhat.includes(r.forDuty)) had.forWhat.push(r.forDuty);
      }
    }
  }
  const order = (a: ListedRequirement, b: ListedRequirement) => RANK[a.level] - RANK[b.level] || a.name.localeCompare(b.name);
  const standard: ListedRequirement[] = [];
  const special: ListedRequirement[] = [];
  for (const [name, level] of role) {
    const x = extra.get(name);
    if (x && RANK[x.level] < RANK[level]) continue; // needed more strongly for this shift: listed under special
    standard.push({ name, level, levelWords: LEVEL_WORDS[level], forWhat: null });
  }
  for (const [name, x] of extra) {
    const r = role.get(name);
    if (r && RANK[r] <= RANK[x.level]) continue;
    special.push({ name, level: x.level, levelWords: LEVEL_WORDS[x.level], forWhat: [...x.forWhat].sort().join(', ') });
  }
  return { standard: standard.sort(order), special: special.sort(order) };
}

export type OutsideShift = {
  businessName: string; siteName: string; siteTimezone: string; areaName: string | null; role: string;
  startsAt: Date; endsAt: Date; breakMinutes: number; duties: string[]; genderRequested: 'F' | 'M' | null;
};

/**
 * The email to an agency that doesn't use CROP. Names the shift, what the role needs and what this shift needs on
 * top, and who to reply to. No people and nothing private: requirements are the business's rules, not anyone's records.
 */
export function outsideAgencyEmail(
  s: OutsideShift, reqs: { standard: ListedRequirement[]; special: ListedRequirement[] },
  opts: { agencyName: string; note: string | null; replyName: string | null; replyEmail: string | null }, w: Words = DEFAULT_WORDS,
) {
  const where = [s.areaName, s.siteName].filter(Boolean).join(', ');
  const line = (r: ListedRequirement) => `- ${r.name}: ${r.levelWords.toLowerCase()}${r.forWhat ? ` (for ${r.forWhat})` : ''}`;
  const gender = genderRequestWords(s.genderRequested);
  const special = [
    ...reqs.special.map(line),
    ...(s.duties.length ? [`- Duties on this ${w.lower(T.shift)}: ${s.duties.join(', ')}`] : []),
    ...(gender ? [`- ${gender}`] : []),
  ];
  const replyTo = opts.replyName && opts.replyEmail ? `${opts.replyName} at ${opts.replyEmail}` : opts.replyEmail ?? null;
  const lines = [
    `Hello ${opts.agencyName},`,
    '',
    `${s.businessName} is looking for someone to fill this ${w.lower(T.shift)}:`,
    '',
    `${s.role} at ${where}`,
    localWhen(s) + (s.breakMinutes ? ` (${s.breakMinutes} minute break)` : ''),
    '',
    `Standard requirements for a ${s.role}:`,
    ...(reqs.standard.length ? reqs.standard.map(line) : ['- None recorded']),
    ...(special.length ? ['', `Special requirements for this ${w.lower(T.shift)}:`, ...special] : []),
    '',
    'Must have: the person can only work it with this. Ideal: preferred. Optional: good to have.',
    ...(opts.note ? ['', `Note from ${s.businessName}: ${opts.note}`] : []),
    '',
    replyTo
      ? `If you can fill it, please reply to ${replyTo} with the person's name and confirm they meet the must haves. Please don't reply to this email.`
      : `If you can fill it, please contact ${s.businessName} with the person's name and confirm they meet the must haves. Please don't reply to this email.`,
    `It may already be filled by the time you reply; ${s.businessName} will confirm.`,
  ];
  return { subject: `${s.businessName}: ${s.role} on ${localDay(s.startsAt, s.siteTimezone)}`, body: lines.join('\n') };
}

/** Why a shift can't be emailed to outside agencies now, or null. */
export function outsideProblem(shift: { status: string; equipmentOnly: boolean; startsAt: Date }, agencies: number, now: Date, w: Words = DEFAULT_WORDS): string | null {
  const s = w.lower(T.shift);
  if (shift.status === 'cancelled') return `This ${s} has been cancelled`;
  if (shift.equipmentOnly) return `Nobody works an equipment-only ${s}`;
  if (shift.status !== 'open') return `Someone is already on this ${s}`;
  if (shift.startsAt.getTime() <= now.getTime()) return `This ${s} has already started`;
  if (agencies === 0) return `Add the ${w.lower(T.agency, true)} you use that aren't on CROP in Settings → ${w.many(T.agency)}.`;
  return null;
}

/** The same agency isn't emailed about the same shift twice within this many minutes (a double press). */
export const RESEND_MINUTES = 10;
