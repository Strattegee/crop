'use server';

import { api, ApiError } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';
import { BULK_MAX, bulkReleaseMessage, releasePick, type BulkResult } from '../../../lib/allocation-queue';
import { contactSavedNote, dayLabel, parsePlace } from '../../../lib/client-orders';
import { T, words } from '../../../lib/terms';
import { addShiftsDates, addShiftsUntil, addShiftsWhen } from '../roster/view';
import { OUTCOME_LABEL, type CallOutcome } from '../../../lib/calls';

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

type BankCandidate = { workerId: string; name: string; eligible: boolean; offer?: { status: string } | null; distanceKm?: number | null };
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
    // Never the person who just pulled out of it; with "Nearest first" on, the top five are the nearest (as the panel shows them).
    const pick = releasePick(candidates, how, shift.pulledOutName, f.get('near') === '1');
    if (!pick.length) throw new ApiError(409, `Nobody else can work this ${tw.lower(T.shift)} right now. Try ${tw.lower(T.agency, true)}, or open it in the ${tw.lower(T.roster)} to see why.`);
    await api(`/shifts/${shiftId}/offers`, { method: 'POST', body: { workerIds: pick } });
    offered = pick.length;
  }, () => how === 'top'
    ? `Offered to the top ${offered}. The first to accept gets it.`
    : `Released to the ${tw.lower(T.bank)}: offered to ${offered} ${offered === 1 ? 'person' : 'people'}. The first to accept gets it.`);
}

type BulkShift = { status: string; role: string; localDate: string; localStart: string; offersPending: number; pulledOutName: string | null };

/**
 * Releases several New shifts to the bank in one press (layout C's "release in bulk" inside the queue, 2 Nov): each
 * shift is offered to everyone who can work it, exactly as its own Release button would, one after another in queue
 * order, carrying on past any that can't be released (someone got there first, nobody can work it, the week is locked).
 * At most BULK_MAX shifts per press.
 */
export async function releaseMany(f: FormData) {
  const tw = await words();
  const ids = [...new Set(f.getAll('shiftId').map(String).filter(id => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, BULK_MAX);
  const results: BulkResult[] = [];
  let msg = { ok: false, text: '' };
  await attempt(backTo(f), async () => {
    if (!ids.length) throw new ApiError(400, `No ${tw.lower(T.shift, true)} to release.`);
    for (const id of ids) {
      let label = `A ${tw.lower(T.shift)}`;
      try {
        const { shift, candidates } = await api<{ shift: BulkShift; candidates: BankCandidate[] }>(`/shifts/${id}/bank-fill?everyone=true`);
        label = `${dayLabel(shift.localDate)} ${shift.localStart} ${shift.role}`;
        if (shift.status !== 'open') { results.push({ label, offered: 0, reason: 'Someone is on it now' }); continue; }
        if (shift.offersPending > 0) { results.push({ label, offered: 0, reason: 'Already offered' }); continue; }
        const pick = releasePick(candidates, 'release', shift.pulledOutName);
        if (!pick.length) { results.push({ label, offered: 0, reason: 'Nobody else can work it' }); continue; }
        await api(`/shifts/${id}/offers`, { method: 'POST', body: { workerIds: pick } });
        results.push({ label, offered: pick.length });
      } catch (err) {
        if (err && typeof err === 'object' && 'digest' in err) throw err; // sign-in redirect
        results.push({ label, offered: 0, reason: err instanceof ApiError ? err.message : 'Something went wrong' });
      }
    }
    msg = bulkReleaseMessage(results, { bank: tw.lower(T.bank), shift: tw.lower(T.shift), shifts: tw.lower(T.shift, true) });
    if (!msg.ok) throw new ApiError(409, msg.text);
  }, () => msg.text);
}

/** Records that the signed-in person has this shift open on Allocations (shown to others as their initials; never a lock). */
export async function markPresence(shiftId: string): Promise<void> {
  try {
    await api(`/allocations/presence/${shiftId}`, { method: 'POST' });
  } catch {
    // Presence is a nicety: never get in the way.
  }
}

/**
 * Records a call (David, 3 Nov: "calls made" per officer). CROP doesn't dial: the office presses the outcome after
 * the call, from the fill panel or a person's page (`LogCall`).
 */
export async function logCall(f: FormData) {
  const outcome = str(f, 'outcome');
  const who = str(f, 'who') ?? 'them';
  await attempt(str(f, 'back') ?? '/allocations', () => api('/calls', {
    method: 'POST',
    body: {
      outcome, note: str(f, 'note'), workerId: str(f, 'workerId'), clientId: str(f, 'clientId'), contactId: str(f, 'contactId'),
      contactName: str(f, 'contactName'), shiftId: str(f, 'shiftId'), direction: f.get('direction') === 'in' ? 'in' : 'out',
    },
  }), `Call with ${who} logged: ${OUTCOME_LABEL[outcome as CallOutcome] ?? outcome}.`);
}

const CUSTOMERS = '/allocations?view=customers';

/** Accepts a new customer's request: as a new client, or for a client the business has (`clientId`). */
export async function acceptCustomer(id: string, name: string, f: FormData) {
  const clientId = str(f, 'clientId');
  let made = false;
  await attempt(CUSTOMERS, async () => {
    const r = await api<{ clientId: string; createdClient: boolean }>(`/customer-requests/${id}/accept`, { method: 'POST', body: clientId ? { clientId } : {} });
    made = r.createdClient;
  }, () => made ? `${name} is now a client with their contact saved. Take the order from the request below when you're ready.` : `Accepted for ${name}. Take the order from the request below when you're ready.`);
}

/** Declines a new customer's request (the note is for the office; CROP doesn't email the customer). */
export async function declineCustomer(id: string, name: string, f: FormData) {
  const note = str(f, 'note');
  await attempt(CUSTOMERS, () => api(`/customer-requests/${id}/decline`, { method: 'POST', body: note ? { note } : {} }),
    `${name}'s request is declined. Let them know if you haven't already.`);
}

/** Switches the public request page on or off and sets its welcome line. */
export async function setRequestPage(f: FormData) {
  const open = f.get('open') === 'on';
  await attempt(CUSTOMERS, () => api('/customer-request-page', { method: 'PUT', body: { open, intro: str(f, 'intro') ?? null } }),
    open ? 'Your request page is on.' : 'Your request page is off: it no longer takes requests.');
}

/**
 * Takes the order from an accepted new customer's request in one step (migration 0091): at one of the client's sites,
 * or at a new site made from the address they gave (owners and admins), then the order with its shifts, linked to the
 * request so it can't be taken twice. The shifts go into the queue like any order's.
 */
export async function orderFromRequest(id: string, clientId: string, f: FormData) {
  const tw = await words();
  const placeValue = str(f, 'site');
  let created = 0;
  let newSite = false;
  await attempt(CUSTOMERS, async () => {
    if (!placeValue) throw new ApiError(400, `Choose the ${tw.lower(T.site)}.`);
    let facilityId = placeValue;
    let areaId: string | undefined;
    if (placeValue === 'new') {
      facilityId = (await api<{ id: string }>('/facilities', {
        method: 'POST',
        body: {
          clientId, name: str(f, 'siteName'), addressLine: str(f, 'addressLine'), suburb: str(f, 'suburb'),
          state: str(f, 'state'), postcode: str(f, 'postcode'),
        },
      })).id;
      newSite = true;
    } else if (placeValue.includes('|')) {
      [facilityId, areaId] = placeValue.split('|');
    }
    created = (await api<{ created: number }>('/client-orders', {
      method: 'POST',
      body: {
        customerRequestId: id, clientId, facilityId, areaId: areaId || undefined, role: str(f, 'role'), date: str(f, 'date'),
        startTime: str(f, 'startTime'), endTime: str(f, 'endTime'),
        breakMinutes: str(f, 'breakMinutes') ? Number(str(f, 'breakMinutes')) : undefined, quantity: Number(str(f, 'quantity') ?? 1),
        channel: 'request_page', requestedByName: str(f, 'requestedByName'), requestedByEmail: str(f, 'requestedByEmail'),
        requestedByPhone: str(f, 'requestedByPhone'), saveContact: true, orderNotes: str(f, 'orderNotes'),
        confirmToClient: f.get('confirmToClient') === 'on',
      },
    })).created;
  }, () => `Order taken: ${tw.count(created, T.shift)} added${newSite ? ` at the new ${tw.lower(T.site)}` : ''}. They're in the queue now.`);
}
