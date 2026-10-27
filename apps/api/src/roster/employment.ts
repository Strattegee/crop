/**
 * Rules for correcting employment terms (pure, unit-tested). Terms are effective-dated: each live term ends the day
 * before the next one starts. A correction never overwrites a row; the controller withdraws it and inserts a new one,
 * and these functions say what else has to move so the dates still join up.
 */
export type TermDates = { id: string; startsOn: string; endsOn: string | null };

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
  return { ok: true, previousId: previous?.id ?? null, previousEndsOn: list[0].endsOn };
}
