'use server';

import { api, ApiError } from '../../../lib/api';
import { businessZone, todayIn } from '../../../lib/business';
import { attempt, str } from '../../../lib/actions';
import { loadCafeDemo } from './demo-cafe';
import { fillOpenShifts } from '../demo-tools';
import { T, words } from '../../../lib/terms';
import { addedMessage } from '../../../lib/outside-agency';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ROSTER_FULL_COOKIE, addShiftsDates, addShiftsUntil, addShiftsWhen, itemDrop, itemDropMessage, withShift } from './view';

/** Every roster form carries `back`, the roster URL to return to (week, site, view, selected shift). */
const back = (f: FormData) => {
  const b = str(f, 'back') ?? '/roster';
  return b.startsWith('/roster') ? b : '/roster';
};

export async function createShifts(f: FormData) {
  const tw = await words();
  const weekdays = f.getAll('weekdays').map(Number).filter(n => n >= 1 && n <= 7);
  // Days ticked with no Until (David, 29 Oct): the shifts go on those days in the 7 days from From, not on From itself.
  const startDate = str(f, 'startDate');
  const endDate = addShiftsUntil(startDate, str(f, 'endDate'), weekdays);
  const single = !endDate || endDate === startDate;
  const equipmentOnly = f.get('equipmentOnly') === 'on';
  let created = 0;
  await attempt(back(f), async () => {
    created = (await api<{ created: number }>('/shifts', {
    method: 'POST',
    body: {
      facilityId: str(f, 'facilityId'), areaId: str(f, 'areaId'), shiftCodeId: str(f, 'shiftCodeId'),
      role: equipmentOnly ? undefined : str(f, 'role'), equipmentOnly,
      startTime: str(f, 'startTime'), endTime: str(f, 'endTime'),
      ...(single ? { date: startDate } : { startDate, endDate, weekdays: weekdays.length ? weekdays : undefined }),
      quantity: Number(str(f, 'quantity') ?? 1), notes: str(f, 'notes'),
      dutyIds: f.getAll('dutyIds').map(String).filter(Boolean),
      genderRequested: equipmentOnly ? undefined : str(f, 'genderRequested') ?? undefined,
    },
  })).created;
  }, () => `${tw.count(created, T.shift)} added${startDate ? addShiftsWhen(addShiftsDates(startDate, endDate, weekdays)) : ''}.`);
}

export async function assign(shiftId: string, workerId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/assign`, { method: 'POST', body: { workerId } }), 'Assigned. Confirm once they have agreed.');
}

export async function confirm(shiftId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/confirm`, { method: 'POST' }), 'Booked.');
}

export async function unassign(shiftId: string, f: FormData) {
  const tw = await words();
  const pulledOut = f.get('pulledOut') === '1';
  await attempt(back(f), () => api(`/shifts/${shiftId}/unassign`, { method: 'POST', body: { pulledOut } }),
    pulledOut ? `Marked as pulled out. The ${tw.lower(T.shift)} shows purple until it is filled again.` : `Removed from the ${tw.lower(T.shift)}. It is open again.`);
}

export async function cancelShift(shiftId: string, f: FormData) {
  const tw = await words();
  await attempt(back(f), () => api(`/shifts/${shiftId}/cancel`, { method: 'POST', body: { reason: str(f, 'reason') } }), `${tw.one(T.shift)} cancelled.`);
}

/** Draft → Live: publishes the week for the site shown (or every site). Changes after this are logged. */
export async function publishWeek(f: FormData) {
  const site = str(f, 'site');
  const tw = await words();
  const notify = f.get('notify') === 'on';
  let messages = 0;
  await attempt(back(f), async () => {
    messages = (await api<{ messages: number }>('/roster/publish', { method: 'POST', body: { weekStart: str(f, 'week'), notify, ...(site ? { facilityId: site } : {}) } })).messages;
  }, () => `Published. The week is live; changes from now on are logged.${notify ? (messages ? ` ${messages} message${messages === 1 ? '' : 's'} sent to ${tw.lower(T.worker, true)} with their ${tw.lower(T.shift, true)}.` : ' Nobody needed a message.') : ' No messages sent.'}`);
}

export async function offer(shiftId: string, f: FormData) {
  const workerIds = f.getAll('workerIds').filter((x): x is string => typeof x === 'string');
  const minutes = Number(str(f, 'expiresInMinutes') ?? 0);
  await attempt(back(f), () => api(`/shifts/${shiftId}/offers`, {
    method: 'POST',
    body: { workerIds, ...(minutes > 0 ? { expiresInMinutes: minutes } : {}) },
  }), `Offered to ${workerIds.length} ${workerIds.length === 1 ? 'person' : 'people'}. The first to accept gets it.`);
}

/** Agency fill (migration 0040): send an open shift to the business's agencies, first in order now, the rest on the timer. */
export async function agencyFill(shiftId: string, f: FormData) {
  const tw = await words();
  const step = Number(str(f, 'stepMinutes'));
  await attempt(back(f), () => api(`/shifts/${shiftId}/agency-fill`, { method: 'POST', body: { note: str(f, 'note'), stepMinutes: Number.isInteger(step) && step > 0 ? step : undefined } }),
    `Sent to your first ${tw.lower(T.agency)}. The next ones get it in turn if nobody is put forward.`);
}

export async function agencyFillNext(shiftId: string, f: FormData) {
  const tw = await words();
  await attempt(back(f), () => api(`/shifts/${shiftId}/agency-fill/next`, { method: 'POST' }), `Sent to the next ${tw.lower(T.agency)}.`);
}

export async function agencyFillWithdraw(shiftId: string, f: FormData) {
  const tw = await words();
  await attempt(back(f), () => api(`/shifts/${shiftId}/agency-fill/withdraw`, { method: 'POST', body: { reason: str(f, 'reason') } }),
    `Taken back from your ${tw.lower(T.agency, true)}.`);
}

/** Email an open shift to agencies not on CROP (migration 0059). Changes nothing on the shift. */
export async function outsideAgencyEmail(shiftId: string, f: FormData) {
  const tw = await words();
  const agencyIds = f.getAll('agencyIds').filter((v): v is string => typeof v === 'string' && v !== '');
  await attempt(back(f), () => api(`/shifts/${shiftId}/outside-agencies`, { method: 'POST', body: { agencyIds, note: str(f, 'note') } }),
    `Emailed. They reply to you; add the person to the ${tw.lower(T.shift)} when they do.`);
}

/** An agency not on CROP replied with someone: put them on by name, booked and marked unchecked (migration 0060). */
export async function outsideAgencyPerson(shiftId: string, f: FormData) {
  const tw = await words();
  const firstName = str(f, 'firstName') ?? '';
  const lastName = str(f, 'lastName') ?? '';
  await attempt(back(f), () => api(`/shifts/${shiftId}/outside-agency-person`, { method: 'POST', body: { agencyId: str(f, 'agencyId'), firstName, lastName } }),
    addedMessage(firstName, lastName, tw.lower(T.shift)));
}

export async function recordReply(offerId: string, reply: 'accept' | 'decline', f: FormData) {
  await attempt(back(f), () => api(`/offers/${offerId}/${reply}`, { method: 'POST' }), reply === 'accept' ? 'Accepted and booked.' : 'Recorded as declined.');
}

export async function bookEquipment(shiftId: string, equipmentId: string, f: FormData) {
  const tw = await words();
  await attempt(back(f), () => api(`/shifts/${shiftId}/equipment`, { method: 'POST', body: { equipmentId } }), `${tw.one(T.equipment)} booked.`);
}

export async function removeEquipment(shiftId: string, equipmentId: string, f: FormData) {
  const tw = await words();
  await attempt(back(f), () => api(`/shifts/${shiftId}/equipment/${equipmentId}/remove`, { method: 'POST' }), `${tw.one(T.equipment)} removed from the ${tw.lower(T.shift)}.`);
}

/** Sets the duties on a shift (Settings → Shift duties); says if the person on it no longer meets them. */
/** Puts an item on the shift: issued to the person on it, or used on the shift. Stock comes from the shift's site. */
export async function useItem(shiftId: string, workerId: string | null, f: FormData) {
  const tw = await words();
  const itemId = str(f, 'itemId');
  const toPerson = !!workerId && f.get('toPerson') === 'on';
  await attempt(back(f), async () => {
    if (!itemId) throw new ApiError(400, `Choose ${/^[aeiou]/i.test(tw.one(T.item)) ? 'an' : 'a'} ${tw.lower(T.item)}`);
    await api(`/items/${itemId}/issue`, { method: 'POST', body: { shiftId, workerId: toPerson ? workerId : null, quantity: Number(str(f, 'quantity') ?? 'NaN'), notes: str(f, 'notes') } });
  }, toPerson ? `Issued for this ${tw.lower(T.shift)}.` : `Recorded as used on this ${tw.lower(T.shift)}.`);
}

/** Items coming back from the shift (or the person on it, for this shift) into the site's stock. */
export async function returnItem(shiftId: string, itemId: string, workerId: string | null, f: FormData) {
  await attempt(back(f), () => api(`/items/${itemId}/return`, { method: 'POST', body: { shiftId, workerId, quantity: Number(str(f, 'quantity') ?? 'NaN') } }), 'Returned to stock.');
}

export async function setDuties(shiftId: string, f: FormData) {
  const dutyIds = f.getAll('dutyIds').filter((x): x is string => typeof x === 'string');
  let problems: string[] = [];
  await attempt(back(f), async () => {
    problems = (await api<{ personProblems?: string[] }>(`/shifts/${shiftId}/duties`, { method: 'PUT', body: { dutyIds } })).personProblems ?? [];
  }, () => problems.length ? `Duties saved. ${problems.join('. ')}.` : 'Duties saved.');
}

/** Steve's "T" line: the person this shift covers; blank clears it. */
export async function setCovering(shiftId: string, f: FormData) {
  const workerId = str(f, 'workerId');
  let name: string | null = null;
  await attempt(back(f), async () => {
    name = (await api<{ coveringName: string | null }>(`/shifts/${shiftId}/covering`, { method: 'PUT', body: { workerId } })).coveringName;
  }, () => name ? `Now covering ${name}.` : 'Not covering anyone.');
}

/** New day, times or break for a shift; refused (with the reason) when the person or equipment on it can't do them. */
export async function setTimes(shiftId: string, f: FormData) {
  const brk = str(f, 'breakMinutes');
  let line = '';
  await attempt(back(f), async () => {
    const s = await api<{ localDate: string; localStart: string; localEnd: string }>(`/shifts/${shiftId}/times`, { method: 'PUT', body: {
      date: str(f, 'date'), startTime: str(f, 'startTime'), endTime: str(f, 'endTime'), breakMinutes: brk === null ? undefined : Number(brk),
    } });
    line = `Now ${s.localDate} ${s.localStart}–${s.localEnd}.`;
  }, () => line);
}

/** New role or area for a shift; refused (with the reason) when the person on it can't work the new role. */
export async function setRole(shiftId: string, f: FormData) {
  let line = '';
  await attempt(back(f), async () => {
    const s = await api<{ role: string; areaName: string | null }>(`/shifts/${shiftId}/role`, { method: 'PUT', body: { role: str(f, 'role'), areaId: str(f, 'areaId') ?? null } });
    line = `Now ${s.role}${s.areaName ? ` in ${s.areaName}` : ''}.`;
  }, () => line);
}

/** Gender requested for a shift (David, 30 Oct). A different or unrecorded gender on the person is a warning. */
export async function setGender(shiftId: string, f: FormData) {
  const genderRequested = str(f, 'genderRequested') ?? null;
  let warning: string | null = null;
  await attempt(back(f), async () => {
    warning = (await api<{ personWarning: string | null }>(`/shifts/${shiftId}/gender`, { method: 'PUT', body: { genderRequested } })).personWarning;
  }, () => `${genderRequested === 'F' ? 'Female worker requested.' : genderRequested === 'M' ? 'Male worker requested.' : 'No gender requested.'}${warning ? ` Note: ${warning}.` : ''}`);
}

/** Staging only (DEMO_TOOLS=on): fills an empty business with an invented café so the roster can be shown. */
export async function loadDemoWeek(f: FormData) {
  if (process.env.DEMO_TOOLS !== 'on') return;
  const week = str(f, 'week') ?? new Date().toISOString().slice(0, 10);
  const today = todayIn(await businessZone());
  await attempt(back(f), () => loadCafeDemo(week, today), 'Demo café loaded: 32 invented staff, credentials, equipment, stock and a week of shifts.');
}

/** Staging only: fills this week's open shifts with ready demo staff. */
export async function fillWeekDemo(f: FormData) {
  if (process.env.DEMO_TOOLS !== 'on') return;
  const week = str(f, 'week')!;
  let r = { open: 0, filled: 0 };
  await attempt(back(f), async () => { r = await fillOpenShifts(week); }, 'Open shifts filled where a ready person was available.');
  void r;
}

/** From the ribbon strip: a person or piece of equipment dropped onto a shift card. */
export type DropTarget = { workerId?: string | null; workerName?: string | null; equipmentOnly?: boolean; itemName?: string; itemUnit?: string };

export async function dropOnShift(kind: 'person' | 'equipment' | 'item', shiftId: string, id: string, backTo: string, target: DropTarget = {}) {
  const to = backTo.startsWith('/roster') ? backTo : '/roster';
  const tw = await words();
  if (kind === 'person') {
    await attempt(to, () => api(`/shifts/${shiftId}/assign`, { method: 'POST', body: { workerId: id } }), 'Assigned. Confirm once they have agreed.');
  } else if (kind === 'equipment') {
    await attempt(to, () => api(`/shifts/${shiftId}/equipment`, { method: 'POST', body: { equipmentId: id } }), `${tw.one(T.equipment)} booked.`);
  } else {
    // Items (backlog item 5): one of it, to the person on the shift or used on it; the shift's panel opens to adjust.
    const drop = itemDrop(target.workerId, !!target.equipmentOnly);
    await attempt(withShift(to, shiftId), () => api(`/items/${id}/issue`, { method: 'POST', body: { shiftId, ...drop } }),
      itemDropMessage(target.itemName ?? tw.one(T.item), target.itemUnit, drop.workerId ? target.workerName : null, tw.lower(T.shift)));
  }
}

/** Roster templates (Steve's "ideal week") and copying a week. The API's summary says what was added and what stayed open. */
type ApplyResult = { summary: string };

export async function saveTemplate(f: FormData) {
  await attempt(back(f), () => api('/roster/templates', {
    method: 'POST', body: { facilityId: str(f, 'facilityId'), weekStart: str(f, 'week'), name: str(f, 'name'), people: f.get('people') === 'on', equipment: f.get('equipment') === 'on' },
  }), `Saved as the template "${str(f, 'name') ?? ''}".`);
}

export async function applyTemplate(f: FormData) {
  const id = str(f, 'templateId');
  let r: ApplyResult = { summary: '' };
  await attempt(back(f), async () => {
    if (!id) throw new ApiError(400, 'Choose a template');
    r = await api<ApplyResult>(`/roster/templates/${id}/apply`, {
      method: 'POST', body: { weekStart: str(f, 'week'), people: f.get('people') === 'on', equipment: f.get('equipment') === 'on', addToExisting: f.get('addToExisting') === 'on' },
    });
  }, () => r.summary);
}

export async function copyWeek(f: FormData) {
  let r: ApplyResult = { summary: '' };
  await attempt(back(f), async () => {
    r = await api<ApplyResult>('/roster/copy-week', {
      method: 'POST',
      body: { facilityId: str(f, 'facilityId'), toWeek: str(f, 'week'), fromWeek: str(f, 'fromWeek'), people: f.get('people') === 'on', equipment: f.get('equipment') === 'on', addToExisting: f.get('addToExisting') === 'on' },
    });
  }, () => r.summary);
}

/** Copies the weeks of a month (the Mondays in it) into the same number of weeks starting `toWeek`. */
export async function copyMonth(f: FormData) {
  let r: ApplyResult = { summary: '' };
  await attempt(back(f), async () => {
    r = await api<ApplyResult>('/roster/copy-weeks', {
      method: 'POST',
      body: {
        facilityId: str(f, 'facilityId'), fromWeek: str(f, 'fromWeek'), weeks: Number(str(f, 'weeks')), toWeek: str(f, 'toWeek'),
        people: f.get('people') === 'on', equipment: f.get('equipment') === 'on', addToExisting: f.get('addToExisting') === 'on',
      },
    });
  }, () => r.summary);
}

export async function archiveTemplate(f: FormData) {
  const id = str(f, 'templateId');
  await attempt(back(f), () => api(`/roster/templates/${id}/archive`, { method: 'POST' }), 'Template put away.');
}

/** After publishing (migration 0025): ask for a change the business's rule stops you making, and approve or decline it. */
export async function requestChange(shiftId: string, f: FormData) {
  const change = str(f, 'change');
  await attempt(back(f), () => api(`/shifts/${shiftId}/change-requests`, {
    method: 'POST', body: { change, workerId: change === 'assign' ? str(f, 'workerId') : undefined, reason: str(f, 'reason') },
  }), 'Change requested. The owners and admins have been emailed, and you will get an email when it is decided.');
}

export async function decideChange(requestId: string, decision: 'approve' | 'decline' | 'withdraw', f: FormData) {
  const tw = await words();
  let r: { applied?: boolean; warnings?: string[] } = {};
  await attempt(back(f), async () => {
    r = await api<{ applied?: boolean; warnings?: string[] }>(`/change-requests/${requestId}/${decision}`, {
      method: 'POST', body: decision === 'withdraw' ? undefined : { note: str(f, 'note') },
    });
  }, () => decision === 'approve'
    ? (r.applied === false ? `Approved. Make the change on the ${tw.lower(T.shift)} now.` : `Approved and changed.${r.warnings?.length ? ` Note: ${r.warnings.join('. ')}` : ''}`)
    : decision === 'decline' ? 'Declined.' : 'Request withdrawn.');
}

/** Full page view on or off for this browser; returns to the same roster view. */
export async function setFullView(on: boolean, f: FormData) {
  const jar = await cookies();
  if (on) jar.set(ROSTER_FULL_COOKIE, '1', { path: '/', maxAge: 31536000, sameSite: 'lax' });
  else jar.delete(ROSTER_FULL_COOKIE);
  redirect(back(f));
}
