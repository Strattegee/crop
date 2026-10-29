'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const BACK = '/settings/shift-duties';

/** Each credential's choice on the form: `req_<credentialTypeId>` = must | should (anything else: not needed). */
function requirements(f: FormData) {
  const out: { credentialTypeId: string; severity: 'hard' | 'warning' | 'optional' }[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith('req_')) continue;
    if (v === 'must') out.push({ credentialTypeId: k.slice(4), severity: 'hard' });
    else if (v === 'should') out.push({ credentialTypeId: k.slice(4), severity: 'warning' });
    else if (v === 'optional') out.push({ credentialTypeId: k.slice(4), severity: 'optional' });
  }
  return out;
}

export async function addDuty(f: FormData) {
  await attempt(BACK, () => api('/shift-duties', {
    method: 'POST', body: { name: str(f, 'name'), description: str(f, 'description') ?? null, requirements: requirements(f) },
  }), 'Duty added. Tick it on a shift in the roster to use it.');
}

export async function saveDuty(id: string, f: FormData) {
  await attempt(BACK, () => api(`/shift-duties/${id}`, {
    method: 'PATCH', body: { name: str(f, 'name'), description: str(f, 'description') ?? null, requirements: requirements(f) },
  }), 'Duty saved. Shifts with this duty now need what it lists.');
}

export async function setDutyActive(id: string, active: boolean) {
  await attempt(BACK, () => api(`/shift-duties/${id}`, { method: 'PATCH', body: { active } }),
    active ? 'Duty switched on.' : 'Duty switched off. It no longer counts on shifts and can’t be added to new ones.');
}
