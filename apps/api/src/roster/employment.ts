/**
 * Rules for correcting employment terms (pure, unit-tested). Terms are effective-dated: each live term ends the day
 * before the next one starts. A correction never overwrites a row; the controller withdraws it and inserts a new one,
 * and these functions say what else has to move so the dates still join up.
 */
export type TermDates = { id: string; startsOn: string; endsOn: string | null; endReason?: string | null };

export type Plan =
  | { ok: true; previousId: string | null; previousEndsOn: string | null }
  | { ok: false; message: string };

/** Live terms, latest start first. */
function ordered(terms: TermDates[]) {
  return [...terms].sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}

export function dayBefore(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Correcting a term's type or hours keeps its dates. Moving its start date is only allowed for the latest term
 * (later terms would otherwise overlap or leave a gap), and the new date must come after the previous term started;
 * the previous term then ends the day before the new date.
 */
export function correctionPlan(terms: TermDates[], id: string, newStartsOn: string | null): Plan {
  const list = ordered(terms);
  const i = list.findIndex(t => t.id === id);
  if (i < 0) return { ok: false, message: 'Those employment terms have already been corrected or withdrawn' };
  const term = list[i];
  const previous = list[i + 1] ?? null;
  if (newStartsOn === null || newStartsOn === term.startsOn) return { ok: true, previousId: null, previousEndsOn: null };
  if (i > 0) return { ok: false, message: 'Only the latest employment terms can start on a different date; correct or withdraw the later ones first' };
  // After a gap (they left and came back), the earlier employment keeps its own end; the new start only has to follow it.
  if (previous && previous.endsOn !== null && previous.endsOn < dayBefore(term.startsOn)) {
    if (newStartsOn <= previous.endsOn) return { ok: false, message: `The start date must be after their earlier employment ended (${previous.endsOn})` };
    return { ok: true, previousId: null, previousEndsOn: null };
  }
  if (previous && newStartsOn <= previous.startsOn) {
    return { ok: false, message: `The start date must be after the previous terms started (${previous.startsOn})` };
  }
  return { ok: true, previousId: previous?.id ?? null, previousEndsOn: previous ? dayBefore(newStartsOn) : null };
}

/** Withdrawing a mistaken entry: only the latest term, and the one before it carries on (no end date) again. */
export function withdrawalPlan(terms: TermDates[], id: string): Plan {
  const list = ordered(terms);
  const i = list.findIndex(t => t.id === id);
  if (i < 0) return { ok: false, message: 'Those employment terms have already been corrected or withdrawn' };
  if (i > 0) return { ok: false, message: 'Only the latest employment terms can be withdrawn' };
  const previous = list[1] ?? null;
  // Only terms that ran straight into the withdrawn ones carry on; an earlier employment that ended before a gap stays ended.
  if (previous && previous.endsOn !== null && previous.endsOn !== dayBefore(list[0].startsOn)) return { ok: true, previousId: null, previousEndsOn: null };
  return { ok: true, previousId: previous?.id ?? null, previousEndsOn: list[0].endsOn };
}

export const END_REASONS = ['resigned', 'contract_ended', 'terminated', 'retired', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];

/** Ending employment: the latest terms get the last day, which can't be before they started; one end at a time. */
export function endPlan(terms: TermDates[], lastDay: string): { ok: true; id: string } | { ok: false; message: string } {
  const latest = ordered(terms)[0];
  if (!latest) return { ok: false, message: 'Record their employment before ending it' };
  if (latest.endsOn !== null && latest.endReason) return { ok: false, message: `Their employment already ends on ${latest.endsOn}; undo that first to change it` };
  if (latest.endsOn !== null) return { ok: false, message: `Their latest terms already end on ${latest.endsOn}` };
  if (lastDay < latest.startsOn) {
    return { ok: false, message: `The last day can't be before their latest terms start (${latest.startsOn}); withdraw those terms first` };
  }
  return { ok: true, id: latest.id };
}

/**
 * Whether someone is employed on a date, from their live terms (pure). No terms recorded means nothing to check.
 * After the end of employment, or in a gap between two spells, is a hard block; before their first terms start is
 * only a warning (terms are often entered from the day they were recorded, not the day the person started).
 */
export function employmentReason(name: string, onDate: string, terms: TermDates[]): { hard: boolean; message: string } | null {
  if (!terms.length) return null;
  if (terms.some(t => t.startsOn <= onDate && (t.endsOn === null || t.endsOn >= onDate))) return null;
  const list = ordered(terms);
  const first = list[list.length - 1];
  if (onDate < first.startsOn) return { hard: false, message: `${name}'s employment is only recorded from ${fmt(first.startsOn)}` };
  const before = list.find(t => t.startsOn <= onDate)!;
  return { hard: true, message: `${name}'s employment ended on ${fmt(before.endsOn!)}` };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Fri 30 Oct 2026". */
export const fmt = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};
