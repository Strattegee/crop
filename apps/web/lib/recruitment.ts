/** The recruitment board's wording and order (David, 31 Oct). Pure, tested in test/recruitment.test.ts. */
export const STAGE_ORDER = [
  { stage: 'applied', label: 'Applied' },
  { stage: 'screening', label: 'Screening' },
  { stage: 'interview', label: 'Interview' },
  { stage: 'offer', label: 'Offer' },
] as const;
export const STAGES: string[] = STAGE_ORDER.map(s => s.stage);

/** The stage after this one on the board (Offer has none: the next step is starting onboarding). */
export function nextStage(stage: string) {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGE_ORDER[i + 1] : null;
}
export function previousStage(stage: string) {
  const i = STAGES.indexOf(stage);
  return i > 0 ? STAGE_ORDER[i - 1] : null;
}

/** "New today", "3 days at this stage", "Onboarding for 5 days", "Started 2 days ago". */
export function daysLine(stage: string, days: number | null): string {
  if (days === null) return '';
  const d = `${days} day${days === 1 ? '' : 's'}`;
  if (stage === 'started') return days === 0 ? 'Started today' : `Started ${d} ago`;
  if (stage === 'onboarding') return days === 0 ? 'Onboarding since today' : `Onboarding for ${d}`;
  return days === 0 ? 'Moved here today' : `${d} at this stage`;
}
