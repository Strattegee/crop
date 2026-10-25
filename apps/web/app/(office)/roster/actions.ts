'use server';

import { api } from '../../../lib/api';
import { attempt, str } from '../../../lib/actions';

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
      role: equipmentOnly ? undefined : str(f, 'role')?.toUpperCase(), equipmentOnly,
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
