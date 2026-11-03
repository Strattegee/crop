'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';
import { MARKER_KINDS } from '../../../../lib/marker-letters';

const BACK = '/settings/shift-types';
const minutes = (f: FormData) => {
  const v = str(f, 'breakMinutes');
  return v === undefined ? undefined : Number(v);
};

export async function addShiftType(f: FormData) {
  await attempt(BACK, () => api('/shift-codes', {
    method: 'POST',
    body: {
      code: str(f, 'code'), letter: str(f, 'letter') ?? null, name: str(f, 'name'),
      startTime: str(f, 'startTime'), endTime: str(f, 'endTime'), breakMinutes: minutes(f) ?? 0, facilityId: str(f, 'facilityId'),
    },
  }), 'Shift type added.');
}

/** Saves a shift type. A blank letter clears it, so the roster shows A, P or N from the start time. */
export async function saveShiftType(id: string, f: FormData) {
  await attempt(BACK, () => api(`/shift-codes/${id}`, {
    method: 'PATCH',
    body: { letter: str(f, 'letter') ?? '', name: str(f, 'name'), startTime: str(f, 'startTime'), endTime: str(f, 'endTime'), breakMinutes: minutes(f) },
  }), 'Shift type saved. Shifts already on the roster keep their times.');
}

export async function setShiftTypeActive(id: string, active: boolean) {
  await attempt(BACK, () => api(`/shift-codes/${id}`, { method: 'PATCH', body: { active } }), active ? 'Shift type switched on.' : 'Shift type switched off. It no longer appears when adding shifts.');
}

/** Letters on roster cards (migration 0079): blank goes back to CROP's letter. */
export async function saveMarkerLetters(f: FormData) {
  const markerLetters = Object.fromEntries(MARKER_KINDS.map(k => [k, str(f, k) ?? null]));
  await attempt(BACK, () => api('/settings', { method: 'PATCH', body: { markerLetters } }), 'Letters saved. The roster shows them now.');
}
