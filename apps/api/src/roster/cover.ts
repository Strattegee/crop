/**
 * Cover rules (migration 0030): "whenever anyone is working at a site, at least one of them holds a <credential>",
 * for example a food safety supervisor on every shift. Pure rules here; the data comes from `cover-data.ts`.
 *
 * A rule is met by the people on shift together, so it never blocks assigning one person. Instead the gaps (times
 * when someone is working at the site but nobody working holds the credential) are listed for the office.
 * Only people on a shift count (assigned or confirmed); open shifts already show in Needs attention.
 */

export interface CoverShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** The person on it holds the credential (verified, current on the shift's local date). */
  holds: boolean;
}

export interface CoverGap {
  from: Date;
  to: Date;
  /** Shifts being worked during the gap, earliest start first. */
  shiftIds: string[];
}

/**
 * Times when at least one shift is being worked but no shift worked by a holder covers it. Touching or
 * overlapping uncovered stretches are joined; gaps are returned in time order.
 */
export function coverGaps(shifts: CoverShift[]): CoverGap[] {
  const valid = shifts.filter(s => s.endsAt.getTime() > s.startsAt.getTime());
  const times = [...new Set(valid.flatMap(s => [s.startsAt.getTime(), s.endsAt.getTime()]))].sort((a, b) => a - b);
  const covers = (s: CoverShift, a: number, b: number) => s.startsAt.getTime() <= a && s.endsAt.getTime() >= b;
  const raw: Array<{ from: number; to: number }> = [];
  for (let i = 0; i + 1 < times.length; i++) {
    const [a, b] = [times[i], times[i + 1]];
    const working = valid.filter(s => covers(s, a, b));
    if (!working.length || working.some(s => s.holds)) continue;
    const last = raw[raw.length - 1];
    if (last && last.to === a) last.to = b;
    else raw.push({ from: a, to: b });
  }
  return raw.map(g => ({
    from: new Date(g.from),
    to: new Date(g.to),
    shiftIds: valid
      .filter(s => s.startsAt.getTime() < g.to && s.endsAt.getTime() > g.from)
      .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.id.localeCompare(y.id))
      .map(s => s.id),
  }));
}

/** "a Food Safety Supervisor" / "an RSA": the article for a credential's name. */
export function withArticle(name: string): string {
  return /^[aeiou]/i.test(name) || /^[FHLMNRSX][A-Z0-9]/.test(name) ? `an ${name}` : `a ${name}`;
}

/** The Needs attention wording for a gap. */
export function coverGapWords(typeName: string, facilityName: string, localFrom: string, localTo: string) {
  return {
    title: `Nobody with ${withArticle(typeName)} working ${localFrom}–${localTo}`,
    detail: `${facilityName} needs someone with ${withArticle(typeName)} on whenever anyone is working there`,
  };
}
