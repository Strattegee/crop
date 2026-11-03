'use server';

import { api } from '../../../../lib/api';
import { attempt, str } from '../../../../lib/actions';

const BACK = '/settings/offices';

export async function addOffice(f: FormData) {
  await attempt(BACK, () => api('/offices', { method: 'POST', body: { name: str(f, 'name'), state: str(f, 'state') ?? null } }),
    'Office added.');
}

export async function updateOffice(id: string, f: FormData) {
  await attempt(BACK, () => api(`/offices/${id}`, { method: 'PATCH', body: { name: str(f, 'name'), state: str(f, 'state') ?? null } }), 'Office saved.');
}

export async function setOfficeActive(id: string, active: boolean) {
  await attempt(BACK, () => api(`/offices/${id}`, { method: 'PATCH', body: { active } }),
    active ? 'Office switched on.' : 'Office switched off. Everything in it stays there until you move it.');
}

export async function setOfficePeople(id: string, f: FormData) {
  const userIds = f.getAll('userId').map(String);
  await attempt(BACK, () => api(`/offices/${id}/people`, { method: 'PUT', body: { userIds } }), 'People saved.');
}

/** One site's office from the "Sites and their offices" list (blank = no office). */
export async function setSiteOffice(facilityId: string, f: FormData) {
  await attempt(BACK, () => api(`/facilities/${facilityId}`, { method: 'PATCH', body: { officeId: str(f, 'officeId') ?? null } }), 'Saved.');
}
