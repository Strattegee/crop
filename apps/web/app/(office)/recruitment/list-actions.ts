'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { str } from '../../../lib/actions';
import { bulkMessage, type BulkOutcome } from '../../../lib/roster-list';
import { T, words } from '../../../lib/terms';
import { MOVE_STAGES, RECRUIT_BULK_MAX, STAGE_LABEL, parsePicks, type ListStage, type Pick } from '../../../lib/recruitment-list';

/**
 * Bulk actions on the ticked people of the recruitment list (David, 5 Nov). Each person goes through the same endpoint
 * as one at a time, one after another, carrying on past any the API refuses; one message then says what was done and
 * names who wasn't, with the API's reason.
 */

const backOf = (f: FormData) => {
  const b = str(f, 'back') ?? '/recruitment';
  return b.startsWith('/recruitment') ? b : '/recruitment';
};
const to = (back: string, m: { done?: string; error?: string }) =>
  redirect(`${back}${back.includes('?') ? '&' : '?'}${m.done ? 'done' : 'error'}=${encodeURIComponent(m.done ?? m.error ?? '')}`);
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function picksOf(f: FormData): { back: string; picks: Pick[] } {
  const back = backOf(f);
  const picks = parsePicks(f.getAll('pick').map(String));
  if (!picks.length) to(back, { error: 'Tick the people first.' });
  if (picks.length > RECRUIT_BULK_MAX) to(back, { error: `Tick up to ${RECRUIT_BULK_MAX} people at a time (${picks.length} ticked).` });
  return { back, picks };
}

async function each(picks: Pick[], fn: (p: Pick) => Promise<string | void>): Promise<BulkOutcome[]> {
  const out: BulkOutcome[] = [];
  for (const p of picks) {
    try {
      const skipped = await fn(p);
      out.push(skipped ? { label: p.name, ok: false, message: skipped } : { label: p.name, ok: true });
    } catch (err) {
      if (err && typeof err === 'object' && 'digest' in err) throw err;
      out.push({ label: p.name, ok: false, message: err instanceof ApiError ? err.message : 'something went wrong' });
    }
  }
  return out;
}

/** Moves everyone ticked to one stage (the board's rules: applicants only, not to where they already are). */
export async function bulkMove(f: FormData) {
  const { back, picks } = picksOf(f);
  const stage = str(f, 'stage') as ListStage | undefined;
  if (!stage || !MOVE_STAGES.includes(stage)) to(back, { error: 'Choose the stage to move them to.' });
  const results = await each(picks, async p => {
    await api(`/workers/${p.id}/stage`, { method: 'POST', body: { stage } });
  });
  to(back, bulkMessage(`Moved to ${STAGE_LABEL[stage!]}:`, results, people, 'Not moved'));
}

/** Marks everyone ticked as not proceeding, with one note. */
export async function bulkNotProceeding(f: FormData) {
  const { back, picks } = picksOf(f);
  const results = await each(picks, async p => {
    await api(`/workers/${p.id}/stage`, { method: 'POST', body: { stage: 'not_proceeding', note: str(f, 'note') } });
  });
  to(back, bulkMessage('Marked as not proceeding:', results, people, 'Not changed'));
}

/**
 * Asks everyone ticked for what's still needed: people being onboarded get their checklist's ask, everyone else an
 * upload link. People without an email address are skipped.
 */
export async function bulkAsk(f: FormData) {
  const { back, picks } = picksOf(f);
  const note = str(f, 'askNote');
  const sms = f.get('sms') === 'on';
  const results = await each(picks, async p => {
    if (!p.hasEmail) return 'no email address recorded';
    if (p.stage === 'onboarding' && p.onboardingId) {
      await api(`/onboardings/${p.onboardingId}/ask`, { method: 'POST', body: { note, sms } });
    } else {
      await api(`/workers/${p.id}/upload-link`, { method: 'POST', body: { note, sms } });
    }
  });
  to(back, bulkMessage('Asked for documents:', results, people, 'Not asked'));
}

/** Starts onboarding for everyone ticked, each with the checklist for their roles. */
export async function bulkOnboard(f: FormData) {
  const { back, picks } = picksOf(f);
  const results = await each(picks, async p => {
    if (p.stage === 'onboarding') return 'already being onboarded';
    await api(`/workers/${p.id}/onboarding`, { method: 'POST', body: { checklistId: 'auto', hold: true } });
  });
  const tw = await words();
  const m = bulkMessage('Onboarding started for', results, people, 'Not started');
  to(back, m.done ? { done: `${m.done} They stay off the ${tw.lower(T.roster)} until it is finished.` } : m);
}
