'use server';

import { api } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';
import { loadCafeDemo } from './demo-cafe';
import { fillOpenShifts } from '../demo-tools';

/** Every roster form carries `back`, the roster URL to return to (week, site, view, selected shift). */
const back = (f: FormData) => {
  const b = str(f, 'back') ?? '/roster';
  return b.startsWith('/roster') ? b : '/roster';
};

export async function createShifts(f: FormData) {
  const weekdays = f.getAll('weekdays').map(Number).filter(n => n >= 1 && n <= 7);
  const single = !str(f, 'endDate') || str(f, 'endDate') === str(f, 'startDate');
  const equipmentOnly = f.get('equipmentOnly') === 'on';
  await attempt(back(f), () => api('/shifts', {
    method: 'POST',
    body: {
      facilityId: str(f, 'facilityId'), areaId: str(f, 'areaId'), shiftCodeId: str(f, 'shiftCodeId'),
      role: equipmentOnly ? undefined : str(f, 'role'), equipmentOnly,
      startTime: str(f, 'startTime'), endTime: str(f, 'endTime'),
      ...(single ? { date: str(f, 'startDate') } : { startDate: str(f, 'startDate'), endDate: str(f, 'endDate'), weekdays: weekdays.length ? weekdays : undefined }),
      quantity: Number(str(f, 'quantity') ?? 1), notes: str(f, 'notes'),
    },
  }), 'Shifts added.');
}

export async function assign(shiftId: string, workerId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/assign`, { method: 'POST', body: { workerId } }), 'Assigned. Confirm once they have agreed.');
}

export async function confirm(shiftId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/confirm`, { method: 'POST' }), 'Booked.');
}

export async function unassign(shiftId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/unassign`, { method: 'POST' }), 'Removed from the shift. It is open again.');
}

export async function cancelShift(shiftId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/cancel`, { method: 'POST', body: { reason: str(f, 'reason') } }), 'Shift cancelled.');
}

export async function offer(shiftId: string, f: FormData) {
  const workerIds = f.getAll('workerIds').filter((x): x is string => typeof x === 'string');
  const minutes = Number(str(f, 'expiresInMinutes') ?? 0);
  await attempt(back(f), () => api(`/shifts/${shiftId}/offers`, {
    method: 'POST',
    body: { workerIds, ...(minutes > 0 ? { expiresInMinutes: minutes } : {}) },
  }), `Offered to ${workerIds.length} ${workerIds.length === 1 ? 'person' : 'people'}. The first to accept gets it.`);
}

export async function recordReply(offerId: string, reply: 'accept' | 'decline', f: FormData) {
  await attempt(back(f), () => api(`/offers/${offerId}/${reply}`, { method: 'POST' }), reply === 'accept' ? 'Accepted and booked.' : 'Recorded as declined.');
}

export async function bookEquipment(shiftId: string, equipmentId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/equipment`, { method: 'POST', body: { equipmentId } }), 'Equipment booked.');
}

export async function removeEquipment(shiftId: string, equipmentId: string, f: FormData) {
  await attempt(back(f), () => api(`/shifts/${shiftId}/equipment/${equipmentId}/remove`, { method: 'POST' }), 'Equipment removed from the shift.');
}

/** Staging only (DEMO_TOOLS=on): fills an empty business with an invented café so the roster can be shown. */
export async function loadDemoWeek(f: FormData) {
  if (process.env.DEMO_TOOLS !== 'on') return;
  const week = str(f, 'week') ?? new Date().toISOString().slice(0, 10);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
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
export async function dropOnShift(kind: 'person' | 'equipment', shiftId: string, id: string, backTo: string) {
  const to = backTo.startsWith('/roster') ? backTo : '/roster';
  if (kind === 'person') {
    await attempt(to, () => api(`/shifts/${shiftId}/assign`, { method: 'POST', body: { workerId: id } }), 'Assigned. Confirm once they have agreed.');
  } else {
    await attempt(to, () => api(`/shifts/${shiftId}/equipment`, { method: 'POST', body: { equipmentId: id } }), 'Equipment booked.');
  }
}
