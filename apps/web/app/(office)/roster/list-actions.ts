'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '../../../lib/api';
import { str } from '../../../lib/actions';
import { releasePick } from '../../../lib/allocation-queue';
import { LIST_BULK_MAX, bulkMessage, parsePicks, type BulkOutcome } from '../../../lib/roster-list';
import { T, words } from '../../../lib/terms';
import { assignToShifts } from './actions';
import { pickedInOrder } from './view';

/**
 * Bulk actions on the ticked rows of the roster's List view (David and Steve, 4 Nov). Each shift goes through the
 * ordinary endpoint, one after another in date order, carrying on past any the API refuses (someone got there first,
 * the after-publishing rule, a hard block), then one message says what was done and why the rest weren't.
 */

const backOf = (f: FormData) => {
  const b = str(f, 'back') ?? '/roster';
  return b.startsWith('/roster') ? b : '/roster';
};
const to = (back: string, m: { done?: string; error?: string }) =>
  redirect(`${back}${back.includes('?') ? '&' : '?'}${m.done ? 'done' : 'error'}=${encodeURIComponent(m.done ?? m.error ?? '')}`);

/** The ticked shifts, refusing none or too many before anything is changed. */
async function picksOf(f: FormData) {
  const tw = await words();
  const picks = parsePicks(f.getAll('pick').map(String));
  const back = backOf(f);
  if (!picks.length) to(back, { error: `Tick the ${tw.lower(T.shift, true)} first.` });
  if (picks.length > LIST_BULK_MAX) to(back, { error: `Tick up to ${LIST_BULK_MAX} ${tw.lower(T.shift, true)} at a time (${picks.length} ticked).` });
  return { tw, back, picks: pickedInOrder(picks) };
}

/** Runs `fn` for each ticked shift and collects what happened (Next.js redirects, e.g. to sign in again, pass through). */
async function each(picks: { id: string; label: string }[], fn: (id: string) => Promise<string | void>): Promise<BulkOutcome[]> {
  const out: BulkOutcome[] = [];
  for (const p of picks) {
    try {
      const skipped = await fn(p.id);
      out.push(skipped ? { label: p.label, ok: false, message: skipped } : { label: p.label, ok: true });
    } catch (err) {
      if (err && typeof err === 'object' && 'digest' in err) throw err;
      out.push({ label: p.label, ok: false, message: err instanceof ApiError ? err.message : 'something went wrong' });
    }
  }
  return out;
}

/** One person onto every ticked shift: exactly the multi-drop on the cards (`assignToShifts`). */
export async function bulkAssign(f: FormData) {
  const { tw, back, picks } = await picksOf(f);
  // A best-person button (`best`) or the full list (`person`), each "id|name".
  const raw = str(f, 'best') ?? str(f, 'person') ?? '';
  const cut = raw.indexOf('|');
  const workerId = cut > 0 ? raw.slice(0, cut) : '';
  if (!/^[0-9a-f-]{36}$/i.test(workerId)) to(back, { error: `Choose the ${tw.lower(T.worker)} to put on.` });
  await assignToShifts(workerId, raw.slice(cut + 1), picks.map(p => ({ id: p.id, date: p.date, start: p.start })), back);
}

/** Confirms (or approves, for an agency's person) every ticked shift someone is waiting on. */
export async function bulkConfirm(f: FormData) {
  const { tw, back, picks } = await picksOf(f);
  const results = await each(picks, async id => {
    await api(`/shifts/${id}/confirm`, { method: 'POST' });
  });
  to(back, bulkMessage('Confirmed', results, n => tw.count(n, T.shift), 'Not confirmed'));
}

type BankCandidate = { workerId: string; name: string; eligible: boolean; offer?: { status: string } | null };
type BankShift = { status: string; offersPending: number; pulledOutName: string | null };

/**
 * Offers each ticked open shift to people who can work it, as the Allocations queue does: `top` = the best five not
 * already waiting on an offer, `release` = everyone who can work it (release to the bank). Shifts someone is on, or
 * already offered, are left as they are.
 */
export async function bulkOffer(f: FormData) {
  const { tw, back, picks } = await picksOf(f);
  const how = str(f, 'how') === 'release' ? 'release' : 'top';
  let offers = 0;
  const results = await each(picks, async id => {
    const { shift, candidates } = await api<{ shift: BankShift; candidates: BankCandidate[] }>(`/shifts/${id}/bank-fill?everyone=true`);
    if (shift.status !== 'open') return 'someone is on it';
    if (shift.offersPending > 0) return 'already offered';
    const pick = releasePick(candidates, how, shift.pulledOutName);
    if (!pick.length) return 'nobody else can work it';
    await api(`/shifts/${id}/offers`, { method: 'POST', body: { workerIds: pick } });
    offers += pick.length;
  });
  const m = bulkMessage(how === 'top' ? 'Offered to the best people:' : `Released to the ${tw.lower(T.bank)}:`, results, n => tw.count(n, T.shift), 'Not offered');
  to(back, m.done ? { done: `${m.done} ${offers} ${offers === 1 ? 'offer' : 'offers'} sent; the first to accept each one gets it.` } : m);
}

/** Cancels every ticked shift with one reason (and why, for the live numbers). */
export async function bulkCancel(f: FormData) {
  const { tw, back, picks } = await picksOf(f);
  const reason = str(f, 'reason');
  const kind = str(f, 'kind');
  if (!reason) to(back, { error: `Say why the ${tw.lower(T.shift, true)} are cancelled.` });
  if (!kind) to(back, { error: 'Choose why they are cancelled.' });
  const results = await each(picks, async id => {
    await api(`/shifts/${id}/cancel`, { method: 'POST', body: { reason, kind } });
  });
  to(back, bulkMessage('Cancelled', results, n => tw.count(n, T.shift), 'Not cancelled'));
}

/** Adds one duty to every ticked shift, keeping the duties each already has. */
export async function bulkDuty(f: FormData) {
  const { tw, back, picks } = await picksOf(f);
  const dutyId = str(f, 'dutyId');
  if (!dutyId) to(back, { error: 'Choose the duty to add.' });
  const results = await each(picks, async id => {
    const s = await api<{ duties?: { id: string }[] }>(`/shifts/${id}`);
    const now = (s.duties ?? []).map(d => d.id);
    if (now.includes(dutyId!)) return 'already has it';
    await api(`/shifts/${id}/duties`, { method: 'PUT', body: { dutyIds: [...now, dutyId] } });
  });
  to(back, bulkMessage('Duty added to', results, n => tw.count(n, T.shift), 'Not added'));
}
