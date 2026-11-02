'use server';

import { api, ApiError } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';
import { parsePlace } from '../../../lib/client-orders';
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
  let created = 0;
  await attempt('/allocations', async () => {
    if (!place) throw new ApiError(400, `Choose the ${tw.lower(T.client)} and ${tw.lower(T.site)}.`);
    created = (await api<{ created: number }>('/client-orders', {
      method: 'POST',
      body: {
        ...place, role: str(f, 'role'), startTime: str(f, 'startTime'), endTime: str(f, 'endTime'),
        breakMinutes: str(f, 'breakMinutes') ? Number(str(f, 'breakMinutes')) : undefined,
        ...(single ? { date: startDate } : { startDate, endDate, weekdays: weekdays.length ? weekdays : undefined }),
        quantity: Number(str(f, 'quantity') ?? 1), genderRequested: str(f, 'genderRequested'), notes: str(f, 'notes'),
        channel: str(f, 'channel') ?? 'other', requestedByName: str(f, 'requestedByName'), requestedByEmail: str(f, 'requestedByEmail'),
        requestedByPhone: str(f, 'requestedByPhone'), clientReference: str(f, 'clientReference'), orderNotes: str(f, 'orderNotes'),
        confirmToClient: f.get('confirmToClient') === 'on',
      },
    })).created;
  }, () => `Order saved: ${tw.count(created, T.shift)} added${startDate ? addShiftsWhen(addShiftsDates(startDate, endDate, weekdays)) : ''}. Fill them below with Find staff.`);
}

/** Records the client's yes on Allocations, allocated or booked (their client confirms bookings; both sides must say yes). */
export async function clientConfirmedHere(shiftId: string) {
  const tw = await words();
  let status = '';
  await attempt('/allocations', async () => {
    status = (await api<{ status: string }>(`/shifts/${shiftId}/client-confirmed`, { method: 'POST' })).status;
  }, () => status === 'booked' ? `Recorded: the ${tw.lower(T.client)} confirmed. It's booked.` : `Recorded: the ${tw.lower(T.client)} confirmed. Waiting for the ${tw.lower(T.worker)} to confirm.`);
}
