'use server';

import { api, ApiError } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';
import { contactSavedNote, parsePlace } from '../../../lib/client-orders';
import { T, words } from '../../../lib/terms';
import { addShiftsDates, addShiftsUntil, addShiftsWhen } from '../roster/view';

/** Puts one of the business's people forward for a request an employer sent it (agency fill, migration 0042). */
export async function putForward(requestId: string, workerId: string, name: string) {
  let booked = false;
  let employer = 'the employer';
  await attempt('/allocations', async () => {
    const r = await api<{ booked: boolean; employerName: string }>(`/agency-requests/${requestId}/put-forward`, { method: 'POST', body: { workerId } });
    booked = r.booked;
    employer = r.employerName;
  }, () => booked ? `${name} is booked with ${employer}.` : `${name} is put forward. ${employer} approves first; you'll see the answer here.`);
}

/** Takes back the person the business put forward (before the shift starts); the employer's shift opens again. */
export async function pullOut(requestId: string, name: string, employer: string, form: FormData) {
  const reason = String(form.get('reason') ?? '').trim();
  await attempt('/allocations', async () => {
    await api(`/agency-requests/${requestId}/pull-out`, { method: 'POST', body: { reason: reason || undefined } });
  }, `${name} is pulled out. ${employer} has been told and can fill it again.`);
}

/** Offers a request to the ticked people (first to accept goes), by email and text with a link each. */
export async function offerToPeople(requestId: string, form: FormData) {
  const workerIds = form.getAll('workerId').map(String).filter(Boolean);
  const minutes = Number(form.get('expiresInMinutes') ?? 0);
  let offered = 0;
  let already = 0;
  await attempt('/allocations', async () => {
    if (!workerIds.length) throw new ApiError(400, 'Tick the people to offer it to.');
    const r = await api<{ offered: number; alreadyOffered: number }>(`/agency-requests/${requestId}/offers`, {
      method: 'POST', body: { workerIds, ...(minutes > 0 ? { expiresInMinutes: minutes } : {}) },
    });
    offered = r.offered;
    already = r.alreadyOffered;
  }, () => `Offered to ${offered} ${offered === 1 ? 'person' : 'people'}${already ? ` (${already} already had it)` : ''}. The first to accept goes; you'll see it here.`);
}

/** Records a yes the office heard directly: the person is put forward as if they had used their link. */
export async function recordYes(offerId: string, name: string) {
  let booked = false;
  await attempt('/allocations', async () => {
    booked = (await api<{ booked: boolean }>(`/agency-offers/${offerId}/accept`, { method: 'POST' })).booked;
  }, () => booked ? `${name} is booked.` : `${name} is put forward, waiting for the employer's approval.`);
}

/** Withdraws every pending offer on a request. */
export async function withdrawOffers(requestId: string) {
  await attempt('/allocations', () => api(`/agency-requests/${requestId}/offers/withdraw`, { method: 'POST' }), 'Offers withdrawn. Their links no longer work.');
}

/**
 * Records a client's order (by email, phone or their portal) and makes its shifts at the client's site (client
 * orders, 2 Nov). Days ticked with no Until go on those days in the 7 days from the date, as on the roster.
 */
export async function createClientOrder(f: FormData) {
  const tw = await words();
  const place = parsePlace(str(f, 'place'));
  const weekdays = f.getAll('weekdays').map(Number).filter(n => n >= 1 && n <= 7);
  const startDate = str(f, 'startDate');
  const endDate = addShiftsUntil(startDate, str(f, 'endDate'), weekdays);
  const single = !endDate || endDate === startDate;
  let created = 0, contactSaved = false;
  const contactId = str(f, 'contactId');
  await attempt('/allocations', async () => {
    if (!place) throw new ApiError(400, `Choose the ${tw.lower(T.client)} and ${tw.lower(T.site)}.`);
    ({ created, contactSaved } = await api<{ created: number; contactSaved: boolean }>('/client-orders', {
      method: 'POST',
      body: {
        ...place, role: str(f, 'role'), startTime: str(f, 'startTime'), endTime: str(f, 'endTime'),
        breakMinutes: str(f, 'breakMinutes') ? Number(str(f, 'breakMinutes')) : undefined,
        ...(single ? { date: startDate } : { startDate, endDate, weekdays: weekdays.length ? weekdays : undefined }),
        quantity: Number(str(f, 'quantity') ?? 1), genderRequested: str(f, 'genderRequested'), notes: str(f, 'notes'),
        channel: str(f, 'channel') ?? 'other', requestedByName: str(f, 'requestedByName'), requestedByEmail: str(f, 'requestedByEmail'),
        requestedByPhone: str(f, 'requestedByPhone'), clientReference: str(f, 'clientReference'), orderNotes: str(f, 'orderNotes'),
        confirmToClient: f.get('confirmToClient') === 'on', contactId, saveContact: !contactId && f.get('saveContact') === 'on',
      },
    }));
  }, () => `Order saved: ${tw.count(created, T.shift)} added${startDate ? addShiftsWhen(addShiftsDates(startDate, endDate, weekdays)) : ''}. They're in the queue now.`
    + contactSavedNote(contactSaved, str(f, 'requestedByName'), tw.lower(T.client)));
}

type BankCandidate = { workerId: string; name: string; eligible: boolean; offer?: { status: string } | null };
const backTo = (f: FormData) => {
  const b = str(f, 'back') ?? '/allocations';
  return b.startsWith('/allocations') ? b : '/allocations';
};

/**
 * Offers a shift from the allocation queue to people who can work it (David, 2 Nov): `top` = the best five not already
 * waiting on an offer, `release` = everyone who can work it ("release to the bank", up to 50). Text and email as for
 * any offer; the first to accept is booked. Who can work it is the API's own ranked list, checked again when offering;
 * the person who pulled out of it isn't asked again.
 */
export async function offerFromQueue(shiftId: string, how: 'top' | 'release', f: FormData) {
  const tw = await words();
  let offered = 0;
  await attempt(backTo(f), async () => {
    const { shift, candidates } = await api<{ shift: { pulledOutName: string | null }; candidates: BankCandidate[] }>(`/shifts/${shiftId}/bank-fill?everyone=true`);
    // Not the person who just pulled out of it.
    const free = candidates.filter(c => c.eligible && c.offer?.status !== 'pending' && c.name !== shift.pulledOutName);
    const pick = (how === 'top' ? free.slice(0, 5) : free.slice(0, 50)).map(c => c.workerId);
    if (!pick.length) throw new ApiError(409, `Nobody else can work this ${tw.lower(T.shift)} right now. Try ${tw.lower(T.agency, true)}, or open it in the ${tw.lower(T.roster)} to see why.`);
    await api(`/shifts/${shiftId}/offers`, { method: 'POST', body: { workerIds: pick } });
    offered = pick.length;
  }, () => how === 'top'
    ? `Offered to the top ${offered}. The first to accept gets it.`
    : `Released to the ${tw.lower(T.bank)}: offered to ${offered} ${offered === 1 ? 'person' : 'people'}. The first to accept gets it.`);
}

/** Records that the signed-in person has this shift open on Allocations (shown to others as their initials; never a lock). */
export async function markPresence(shiftId: string): Promise<void> {
  try {
    await api(`/allocations/presence/${shiftId}`, { method: 'POST' });
  } catch {
    // Presence is a nicety: never get in the way.
  }
}
