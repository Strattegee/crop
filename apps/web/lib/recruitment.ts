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

const STAGE_WORD: Record<string, string> = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', onboarding: 'Onboarding', started: 'Started',
};
const stageWord = (s: string | null) => (s ? STAGE_WORD[s] ?? s : null);

export type RecruitmentEvent = { at: string; toStage: string; fromStage: string | null; byName: string | null; note: string | null };

/**
 * One line per move in a person's recruitment history (their page): "Applied", "Moved to Interview",
 * "Moved back to Screening", "Not proceeding", "Reopened", "Onboarding started", "Started work".
 */
export function historyLine(e: Pick<RecruitmentEvent, 'toStage' | 'fromStage'>): string {
  switch (e.toStage) {
    case 'applied':
      return e.fromStage && STAGES.indexOf(e.fromStage) > 0 ? 'Moved back to Applied' : 'Applied';
    case 'not_proceeding': return e.fromStage ? `Not proceeding (was at ${stageWord(e.fromStage)})` : 'Not proceeding';
    case 'reopened': return 'Reopened';
    case 'onboarding': return 'Onboarding started';
    case 'started': return 'Onboarding finished: started work';
    default: {
      const to = STAGES.indexOf(e.toStage);
      const from = e.fromStage ? STAGES.indexOf(e.fromStage) : -1;
      if (to < 0) return stageWord(e.toStage) ?? e.toStage;
      return from > to ? `Moved back to ${STAGE_WORD[e.toStage]}` : `Moved to ${STAGE_WORD[e.toStage]}`;
    }
  }
}

/**
 * Where someone is in recruitment, for their page: the board stage for applicants, "Onboarding", "Not proceeding"
 * (inactive after a not-proceeding move), "Started" once onboarding finished, or null when they never went through it.
 */
export function recruitmentState(status: string, stage: string | null, events: Pick<RecruitmentEvent, 'toStage'>[]): string | null {
  if (status === 'applicant') return stageWord(stage ?? 'applied');
  if (events.length === 0) return null;
  if (status === 'onboarding') return 'Onboarding';
  const last = events[events.length - 1].toStage;
  if (status === 'inactive' && last === 'not_proceeding') return 'Not proceeding';
  if (events.some(e => e.toStage === 'started')) return 'Started';
  return null;
}

/**
 * What dropping a card on another column does on the board (drag and drop, David 31 Oct): a move between the four
 * stages, or null when the drop is ignored (same column, or Onboarding/Started, which need their own steps).
 */
export function dropMove(fromStage: string, toColumn: string): { stage: string; label: string } | null {
  if (fromStage === toColumn || !STAGES.includes(fromStage) || !STAGES.includes(toColumn)) return null;
  const back = STAGES.indexOf(toColumn) < STAGES.indexOf(fromStage);
  return { stage: toColumn, label: back ? `Moved back to ${STAGE_WORD[toColumn]}.` : `Moved to ${STAGE_WORD[toColumn]}.` };
}
