/**
 * The recruitment board (David, 31 Oct): pure rules. One record from applicant to worker:
 * Applied → Screening → Interview → Offer (status 'applicant'), then Onboarding (status 'onboarding'), then Started
 * (onboarding finished in the last 30 days). Anyone can be marked not proceeding and reopened later.
 */
export const BOARD_STAGES = ['applied', 'screening', 'interview', 'offer'] as const;
export type BoardStage = typeof BOARD_STAGES[number];
export type Move = BoardStage | 'not_proceeding' | 'reopen';
export const MOVES: readonly Move[] = [...BOARD_STAGES, 'not_proceeding', 'reopen'];

export const STAGE_LABEL: Record<BoardStage | 'onboarding' | 'started', string> = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', onboarding: 'Onboarding', started: 'Started',
};

/** Days shown in the Started column after onboarding is finished. */
export const STARTED_DAYS = 30;

/** Why a move can't be made, or null. `lastEvent` is the person's latest recruitment event (for reopening). */
export function moveRefusal(p: { status: string; stage: string | null; lastEvent: string | null }, to: Move): string | null {
  if (to === 'reopen') {
    return p.status === 'inactive' && p.lastEvent === 'not_proceeding' ? null : 'Only someone marked as not proceeding can be reopened';
  }
  if (p.status === 'onboarding') return 'They are being onboarded: finish or stop their onboarding on their page';
  if (p.status !== 'applicant') return 'Only applicants move on the recruitment board';
  if (to !== 'not_proceeding' && p.stage === to) return `They are already at ${STAGE_LABEL[to]}`;
  return null;
}

/** Whole days since a time (for "3 days in this stage"). */
export function daysSince(iso: string | Date | null, now = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}
