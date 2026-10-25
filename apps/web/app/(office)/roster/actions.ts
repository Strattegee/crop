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

/**
 * Staging only (DEMO_TOOLS=on): fills an empty business with an invented week so the roster can be shown.
 * Every name is made up; nothing here is real data.
 */
export async function loadDemoWeek(f: FormData) {
  if (process.env.DEMO_TOOLS !== 'on') return;
  const week = str(f, 'week') ?? new Date().toISOString().slice(0, 10);
  const day = (n: number) => new Date(Date.parse(`${week}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  await attempt(back(f), async () => {
    type Id = { id: string };
    const post = <T = Id>(p: string, body: unknown) => api<T>(p, { method: 'POST', body });
    const cafe = (await post('/facilities', { name: 'Harbour Kitchen', state: 'VIC', suburb: 'Docklands' })).id;
    const kitchen = (await post(`/facilities/${cafe}/areas`, { name: 'Kitchen' })).id;
    const floor = (await post(`/facilities/${cafe}/areas`, { name: 'Floor' })).id;
    const yard = (await post('/facilities', { name: 'Dandenong Hire Yard', state: 'VIC', suburb: 'Dandenong' })).id;
    const am = (await post('/shift-codes', { code: 'AM', name: 'Morning', startTime: '07:00', endTime: '15:00', breakMinutes: 30 })).id;
    const pm = (await post('/shift-codes', { code: 'PM', name: 'Evening', startTime: '15:00', endTime: '23:00', breakMinutes: 30 })).id;
    const staff: [string, string, string, string, number | null][] = [
      ['Ana', 'Example', 'CHEF', 'full_time', 38], ['Ben', 'Sample', 'CHEF', 'part_time', 24], ['Cara', 'Demo', 'WAITER', 'casual', null],
      ['Dev', 'Test', 'WAITER', 'bank', null], ['Eli', 'Mock', 'OPERATOR', 'full_time', 38], ['Fay', 'Trial', 'WAITER', 'bank', null],
      ['Gus', 'Placeholder', 'OPERATOR', 'casual', null],
    ];
    const ids: Record<string, string> = {};
    for (const [first, last, role, type, hours] of staff) {
      const w = (await post('/workers', { firstName: first, lastName: last, roles: [role] })).id;
      ids[first] = w;
      await api(`/workers/${w}/right-to-work`, { method: 'PUT', body: { status: 'citizen', citizenProofType: 'au_passport', documentNumber: 'DEMO0000' } });
      await post(`/workers/${w}/right-to-work/verify`, { note: 'Demo data' });
      await post(`/workers/${w}/employment`, { employmentType: type, contractedHours: hours ?? undefined, startsOn: '2026-01-01' });
    }
    await post('/shifts', { facilityId: cafe, areaId: kitchen, shiftCodeId: am, role: 'CHEF', startDate: day(0), endDate: day(6) });
    await post('/shifts', { facilityId: cafe, areaId: kitchen, shiftCodeId: pm, role: 'CHEF', startDate: day(1), endDate: day(5) });
    await post('/shifts', { facilityId: cafe, areaId: floor, shiftCodeId: pm, role: 'WAITER', startDate: day(3), endDate: day(6), quantity: 2 });
    await post('/shifts', { facilityId: yard, role: 'OPERATOR', startDate: day(0), endDate: day(4), startTime: '06:00', endTime: '14:30', breakMinutes: 30 });
    const bobcatType = (await post('/equipment-types', { name: 'Bobcat' })).id;
    const truckType = (await post('/equipment-types', { name: 'Tipper truck' })).id;
    const bobcat = (await post('/equipment', { equipmentTypeId: bobcatType, name: 'Bobcat 1', homeFacilityId: yard })).id;
    await post('/equipment', { equipmentTypeId: truckType, name: 'Tipper 2', registration: 'DEMO02', homeFacilityId: yard });
    type S = { id: string; role: string; localStart: string; localDate: string };
    const shifts = await api<S[]>(`/shifts?from=${day(0)}&to=${day(6)}`);
    const put = async (s: S, w: string, book = true) => {
      try {
        await post(`/shifts/${s.id}/assign`, { workerId: w });
        if (book) await post(`/shifts/${s.id}/confirm`, {});
      } catch { /* leave it open */ }
    };
    for (const s of shifts.filter(s => s.role === 'CHEF' && s.localStart === '07:00' && s.localDate < day(6))) await put(s, ids.Ana);
    for (const s of shifts.filter(s => s.role === 'CHEF' && s.localStart === '15:00').slice(0, 3)) await put(s, ids.Ben, s.localDate !== day(3));
    for (const [i, s] of shifts.filter(s => s.role === 'WAITER').slice(0, 4).entries()) await put(s, i % 2 ? ids.Dev : ids.Cara);
    for (const s of shifts.filter(s => s.role === 'OPERATOR').slice(0, 4)) await put(s, ids.Eli);
    for (const s of shifts.filter(s => s.role === 'OPERATOR').slice(0, 3)) {
      try { await post(`/shifts/${s.id}/equipment`, { equipmentId: bobcat }); } catch { /* skip */ }
    }
  }, 'Demo week loaded. All names and sites are invented.');
}
